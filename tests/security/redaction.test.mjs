import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import fc from "fast-check";

import {
  redactText,
  sanitizeTerminalText,
  scanResidualSecrets,
} from "../../packages/cli/dist/index.js";
import { mergeCategoryCounts } from "../../packages/cli/dist/redaction.js";

test("redacts high-confidence credential formats", () => {
  const values = [
    ["private-key", "-----BEGIN PRIVATE KEY-----\nQUJDREVGRw==\n-----END PRIVATE KEY-----"],
    ["openai-token", "sk-proj-abcdefghijklmnopqrstuvwxyz123456"],
    ["github-token", "ghp_abcdefghijklmnopqrstuvwxyz123456"],
    ["aws-access-key", "AKIAABCDEFGHIJKLMNOP"],
    ["jwt", "abcdefghijklmno.abcdefghijklmnop.abcdefghijklmnop"],
  ];
  for (const [category, value] of values) {
    const result = redactText(value);
    assert.equal(result.value.includes(value), false);
    assert.equal(result.categories[category], 1);
    assert.deepEqual(result.blockingSecrets, []);
  }
});

test("redacts structured authentication and keyed values", () => {
  const input = [
    "Authorization: Bearer bearer-value-1234",
    "authorization=Basic basic-value-1234",
    "Cookie: sid=cookie-value-1234",
    "Set-Cookie: sid=other-cookie-value",
    "https://alice:password@example.test/path",
    "password=hunter-two-value",
    "--client-secret cli-secret-value",
  ].join("\n");
  const result = redactText(input);
  for (const secret of [
    "bearer-value-1234",
    "basic-value-1234",
    "cookie-value-1234",
    "other-cookie-value",
    "alice:password",
    "hunter-two-value",
    "cli-secret-value",
  ]) assert.equal(result.value.includes(secret), false);
  assert.ok(result.categories.authorization >= 2);
  assert.ok(result.categories.cookie >= 2);
  assert.equal(result.categories["url-credentials"], 1);
  assert.equal(result.categories["keyed-secret"], 1);
  assert.equal(result.categories["cli-secret"], 1);
});

test("uses sensitive and explicitly requested environment values only as needles", () => {
  const context = {
    environment: {
      NORMAL: "leave-this-normal-value",
      API_TOKEN: "environment-token-value",
      CUSTOM: "custom-sensitive-value",
      EMPTY_SECRET: "",
      SHORT_SECRET: "abc",
    },
    extraEnvironmentNames: ["CUSTOM"],
  };
  const result = redactText("environment-token-value custom-sensitive-value leave-this-normal-value", context);
  assert.equal(result.value.includes("environment-token-value"), false);
  assert.equal(result.value.includes("custom-sensitive-value"), false);
  assert.equal(result.value.includes("leave-this-normal-value"), true);
  assert.equal(result.categories["environment-secret"], 2);
});

test("replaces workspace, home, drive, UNC, and Unix user paths", () => {
  const workspace = path.resolve("C:\\work\\example");
  const home = path.resolve("C:\\Users\\alice");
  const input = [
    workspace,
    workspace.replaceAll("\\", "/"),
    home,
    "D:\\private\\source\\file.ts",
    "\\\\host\\share\\private.txt",
    "/home/alice/private/file.ts",
    "/Users/bob/project",
  ].join("\n");
  const result = redactText(input, { workspace, home, environment: {} });
  assert.match(result.value, /<WORKSPACE>/);
  assert.match(result.value, /<HOME>/);
  assert.match(result.value, /<ABS_PATH>/);
  assert.match(result.value, /<UNC_PATH>/);
  assert.equal(/alice|bob|private\.txt/.test(result.value), false);
});

test("removes ANSI, OSC, C0, C1, and directional controls while preserving Unicode", () => {
  const input = "\u001b[31m红色\u001b[0m\u001b]8;;https://evil.test\u0007link\u001b]8;;\u0007\u0000\u0085\u202E完成";
  const result = redactText(input, { environment: {} });
  assert.equal(result.value, "红色link完成");
  assert.ok(result.categories["terminal-control"] >= 3);
  assert.ok(result.categories["control-character"] >= 2);
  assert.equal(result.categories["directional-control"], 1);
  assert.equal(sanitizeTerminalText(input), "红色link完成");
});

test("flags invalid UTF-8 and residual high-entropy values", () => {
  const invalid = redactText(Buffer.from([0xff, 0x61]), { environment: {} });
  assert.equal(invalid.encodingIssues, true);
  const entropy = redactText("abcDEF0123456789abcDEF0123456789abcDEF0123456789", { environment: {} });
  assert.equal(entropy.residualWarnings.length, 1);
  assert.deepEqual(entropy.blockingSecrets, []);
});

test("scanner is repeatable and category counts merge", () => {
  const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
  assert.deepEqual(scanResidualSecrets(secret).blocking, ["openai-token"]);
  assert.deepEqual(scanResidualSecrets(secret).blocking, ["openai-token"]);
  assert.deepEqual(scanResidualSecrets("ordinary output"), { blocking: [], warnings: [] });
  assert.deepEqual(mergeCategoryCounts({ token: 1 }, {}, { token: 2, path: 4 }), { token: 3, path: 4 });
});

test("property: embedded configured secrets never survive redaction", () => {
  fc.assert(fc.property(
    fc.stringMatching(/^[A-Za-z0-9]{8,32}$/),
    fc.string({ maxLength: 40 }),
    fc.string({ maxLength: 40 }),
    (secret, prefix, suffix) => {
      const result = redactText(`${prefix}${secret}${suffix}`, {
        environment: { TEST_SECRET: secret },
      });
      assert.equal(result.value.includes(secret), false);
    },
  ), { numRuns: 150 });
});

test("defaults to process paths and environment without throwing", () => {
  const result = redactText(`${process.cwd()} ${os.homedir()}`);
  assert.equal(result.value.includes(process.cwd()), false);
  assert.equal(result.value.includes(os.homedir()), false);
});
