import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { temporaryDirectory, validReport, writeReport } from "../helpers.mjs";

const cli = path.resolve("packages/cli/dist/bin.js");

test("inspect, validate, and render never replay a captured command", async () => {
  const directory = await temporaryDirectory();
  const sentinel = path.join(directory, "replayed.txt");
  const filename = await writeReport(directory, validReport({
    command: {
      argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'replayed')`],
    },
  }));

  for (const args of [
    ["inspect", filename],
    ["validate", filename, "--strict"],
    ["render", filename, "--format", "github"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(sentinel), false);
  }
});
