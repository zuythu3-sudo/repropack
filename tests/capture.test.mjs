import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { captureCommand } from "../packages/cli/dist/index.js";
import { temporaryDirectory } from "./helpers.mjs";

function options(directory, argv, overrides = {}) {
  return {
    argv,
    cwd: directory,
    timeoutMs: 5_000,
    maxOutputBytes: 64 * 1024,
    redactEnvironment: [],
    ...overrides,
  };
}

test("captures literal argv without shell interpolation", async () => {
  const directory = await temporaryDirectory("repropack space ");
  const metacharacters = "hello & echo injected | < > $() ` 中文";
  const result = await captureCommand(options(directory, [
    process.execPath,
    "-e",
    "process.stdout.write(process.argv[1]); process.stderr.write(process.cwd());",
    metacharacters,
  ]));
  assert.equal(result.report.command.exitCode, 0);
  assert.equal(result.report.output.stdout, metacharacters);
  assert.equal(result.report.output.stderr, "<WORKSPACE>");
  assert.equal(result.report.command.cwd, "<WORKSPACE>");
});

test("redacts a child process cwd reached through a workspace alias", { skip: process.platform === "win32" }, async (context) => {
  const root = await temporaryDirectory("repropack alias ");
  context.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, "target");
  const alias = path.join(root, "alias");
  await mkdir(target);
  await symlink(target, alias, "dir");
  const result = await captureCommand(options(alias, [
    process.execPath,
    "-e",
    "process.stderr.write(process.cwd());",
  ]));
  assert.equal(result.report.command.exitCode, 0);
  assert.equal(result.report.output.stderr, "<WORKSPACE>");
  assert.equal(result.report.command.cwd, "<WORKSPACE>");
});

test("redacts credentials across stream chunks", async () => {
  const directory = await temporaryDirectory();
  const script = [
    "process.stdout.write('sk-proj-abcdefghijkl');",
    "setTimeout(() => { process.stdout.write('mnopqrstuvwxyz123456'); }, 5);",
  ].join("");
  const result = await captureCommand(options(directory, [process.execPath, "-e", script]));
  assert.doesNotMatch(result.report.output.stdout, /sk-proj-/);
  assert.match(result.report.output.stdout, /REDACTED/);
  assert.equal(result.blockingSecrets.length, 0);
});

test("bounds both streams and records truncation", async () => {
  const directory = await temporaryDirectory();
  const result = await captureCommand(options(directory, [
    process.execPath,
    "-e",
    "process.stdout.write('x'.repeat(70000)); process.stderr.write('y'.repeat(70000));",
  ]));
  assert.equal(Buffer.byteLength(result.report.output.stdout), 65536);
  assert.equal(Buffer.byteLength(result.report.output.stderr), 65536);
  assert.equal(result.report.output.stdoutTruncated, true);
  assert.equal(result.report.output.stderrTruncated, true);
});

test("records launch failures as bounded diagnostics", async () => {
  const directory = await temporaryDirectory();
  const result = await captureCommand(options(directory, ["repropack-command-that-does-not-exist"]));
  assert.equal(result.report.command.exitCode, null);
  assert.match(result.report.output.stderr, /Unable to start command/);
});

test("times out a long-running process", async () => {
  const directory = await temporaryDirectory();
  const result = await captureCommand(options(directory, [
    process.execPath,
    "-e",
    "setTimeout(() => {}, 5000)",
  ], { timeoutMs: 100 }));
  assert.equal(result.report.command.timedOut, true);
  assert.notEqual(result.report.command.signal, null);
});

test("supports safe Windows cmd wrappers", { skip: process.platform !== "win32" }, async () => {
  const directory = await temporaryDirectory("repropack cmd space ");
  const script = path.join(directory, "sample command.cmd");
  await writeFile(script, "@echo off\r\necho %~1\r\n", "utf8");
  const result = await captureCommand(options(directory, [script, "hello world"]));
  assert.equal(result.report.command.exitCode, 0);
  assert.equal(result.report.output.stdout.trim(), "hello world");

  const rejected = await captureCommand(options(directory, [script, "unsafe & echo injected"]));
  assert.equal(rejected.report.command.exitCode, null);
  assert.match(rejected.report.output.stderr, /metacharacters/);
});

test("requires at least one command argument", async () => {
  const directory = await temporaryDirectory();
  await assert.rejects(captureCommand(options(directory, [])), /command is required/);
});
