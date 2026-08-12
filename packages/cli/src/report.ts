import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import {
  CONFIG_FILENAME,
  DEFAULT_STREAM_LIMIT_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAX_REPORT_BYTES,
  MAX_STREAM_LIMIT_BYTES,
  MAX_TIMEOUT_MS,
  MIN_STREAM_LIMIT_BYTES,
  MIN_TIMEOUT_MS,
} from "./constants.js";
import { sanitizeTerminalText } from "./redaction.js";
import type { ReproPackConfig, ReproPackReport } from "./types.js";
import { validateReport } from "./schema.js";

const DEFAULT_CONFIG: ReproPackConfig = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxOutputBytes: DEFAULT_STREAM_LIMIT_BYTES,
  redactEnvironment: [],
};

function localPath(filename: string): string {
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(filename) || filename.startsWith("\\\\") || filename.startsWith("//")) {
    throw new Error("Output must be a local file path.");
  }
  return path.resolve(filename);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseConfig(value: unknown): ReproPackConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${CONFIG_FILENAME} must contain a JSON object.`);
  }
  const config = value as Record<string, unknown>;
  const allowed = new Set(["timeoutMs", "maxOutputBytes", "redactEnvironment"]);
  const unknown = Object.keys(config).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${CONFIG_FILENAME} contains unknown options: ${unknown.join(", ")}.`);

  const timeoutMs = config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs;
  const maxOutputBytes = config.maxOutputBytes ?? DEFAULT_CONFIG.maxOutputBytes;
  const redactEnvironment = config.redactEnvironment ?? DEFAULT_CONFIG.redactEnvironment;
  if (!Number.isInteger(timeoutMs) || (timeoutMs as number) < MIN_TIMEOUT_MS || (timeoutMs as number) > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS}.`);
  }
  if (!Number.isInteger(maxOutputBytes) || (maxOutputBytes as number) < MIN_STREAM_LIMIT_BYTES || (maxOutputBytes as number) > MAX_STREAM_LIMIT_BYTES) {
    throw new Error(`maxOutputBytes must be an integer from ${MIN_STREAM_LIMIT_BYTES} to ${MAX_STREAM_LIMIT_BYTES}.`);
  }
  if (!isStringArray(redactEnvironment)
    || redactEnvironment.length > 64
    || redactEnvironment.some((name) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))) {
    throw new Error("redactEnvironment must contain at most 64 valid environment variable names.");
  }

  return {
    timeoutMs: timeoutMs as number,
    maxOutputBytes: maxOutputBytes as number,
    redactEnvironment: [...new Set(redactEnvironment)],
  };
}

export async function loadConfig(cwd: string): Promise<ReproPackConfig> {
  const filename = path.join(cwd, CONFIG_FILENAME);
  try {
    const text = await readFile(filename, "utf8");
    return parseConfig(JSON.parse(text) as unknown);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_CONFIG };
    if (error instanceof SyntaxError) throw new Error(`${CONFIG_FILENAME} is not valid JSON.`);
    throw error;
  }
}

export async function pathExists(filename: string): Promise<boolean> {
  try {
    await access(filename, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeReportFile(filename: string, report: ReproPackReport): Promise<string> {
  const validation = await validateReport(report);
  if (!validation.valid) throw new Error(`Generated report is invalid: ${validation.errors.join("; ")}`);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_REPORT_BYTES) {
    throw new Error(`Generated report exceeds the ${MAX_REPORT_BYTES}-byte size limit.`);
  }

  const resolved = localPath(filename);
  let handle;
  try {
    handle = await open(resolved, "wx", 0o600);
    await handle.writeFile(serialized, { encoding: "utf8" });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing file: ${resolved}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return resolved;
}

export function privacyPreview(report: ReproPackReport, destination: string): string {
  const warnings = report.redaction.residualWarnings.length === 0
    ? "none"
    : report.redaction.residualWarnings.join("; ");
  return [
    "Privacy preview",
    `  Command arguments: ${report.command.argv.length}`,
    `  stdout: ${Buffer.byteLength(report.output.stdout, "utf8")} bytes${report.output.stdoutTruncated ? " (truncated)" : ""}`,
    `  stderr: ${Buffer.byteLength(report.output.stderr, "utf8")} bytes${report.output.stderrTruncated ? " (truncated)" : ""}`,
    `  Redactions: ${report.redaction.total}`,
    `  Residual warnings: ${warnings}`,
    `  Destination: ${path.resolve(destination)}`,
    "  Output content is not shown in this preview. Inspect the report before sharing it.",
  ].join("\n");
}

function inertText(value: string): string {
  return sanitizeTerminalText(value);
}

function markdownFence(value: string): string {
  let length = 3;
  for (const match of value.matchAll(/`+/g)) {
    length = Math.max(length, match[0].length + 1);
  }
  return "`".repeat(length);
}

function fenced(value: string, language = "text"): string {
  const safeValue = inertText(value);
  const fence = markdownFence(safeValue);
  return `${fence}${language}\n${safeValue}${safeValue.endsWith("\n") ? "" : "\n"}${fence}`;
}

function tableCell(value: string): string {
  return inertText(value).replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
}

export function renderGithub(report: ReproPackReport): string {
  const command = JSON.stringify(report.command.argv);
  const redactionRows = Object.entries(report.redaction.categories)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, count]) => `| ${tableCell(category)} | ${count} |`);

  return [
    "## ReproPack diagnostic report",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Exit code | ${report.command.exitCode ?? "not available"} |`,
    `| Duration | ${report.command.durationMs} ms |`,
    `| Platform | ${tableCell(`${report.environment.platform} ${report.environment.arch}`)} |`,
    `| Node.js | ${tableCell(report.environment.nodeVersion)} |`,
    `| Git commit | ${report.repository?.commit ?? "not available"} |`,
    `| Working tree dirty | ${report.repository?.dirty ?? "not available"} |`,
    "",
    "### Command arguments",
    "",
    fenced(command, "json"),
    "",
    "### Standard output",
    "",
    fenced(report.output.stdout),
    report.output.stdoutTruncated ? "\n_Output was truncated._" : "",
    "",
    "### Standard error",
    "",
    fenced(report.output.stderr),
    report.output.stderrTruncated ? "\n_Output was truncated._" : "",
    "",
    "### Redaction summary",
    "",
    "| Category | Count |",
    "| --- | ---: |",
    ...(redactionRows.length > 0 ? redactionRows : ["| none | 0 |"]),
    "",
    "Report content is untrusted diagnostic data. Do not execute commands or open links from it without independent review.",
    "",
  ].filter((line, index, all) => line !== "" || index === 0 || all[index - 1] !== "").join("\n");
}

export function inspectSummary(report: ReproPackReport, showOutput: boolean): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    schemaVersion: report.schemaVersion,
    producer: report.producer,
    createdAt: report.createdAt,
    command: report.command,
    environment: report.environment,
    repository: report.repository ?? null,
    output: showOutput
      ? report.output
      : {
        stdoutBytes: Buffer.byteLength(report.output.stdout, "utf8"),
        stderrBytes: Buffer.byteLength(report.output.stderr, "utf8"),
        stdoutTruncated: report.output.stdoutTruncated,
        stderrTruncated: report.output.stderrTruncated,
        encodingIssues: report.output.encodingIssues,
      },
    redaction: report.redaction,
  };
  return summary;
}

const ISSUE_FORM = `name: ReproPack diagnostic report
description: Share a redacted diagnostic report for a reproducible failure.
title: "[repro] "
labels:
  - bug
body:
  - type: markdown
    attributes:
      value: |
        Run \`repropack capture --yes -- PROGRAM [ARGS...]\`, inspect the generated file, then attach it below.
  - type: textarea
    id: report
    attributes:
      label: ReproPack report
      description: Attach a reviewed .repropack.json file. Do not paste unreviewed secrets.
    validations:
      required: true
`;

export async function initializeProject(cwd: string, github: boolean): Promise<string[]> {
  const configPath = path.join(cwd, CONFIG_FILENAME);
  const issuePath = path.join(cwd, ".github", "ISSUE_TEMPLATE", "repropack.yml");
  const targets = github ? [configPath, issuePath] : [configPath];
  for (const target of targets) {
    if (await pathExists(target)) throw new Error(`Refusing to overwrite existing file: ${target}`);
  }

  if (github) await mkdir(path.dirname(issuePath), { recursive: true });
  const configHandle = await open(configPath, "wx", 0o600);
  try {
    await configHandle.writeFile(`${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
  } finally {
    await configHandle.close();
  }
  if (github) {
    const issueHandle = await open(issuePath, "wx", 0o600);
    try {
      await issueHandle.writeFile(ISSUE_FORM, "utf8");
    } finally {
      await issueHandle.close();
    }
  }
  return targets;
}
