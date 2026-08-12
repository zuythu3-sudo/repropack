import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { temporaryDirectory, validReport, writeReport } from "./helpers.mjs";

const cli = path.resolve("packages/cli/dist/bin.js");

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
}

test("prints help, version, and usage errors", async () => {
  const directory = await temporaryDirectory();
  assert.match(run([], directory).stdout, /Usage:/);
  assert.equal(run(["--version"], directory).stdout.trim(), "0.1.0");
  const unknown = run(["wat"], directory);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command/);
  assert.equal(run(["capture", "node"], directory).status, 2);
  assert.equal(run(["inspect"], directory).status, 2);
  assert.equal(run(["render", "x.json"], directory).status, 2);
});

test("initializes plain and GitHub-aware projects", async () => {
  const plain = await temporaryDirectory();
  assert.equal(run(["init"], plain).status, 0);
  assert.equal(existsSync(path.join(plain, ".repropackrc.json")), true);
  assert.equal(run(["init"], plain).status, 2);

  const github = await temporaryDirectory();
  assert.equal(run(["init", "--github"], github).status, 0);
  assert.equal(existsSync(path.join(github, ".github", "ISSUE_TEMPLATE", "repropack.yml")), true);
  assert.equal(run(["init", "--bad"], github).status, 2);
});

test("captures, previews, writes, and preserves program exit status", async () => {
  const directory = await temporaryDirectory("repropack cli space ");
  const output = path.join(directory, "captured.repropack.json");
  const result = run([
    "capture",
    "--yes",
    "--output",
    output,
    "--",
    process.execPath,
    "-e",
    "process.stdout.write('token=topsecretvalue'); process.exit(9)",
  ], directory);
  assert.equal(result.status, 9);
  assert.match(result.stderr, /Privacy preview/);
  const report = JSON.parse(await readFile(output, "utf8"));
  assert.equal(report.command.exitCode, 9);
  assert.doesNotMatch(report.output.stdout, /topsecretvalue/);
});

test("refuses overwrite and noninteractive capture before running a command", async () => {
  const directory = await temporaryDirectory();
  const output = path.join(directory, "existing.repropack.json");
  const sentinel = path.join(directory, "should-not-exist.txt");
  await writeFile(output, "keep", "utf8");
  const command = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran')`];

  const existing = run(["capture", "--yes", "--output", output, "--", ...command], directory);
  assert.equal(existing.status, 2);
  assert.match(existing.stderr, /overwrite/);
  assert.equal(existsSync(sentinel), false);

  const noninteractive = run(["capture", "--", ...command], directory);
  assert.equal(noninteractive.status, 2);
  assert.match(noninteractive.stderr, /requires --yes/);
  assert.equal(existsSync(sentinel), false);
});

test("validates and inspects without executing report content", async () => {
  const directory = await temporaryDirectory();
  const sentinel = path.join(directory, "executed.txt");
  const report = validReport({
    command: {
      argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'bad')`],
    },
    output: { stdout: "https://127.0.0.1:1/do-not-open" },
  });
  const filename = await writeReport(directory, report);

  const validation = run(["validate", filename, "--strict", "--json"], directory);
  assert.equal(validation.status, 0);
  assert.deepEqual(JSON.parse(validation.stdout), { valid: true, errors: [] });

  const inspected = run(["inspect", filename, "--json"], directory);
  assert.equal(inspected.status, 0);
  assert.doesNotMatch(inspected.stdout, /do-not-open/);
  assert.equal(existsSync(sentinel), false);

  const shown = run(["inspect", filename, "--show-output"], directory);
  assert.match(shown.stdout, /do-not-open/);
  assert.equal(existsSync(sentinel), false);
});

test("reports invalid input and renders validated GitHub Markdown", async () => {
  const directory = await temporaryDirectory();
  const valid = await writeReport(directory, validReport(), "valid.repropack.json");
  const invalid = path.join(directory, "invalid.repropack.json");
  await writeFile(invalid, "{}", "utf8");

  const invalidResult = run(["validate", invalid], directory);
  assert.equal(invalidResult.status, 1);
  assert.match(invalidResult.stderr, /invalid/);
  assert.equal(run(["inspect", invalid], directory).status, 1);

  const rendered = run(["render", valid, "--format", "github"], directory);
  assert.equal(rendered.status, 0);
  assert.match(rendered.stdout, /ReproPack diagnostic report/);
});
