import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";

import { REPROPACK_VERSION, SCHEMA_VERSION } from "./constants.js";
import { collectEnvironment, collectRepository } from "./metadata.js";
import { mergeCategoryCounts, redactText, type RedactionResult } from "./redaction.js";
import type { CaptureOptions, CaptureResult, ReproPackReport } from "./types.js";

interface CollectedStream {
  chunks: Buffer[];
  bytes: number;
  truncated: boolean;
}

function collectChunk(target: CollectedStream, chunk: Buffer, limit: number): void {
  if (target.bytes >= limit) {
    target.truncated = true;
    return;
  }
  const remaining = limit - target.bytes;
  const kept = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining);
  target.chunks.push(Buffer.from(kept));
  target.bytes += kept.byteLength;
  if (kept.byteLength !== chunk.byteLength) target.truncated = true;
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return { value, truncated: false };
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) low = middle;
    else high = middle - 1;
  }
  let end = low;
  if (end > 0 && /[\uD800-\uDBFF]/u.test(value.charAt(end - 1))) end -= 1;
  return { value: value.slice(0, end), truncated: true };
}

function resolveWindowsProgram(program: string, cwd: string): string {
  const extensions = path.extname(program)
    ? [""]
    : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const directories = path.isAbsolute(program) || program.includes("/") || program.includes("\\")
    ? [cwd]
    : [cwd, ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean)];

  for (const directory of directories) {
    for (const extension of extensions) {
      const base = path.isAbsolute(program) ? program : path.resolve(directory, program);
      const candidate = `${base}${extension}`;
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        // Continue searching PATH entries that are inaccessible.
      }
    }
  }
  return program;
}

function quoteCmdArgument(value: string): string {
  if (/[\r\n"&|<>^()%!]/u.test(value)) {
    throw new Error("Windows .cmd arguments cannot contain command-interpreter metacharacters.");
  }
  return `"${value}"`;
}

type CapturedChild = ChildProcessByStdio<null, Readable, Readable>;

function spawnSafely(argv: string[], cwd: string): CapturedChild {
  let program = argv[0] as string;
  let args = argv.slice(1);
  let windowsVerbatimArguments = false;

  if (process.platform === "win32") {
    program = resolveWindowsProgram(program, cwd);
    if (/\.(?:cmd|bat)$/iu.test(program)) {
      const commandLine = `"${[program, ...args].map(quoteCmdArgument).join(" ")}"`;
      program = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
      args = ["/d", "/s", "/c", commandLine];
      windowsVerbatimArguments = true;
    }
  }

  return spawn(program, args, {
    cwd,
    env: process.env,
    shell: false,
    windowsVerbatimArguments,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function redactOutput(
  raw: Buffer,
  options: CaptureOptions,
): RedactionResult & { truncatedAfterRedaction: boolean } {
  const redacted = redactText(raw, {
    workspace: options.cwd,
    environment: process.env,
    extraEnvironmentNames: options.redactEnvironment,
  });
  const bounded = truncateUtf8(redacted.value, options.maxOutputBytes);
  return { ...redacted, value: bounded.value, truncatedAfterRedaction: bounded.truncated };
}

export async function captureCommand(options: CaptureOptions): Promise<CaptureResult> {
  if (options.argv.length === 0) throw new Error("A command is required.");

  const stdout: CollectedStream = { chunks: [], bytes: 0, truncated: false };
  const stderr: CollectedStream = { chunks: [], bytes: 0, truncated: false };
  const started = process.hrtime.bigint();
  let exitCode: number | null = null;
  let signal: string | null = null;
  let timedOut = false;
  let launchError: Error | undefined;

  let child: CapturedChild | undefined;
  try {
    child = spawnSafely(options.argv, options.cwd);
  } catch (error: unknown) {
    launchError = error instanceof Error ? error : new Error("Unable to start command.");
  }

  if (child) {
    child.stdout.on("data", (chunk: Buffer) => collectChunk(stdout, chunk, options.maxOutputBytes));
    child.stderr.on("data", (chunk: Buffer) => collectChunk(stderr, chunk, options.maxOutputBytes));

    const timeout = setTimeout(() => {
      timedOut = true;
      child?.kill();
    }, options.timeoutMs);
    timeout.unref();

    const result = await new Promise<{ code: number | null; signal: string | null; error?: Error }>((resolve) => {
      let settled = false;
      const settle = (value: { code: number | null; signal: string | null; error?: Error }): void => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      child.once("error", (error) => settle({ code: null, signal: null, error }));
      child.once("close", (code, closeSignal) => settle({ code, signal: closeSignal }));
    });
    clearTimeout(timeout);

    exitCode = result.code;
    signal = result.signal;
    launchError = result.error;
  }

  if (launchError) {
    collectChunk(stderr, Buffer.from(`Unable to start command: ${launchError.message}\n`, "utf8"), options.maxOutputBytes);
  }

  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const commandParts = options.argv.map((part) => redactText(part, {
    workspace: options.cwd,
    environment: process.env,
    extraEnvironmentNames: options.redactEnvironment,
  }));
  const redactedCwd = redactText(options.cwd, { workspace: options.cwd, environment: process.env });
  const redactedStdout = redactOutput(Buffer.concat(stdout.chunks), options);
  const redactedStderr = redactOutput(Buffer.concat(stderr.chunks), options);
  const categories = mergeCategoryCounts(
    ...commandParts.map((part) => part.categories),
    redactedCwd.categories,
    redactedStdout.categories,
    redactedStderr.categories,
  );
  const residualWarnings = [...new Set([
    ...commandParts.flatMap((part) => part.residualWarnings),
    ...redactedCwd.residualWarnings,
    ...redactedStdout.residualWarnings,
    ...redactedStderr.residualWarnings,
  ])];
  const blockingSecrets = [...new Set([
    ...commandParts.flatMap((part) => part.blockingSecrets),
    ...redactedCwd.blockingSecrets,
    ...redactedStdout.blockingSecrets,
    ...redactedStderr.blockingSecrets,
  ])];
  const total = Object.values(categories).reduce((sum, count) => sum + count, 0);

  const report: ReproPackReport = {
    schemaVersion: SCHEMA_VERSION,
    producer: { name: "repropack", version: REPROPACK_VERSION },
    createdAt: new Date().toISOString(),
    command: {
      argv: commandParts.map((part) => part.value),
      cwd: redactedCwd.value,
      exitCode,
      signal,
      durationMs,
      timedOut,
    },
    environment: collectEnvironment(),
    repository: collectRepository(options.cwd),
    output: {
      stdout: redactedStdout.value,
      stderr: redactedStderr.value,
      stdoutTruncated: stdout.truncated || redactedStdout.truncatedAfterRedaction,
      stderrTruncated: stderr.truncated || redactedStderr.truncatedAfterRedaction,
      encodingIssues: redactedStdout.encodingIssues || redactedStderr.encodingIssues,
    },
    redaction: { total, categories, residualWarnings },
  };

  return { report, blockingSecrets };
}
