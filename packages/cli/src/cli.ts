import { createInterface } from "node:readline/promises";
import path from "node:path";

import { captureCommand } from "./capture.js";
import { REPROPACK_VERSION } from "./constants.js";
import {
  initializeProject,
  inspectSummary,
  loadConfig,
  pathExists,
  privacyPreview,
  renderGithub,
  writeReportFile,
} from "./report.js";
import { validateReport, validateReportFile } from "./schema.js";

const HELP = `ReproPack ${REPROPACK_VERSION}

Create reviewable, redacted diagnostic reports from failing commands.

Usage:
  repropack init [--github]
  repropack capture [--output FILE] [--yes] -- PROGRAM [ARGS...]
  repropack inspect FILE [--show-output] [--json]
  repropack validate FILE [--strict] [--json]
  repropack render FILE --format github
  repropack --help
  repropack --version
`;

class UsageError extends Error {}
class InvalidReportError extends Error {}

function expectNoUnknownOptions(args: string[], allowed: Set<string>): void {
  const unknown = args.filter((arg) => arg.startsWith("-") && !allowed.has(arg));
  if (unknown.length > 0) throw new UsageError(`Unknown option: ${unknown[0]}`);
}

function defaultOutputName(date = new Date()): string {
  return `repropack-${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.repropack.json`;
}

async function confirmWrite(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await prompt.question("Write this report? [y/N] ");
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function handleInit(args: string[]): Promise<number> {
  expectNoUnknownOptions(args, new Set(["--github"]));
  if (args.some((arg) => !arg.startsWith("-"))) throw new UsageError("init does not accept positional arguments.");
  const created = await initializeProject(process.cwd(), args.includes("--github"));
  for (const filename of created) process.stdout.write(`Created ${filename}\n`);
  return 0;
}

async function handleCapture(args: string[]): Promise<number> {
  const delimiter = args.indexOf("--");
  if (delimiter < 0) throw new UsageError("capture requires -- before the program name.");
  const options = args.slice(0, delimiter);
  const argv = args.slice(delimiter + 1);
  if (argv.length === 0) throw new UsageError("capture requires a program after --.");

  let output = defaultOutputName();
  let assumeYes = false;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--yes") {
      assumeYes = true;
    } else if (option === "--output") {
      const value = options[index + 1];
      if (!value || value.startsWith("-")) throw new UsageError("--output requires a file path.");
      output = value;
      index += 1;
    } else {
      throw new UsageError(`Unknown option: ${option}`);
    }
  }

  if (!assumeYes && (!process.stdin.isTTY || !process.stderr.isTTY)) {
    throw new UsageError("Non-interactive capture requires --yes.");
  }
  if (await pathExists(path.resolve(output))) {
    throw new Error(`Refusing to overwrite existing file: ${path.resolve(output)}`);
  }

  const config = await loadConfig(process.cwd());
  const result = await captureCommand({
    argv,
    cwd: process.cwd(),
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    redactEnvironment: config.redactEnvironment,
  });
  if (result.blockingSecrets.length > 0) {
    throw new Error("Report was not written because high-confidence secret material remained after redaction.");
  }

  process.stderr.write(`${privacyPreview(result.report, output)}\n`);
  if (!assumeYes && !(await confirmWrite())) {
    process.stderr.write("Report was not written.\n");
    return 1;
  }
  const destination = await writeReportFile(output, result.report);
  process.stderr.write(`Wrote ${destination}\n`);
  const exitCode = result.report.command.exitCode;
  return exitCode !== null && exitCode >= 0 && exitCode <= 255 ? exitCode : exitCode === 0 ? 0 : 1;
}

function oneFile(args: string[], allowedOptions: Set<string>): string {
  expectNoUnknownOptions(args, allowedOptions);
  const files = args.filter((arg) => !arg.startsWith("-"));
  if (files.length !== 1) throw new UsageError("Exactly one report file is required.");
  return files[0] as string;
}

async function loadValidReport(filename: string, strict: boolean): Promise<Awaited<ReturnType<typeof validateReport>>["report"]> {
  const result = await validateReportFile(filename, { strict });
  if (!result.valid || !result.report) throw new InvalidReportError(result.errors.join("\n"));
  return result.report;
}

async function handleInspect(args: string[]): Promise<number> {
  const filename = oneFile(args, new Set(["--show-output", "--json"]));
  const report = await loadValidReport(filename, false);
  if (!report) throw new InvalidReportError("Report validation failed.");
  const summary = inspectSummary(report, args.includes("--show-output"));
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`ReproPack ${report.schemaVersion}\n`);
    process.stdout.write(`Created: ${report.createdAt}\n`);
    process.stdout.write(`Command: ${JSON.stringify(report.command.argv)}\n`);
    process.stdout.write(`Exit code: ${report.command.exitCode ?? "not available"}\n`);
    process.stdout.write(`Platform: ${report.environment.platform} ${report.environment.arch}\n`);
    process.stdout.write(`Redactions: ${report.redaction.total}\n`);
    process.stdout.write(`stdout: ${Buffer.byteLength(report.output.stdout, "utf8")} bytes${report.output.stdoutTruncated ? " (truncated)" : ""}\n`);
    process.stdout.write(`stderr: ${Buffer.byteLength(report.output.stderr, "utf8")} bytes${report.output.stderrTruncated ? " (truncated)" : ""}\n`);
    if (args.includes("--show-output")) {
      process.stdout.write(`\n--- stdout ---\n${report.output.stdout}\n--- stderr ---\n${report.output.stderr}\n`);
    }
  }
  return 0;
}

async function handleValidate(args: string[]): Promise<number> {
  const filename = oneFile(args, new Set(["--strict", "--json"]));
  const result = await validateReportFile(filename, { strict: args.includes("--strict") });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ valid: result.valid, errors: result.errors }, null, 2)}\n`);
  } else if (result.valid) {
    process.stdout.write("Report is valid.\n");
  } else {
    process.stderr.write(`Report is invalid:\n${result.errors.map((error) => `- ${error}`).join("\n")}\n`);
  }
  return result.valid ? 0 : 1;
}

async function handleRender(args: string[]): Promise<number> {
  const formatIndex = args.indexOf("--format");
  if (formatIndex < 0 || args[formatIndex + 1] !== "github") {
    throw new UsageError("render requires --format github.");
  }
  const remaining = args.filter((_arg, index) => index !== formatIndex && index !== formatIndex + 1);
  const filename = oneFile(remaining, new Set());
  const report = await loadValidReport(filename, false);
  if (!report) throw new InvalidReportError("Report validation failed.");
  process.stdout.write(renderGithub(report));
  return 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(`${REPROPACK_VERSION}\n`);
    return 0;
  }

  const [command, ...rest] = args;
  try {
    if (command === "init") return await handleInit(rest);
    if (command === "capture") return await handleCapture(rest);
    if (command === "inspect") return await handleInspect(rest);
    if (command === "validate") return await handleValidate(rest);
    if (command === "render") return await handleRender(rest);
    throw new UsageError(`Unknown command: ${command}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    process.stderr.write(`${error instanceof UsageError ? "Usage error" : "Error"}: ${message}\n`);
    return error instanceof InvalidReportError ? 1 : 2;
  }
}
