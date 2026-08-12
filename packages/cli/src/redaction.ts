import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RedactionContext {
  workspace?: string;
  home?: string;
  environment?: NodeJS.ProcessEnv;
  extraEnvironmentNames?: string[];
}

export interface RedactionResult {
  value: string;
  categories: Record<string, number>;
  residualWarnings: string[];
  blockingSecrets: string[];
  encodingIssues: boolean;
}

interface MutableRedactionState {
  categories: Record<string, number>;
}

const SENSITIVE_ENV_NAME = /(?:token|secret|password|passwd|pwd|api[_-]?key|authorization|cookie|session|client[_-]?secret|private[_-]?key)/i;

const ANSI_SEQUENCE = /(?:\u001B\][^\u0007]*(?:\u0007|\u001B\\)|\u001B[@-_][0-?]*[ -/]*[@-~]|\u009B[0-?]*[ -/]*[@-~])/g;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const DIRECTIONAL_CONTROL = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

const HIGH_CONFIDENCE_PATTERNS: Array<[string, RegExp]> = [
  ["private-key", /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g],
  ["openai-token", /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["jwt", /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function increment(state: MutableRedactionState, category: string, amount = 1): void {
  state.categories[category] = (state.categories[category] ?? 0) + amount;
}

function replacePattern(
  input: string,
  pattern: RegExp,
  replacement: string | ((...args: string[]) => string),
  category: string,
  state: MutableRedactionState,
): string {
  return input.replace(pattern, (...args: string[]) => {
    increment(state, category);
    return typeof replacement === "function" ? replacement(...args) : replacement;
  });
}

function replaceLiteral(
  input: string,
  literal: string | undefined,
  replacement: string,
  category: string,
  state: MutableRedactionState,
  ignoreCase = false,
): string {
  if (!literal || literal.length < 3) {
    return input;
  }

  const pattern = new RegExp(escapeRegExp(literal), ignoreCase ? "gi" : "g");
  return replacePattern(input, pattern, replacement, category, state);
}

function pathVariants(value: string): string[] {
  const resolved = path.resolve(value);
  const roots = [resolved];
  try {
    roots.push(realpathSync.native(resolved));
  } catch {
    // Nonexistent or inaccessible paths still retain their lexical variants.
  }

  const variants = roots.flatMap((root) => [
    root,
    root.replaceAll("\\", "/"),
    root.replaceAll("/", "\\"),
  ]);
  return [...new Set(variants)].sort((left, right) => right.length - left.length);
}

function redactPaths(input: string, context: RedactionContext, state: MutableRedactionState): string {
  let output = input;
  const ignoreCase = process.platform === "win32";

  for (const variant of pathVariants(context.workspace ?? process.cwd())) {
    output = replaceLiteral(output, variant, "<WORKSPACE>", "workspace-path", state, ignoreCase);
  }
  for (const variant of pathVariants(context.home ?? os.homedir())) {
    output = replaceLiteral(output, variant, "<HOME>", "home-path", state, ignoreCase);
  }

  output = replacePattern(
    output,
    /\\\\[^\\\s]+\\[^\s"']+|\b[A-Za-z]:\\[^\r\n"']+|\/(?:Users|home)\/[^/\s]+(?:\/[^\r\n"']*)?/g,
    (match: string) => (match.startsWith("\\\\") ? "<UNC_PATH>" : "<ABS_PATH>"),
    "absolute-path",
    state,
  );

  return output;
}

function environmentSecretValues(context: RedactionContext): string[] {
  const environment = context.environment ?? process.env;
  const requested = new Set(context.extraEnvironmentNames ?? []);
  const values: string[] = [];

  for (const [name, value] of Object.entries(environment)) {
    if (!value || value.length < 4) {
      continue;
    }
    if (SENSITIVE_ENV_NAME.test(name) || requested.has(name)) {
      values.push(value);
    }
  }

  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

function redactCredentials(input: string, context: RedactionContext, state: MutableRedactionState): string {
  let output = input;

  for (const [category, pattern] of HIGH_CONFIDENCE_PATTERNS) {
    output = replacePattern(output, pattern, `<REDACTED:${category}>`, category, state);
  }

  output = replacePattern(
    output,
    /\b(Authorization\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,;]+/gi,
    (_match: string, prefix: string) => `${prefix}<REDACTED:authorization>`,
    "authorization",
    state,
  );
  output = replacePattern(
    output,
    /\b((?:Set-)?Cookie\s*[:=]\s*)[^\r\n]+/gi,
    (_match: string, prefix: string) => `${prefix}<REDACTED:cookie>`,
    "cookie",
    state,
  );
  output = replacePattern(
    output,
    /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    (_match: string, scheme: string) => `${scheme}<REDACTED:url-credentials>@`,
    "url-credentials",
    state,
  );
  output = replacePattern(
    output,
    /(["']?(?:token|secret|password|passwd|pwd|api[_-]?key|authorization|cookie|session|client[_-]?secret)["']?\s*[:=]\s*["']?)(?!<REDACTED:)([^\s"',;}{]{4,})/gi,
    (_match: string, prefix: string) => `${prefix}<REDACTED:keyed-secret>`,
    "keyed-secret",
    state,
  );
  output = replacePattern(
    output,
    /(\s--?(?:token|secret|password|passwd|pwd|api[_-]?key|authorization|cookie|session|client[_-]?secret)(?:=|\s+))([^\s]+)/gi,
    (_match: string, prefix: string) => `${prefix}<REDACTED:cli-secret>`,
    "cli-secret",
    state,
  );

  for (const value of environmentSecretValues(context)) {
    output = replaceLiteral(output, value, "<REDACTED:environment>", "environment-secret", state);
  }

  return output;
}

export function scanResidualSecrets(value: string): { blocking: string[]; warnings: string[] } {
  const blocking: string[] = [];
  for (const [category, pattern] of HIGH_CONFIDENCE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      blocking.push(category);
    }
    pattern.lastIndex = 0;
  }

  const warnings: string[] = [];
  const candidates = value.match(/\b[A-Za-z0-9+/=_-]{40,}\b/g) ?? [];
  if (candidates.some((candidate) => /[A-Za-z]/.test(candidate) && /\d/.test(candidate))) {
    warnings.push("A long high-entropy value remains; review the report before sharing it.");
  }

  return { blocking: [...new Set(blocking)], warnings };
}

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(ANSI_SEQUENCE, "")
    .replace(CONTROL_CHARACTER, "")
    .replace(DIRECTIONAL_CONTROL, "");
}

export function redactText(input: string | Buffer, context: RedactionContext = {}): RedactionResult {
  const decoded = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  const encodingIssues = decoded.includes("\uFFFD");
  const state: MutableRedactionState = { categories: {} };

  let value = replacePattern(decoded, ANSI_SEQUENCE, "", "terminal-control", state);
  value = replacePattern(value, CONTROL_CHARACTER, "", "control-character", state);
  value = replacePattern(value, DIRECTIONAL_CONTROL, "", "directional-control", state);
  value = redactPaths(value, context, state);
  value = redactCredentials(value, context, state);

  const residual = scanResidualSecrets(value);
  return {
    value,
    categories: state.categories,
    residualWarnings: residual.warnings,
    blockingSecrets: residual.blocking,
    encodingIssues,
  };
}

export function mergeCategoryCounts(...counts: Array<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const count of counts) {
    for (const [category, amount] of Object.entries(count)) {
      merged[category] = (merged[category] ?? 0) + amount;
    }
  }
  return merged;
}
