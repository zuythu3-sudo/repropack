import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  readReportFile,
  validateReport,
  validateReportFile,
} from "../packages/cli/dist/index.js";
import { temporaryDirectory, validReport, writeReport } from "./helpers.mjs";

test("validates a well-formed report", async () => {
  const report = validReport();
  const result = await validateReport(report);
  assert.equal(result.valid, true);
  assert.equal(result.report, report);
  assert.deepEqual(result.errors, []);
});

test("rejects schema violations and unknown fields", async () => {
  const report = validReport({ schemaVersion: "2.0.0", surprise: true });
  const result = await validateReport(report);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /additional properties|equal to constant/i);
});

test("rejects dangerous keys before schema validation", async () => {
  const report = validReport();
  Object.defineProperty(report, "__proto__", {
    value: { polluted: true },
    enumerable: true,
  });
  const result = await validateReport(report);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /forbidden property name/);
  assert.equal({}.polluted, undefined);
});

test("rejects excessive JSON nesting", async () => {
  let nested = {};
  for (let index = 0; index < 24; index += 1) nested = { child: nested };
  const result = await validateReport({ ...validReport(), nested });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /nesting exceeds/);
});

test("strict mode rejects residual warnings", async () => {
  const report = validReport({ redaction: { residualWarnings: ["Review a long value."] } });
  assert.equal((await validateReport(report)).valid, true);
  const strict = await validateReport(report, { strict: true });
  assert.equal(strict.valid, false);
  assert.match(strict.errors[0], /strict validation/);
});

test("rejects mismatched redaction totals and residual credentials", async () => {
  const mismatched = await validateReport(validReport({ redaction: { total: 2 } }));
  assert.equal(mismatched.valid, false);
  assert.match(mismatched.errors.join(" "), /sum of category counts/);

  const secret = await validateReport(validReport({
    output: { stdout: "sk-proj-abcdefghijklmnopqrstuvwxyz123456" },
  }));
  assert.equal(secret.valid, false);
  assert.match(secret.errors.join(" "), /secret material/);
});

test("rejects terminal and directional controls in hand-authored reports", async () => {
  for (const stdout of ["safe\u001b[31munsafe", "safe\u202Eunsafe"]) {
    const result = await validateReport(validReport({ output: { stdout } }));
    assert.equal(result.valid, false);
    assert.match(result.errors.join(" "), /unsafe control character/);
  }
});

test("reads local reports and returns bounded read errors", async () => {
  const directory = await temporaryDirectory();
  const filename = await writeReport(directory);
  assert.deepEqual(await readReportFile(filename), validReport());
  assert.equal((await validateReportFile(filename)).valid, true);

  const malformed = path.join(directory, "bad.repropack.json");
  await writeFile(malformed, "{", "utf8");
  assert.match((await validateReportFile(malformed)).errors[0], /valid JSON/);
  assert.match((await validateReportFile(path.join(directory, "missing.json"))).errors[0], /ENOENT|no such file/i);
});

test("rejects URL, network, directory, and oversized paths without fetching", async () => {
  assert.match((await validateReportFile("https://example.invalid/a.repropack.json")).errors[0], /local files/);
  assert.match((await validateReportFile("\\\\server\\share\\a.repropack.json")).errors[0], /local files/);

  const directory = await temporaryDirectory();
  assert.match((await validateReportFile(directory)).errors[0], /regular file/);
  const oversized = path.join(directory, "large.repropack.json");
  await writeFile(oversized, " ".repeat(3 * 1024 * 1024 + 1), "utf8");
  assert.match((await validateReportFile(oversized)).errors[0], /size limit/);
});
