import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function temporaryDirectory(prefix = "repropack test ") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export function validReport(overrides = {}) {
  const report = {
    schemaVersion: "1.0.0",
    producer: { name: "repropack", version: "0.1.0" },
    createdAt: "2026-08-12T00:00:00.000Z",
    command: {
      argv: ["node", "test.js"],
      cwd: "<WORKSPACE>",
      exitCode: 1,
      signal: null,
      durationMs: 25,
      timedOut: false,
    },
    environment: {
      platform: process.platform,
      release: "test-release",
      arch: process.arch,
      nodeVersion: process.version,
      npmVersion: "11.0.0",
    },
    repository: {
      commit: "0123456789abcdef0123456789abcdef01234567",
      dirty: false,
      packageManager: "npm@11.0.0",
      lockfile: {
        name: "package-lock.json",
        sha256: "a".repeat(64),
      },
    },
    output: {
      stdout: "hello\n",
      stderr: "failure\n",
      stdoutTruncated: false,
      stderrTruncated: false,
      encodingIssues: false,
    },
    redaction: {
      total: 1,
      categories: { "workspace-path": 1 },
      residualWarnings: [],
    },
  };
  return deepMerge(report, overrides);
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return overrides;
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === "object" && !Array.isArray(value)
      && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function writeReport(directory, report = validReport(), name = "failure.repropack.json") {
  const filename = path.join(directory, name);
  await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return filename;
}
