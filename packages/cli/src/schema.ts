import { open, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ErrorObject, ValidateFunction } from "ajv";

import { MAX_JSON_DEPTH, MAX_REPORT_BYTES } from "./constants.js";
import { scanResidualSecrets } from "./redaction.js";
import type { ReproPackReport, ValidationOptions, ValidationResult } from "./types.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const UNSAFE_STRING_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;

let validator: ValidateFunction<ReproPackReport> | undefined;

async function getValidator(): Promise<ValidateFunction<ReproPackReport>> {
  if (validator) return validator;

  const schemaPath = fileURLToPath(new URL("../schema/repropack.schema.json", import.meta.url));
  const schemaFile = await open(schemaPath, "r");
  try {
    const schemaText = await schemaFile.readFile({ encoding: "utf8" });
    const schema = JSON.parse(schemaText) as object;
    const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    const compiled = ajv.compile<ReproPackReport>(schema);
    validator = compiled;
    return compiled;
  } finally {
    await schemaFile.close();
  }
}

function safeJsonShape(value: unknown): string[] {
  const errors: string[] = [];
  const pending: Array<{ value: unknown; depth: number; location: string }> = [
    { value, depth: 0, location: "$" },
  ];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    if (typeof current.value === "string") {
      if (UNSAFE_STRING_CONTROL.test(current.value)) {
        errors.push(`${current.location}: contains an unsafe control character`);
      }
      continue;
    }
    if (typeof current.value !== "object" || current.value === null) continue;
    if (current.depth > MAX_JSON_DEPTH) {
      errors.push(`${current.location}: nesting exceeds ${MAX_JSON_DEPTH} levels`);
      continue;
    }

    for (const key of Object.keys(current.value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        errors.push(`${current.location}: forbidden property name ${JSON.stringify(key)}`);
        continue;
      }
      pending.push({
        value: (current.value as Record<string, unknown>)[key],
        depth: current.depth + 1,
        location: `${current.location}.${key}`,
      });
    }
  }
  return errors;
}

function formatAjvError(error: ErrorObject): string {
  const location = error.instancePath.length > 0 ? `$${error.instancePath}` : "$";
  return `${location}: ${error.message ?? "is invalid"}`;
}

export async function validateReport(value: unknown, options: ValidationOptions = {}): Promise<ValidationResult> {
  const shapeErrors = safeJsonShape(value);
  if (shapeErrors.length > 0) return { valid: false, errors: shapeErrors };

  const validate = await getValidator();
  if (!validate(value)) {
    return {
      valid: false,
      errors: (validate.errors ?? []).map(formatAjvError),
    };
  }

  const report = value;
  const errors: string[] = [];
  const residual = scanResidualSecrets(JSON.stringify(report));
  if (residual.blocking.length > 0) {
    errors.push(`report still contains high-confidence secret material (${residual.blocking.join(", ")})`);
  }

  const categoryTotal = Object.values(report.redaction.categories)
    .reduce((sum, count) => sum + count, 0);
  if (categoryTotal !== report.redaction.total) {
    errors.push("$.redaction.total: does not equal the sum of category counts");
  }

  if (options.strict && report.redaction.residualWarnings.length > 0) {
    errors.push("strict validation rejects reports with residual redaction warnings");
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, errors: [], report };
}

function rejectRemotePath(filename: string): void {
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(filename) || filename.startsWith("\\\\") || filename.startsWith("//")) {
    throw new Error("Report paths must be local files, not URLs or network paths.");
  }
}

export async function readReportFile(filename: string): Promise<unknown> {
  rejectRemotePath(filename);
  const resolved = await realpath(path.resolve(filename));
  const handle = await open(resolved, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error("Report path must point to a regular file.");
    if (stats.size > MAX_REPORT_BYTES) {
      throw new Error(`Report exceeds the ${MAX_REPORT_BYTES}-byte size limit.`);
    }
    const text = await handle.readFile({ encoding: "utf8" });
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Report is not valid JSON.");
    }
  } finally {
    await handle.close();
  }
}

export async function validateReportFile(
  filename: string,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  try {
    return await validateReport(await readReportFile(filename), options);
  } catch (error: unknown) {
    return { valid: false, errors: [error instanceof Error ? error.message : "Unable to read report."] };
  }
}
