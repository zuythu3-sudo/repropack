import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  inspectSummary,
  renderGithub,
  writeReportFile,
} from "../packages/cli/dist/index.js";
import {
  initializeProject,
  loadConfig,
  pathExists,
  privacyPreview,
} from "../packages/cli/dist/report.js";
import { temporaryDirectory, validReport } from "./helpers.mjs";

test("loads defaults and validates explicit configuration", async () => {
  const directory = await temporaryDirectory();
  assert.deepEqual(await loadConfig(directory), {
    timeoutMs: 600000,
    maxOutputBytes: 1048576,
    redactEnvironment: [],
  });
  await writeFile(path.join(directory, ".repropackrc.json"), JSON.stringify({
    timeoutMs: 1000,
    maxOutputBytes: 65536,
    redactEnvironment: ["MY_TOKEN", "MY_TOKEN"],
  }), "utf8");
  assert.deepEqual(await loadConfig(directory), {
    timeoutMs: 1000,
    maxOutputBytes: 65536,
    redactEnvironment: ["MY_TOKEN"],
  });
});

test("rejects malformed and unsafe configuration", async () => {
  for (const [name, value, pattern] of [
    ["bad-json", "{", /valid JSON/],
    ["array", "[]", /JSON object/],
    ["unknown", '{"wat":1}', /unknown options/],
    ["timeout", '{"timeoutMs":2}', /timeoutMs/],
    ["limit", '{"maxOutputBytes":2}', /maxOutputBytes/],
    ["env", '{"redactEnvironment":["BAD-NAME"]}', /environment variable/],
  ]) {
    const directory = await temporaryDirectory(`${name} `);
    await writeFile(path.join(directory, ".repropackrc.json"), value, "utf8");
    await assert.rejects(loadConfig(directory), pattern);
  }
});

test("writes a valid report once with a trailing newline", async () => {
  const directory = await temporaryDirectory();
  const filename = path.join(directory, "out.repropack.json");
  assert.equal(await pathExists(filename), false);
  assert.equal(await writeReportFile(filename, validReport()), path.resolve(filename));
  assert.equal(await pathExists(filename), true);
  assert.match(await readFile(filename, "utf8"), /\n$/);
  await assert.rejects(writeReportFile(filename, validReport()), /overwrite/);
  await assert.rejects(writeReportFile(path.join(directory, "invalid.json"), { nope: true }), /Generated report is invalid/);
  await assert.rejects(writeReportFile("https://example.invalid/report.json", validReport()), /local file/);
});

test("renders output safely with a longer dynamic fence", () => {
  const report = validReport({ output: { stdout: "before\n```\n\u001b]8;;https://example.test\u0007after", stderr: "" } });
  const markdown = renderGithub(report);
  assert.match(markdown, /````text\nbefore\n```\nafter\n````/);
  assert.equal(markdown.includes("\u001b"), false);
  assert.match(markdown, /untrusted diagnostic data/);
  assert.match(markdown, /workspace-path \| 1/);
});

test("renderer handles many separate fence runs without argument expansion", () => {
  const stdout = "` ".repeat(100_000);
  const markdown = renderGithub(validReport({ output: { stdout, stderr: "" } }));
  assert.match(markdown, /```text/);
});

test("inspection hides output unless requested and preview never includes it", () => {
  const report = validReport({ output: { stdout: "private diagnostic", stderr: "private error" } });
  const hidden = inspectSummary(report, false);
  assert.equal(hidden.output.stdout, undefined);
  assert.equal(inspectSummary(report, true).output.stdout, "private diagnostic");
  const preview = privacyPreview(report, "report.json");
  assert.doesNotMatch(preview, /private diagnostic|private error/);
  assert.match(preview, /Privacy preview/);
});

test("initializes project files without overwriting", async () => {
  const directory = await temporaryDirectory();
  const created = await initializeProject(directory, true);
  assert.equal(created.length, 2);
  assert.equal(await pathExists(path.join(directory, ".repropackrc.json")), true);
  assert.match(await readFile(path.join(directory, ".github", "ISSUE_TEMPLATE", "repropack.yml"), "utf8"), /ReproPack report/);
  await assert.rejects(initializeProject(directory, true), /overwrite/);

  const plain = await temporaryDirectory();
  assert.equal((await initializeProject(plain, false)).length, 1);
});
