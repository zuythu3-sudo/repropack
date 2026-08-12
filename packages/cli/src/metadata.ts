import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { EnvironmentInfo, LockfileInfo, RepositoryInfo } from "./types.js";

const LOCKFILES: LockfileInfo["name"][] = [
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

function runMetadataCommand(command: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function npmVersion(): string | null {
  const candidates = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "package.json"),
    path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(parsed.version)) {
        return parsed.version;
      }
    } catch {
      // npm is optional and is not necessarily installed beside Node.js.
    }
  }

  return null;
}

export function collectEnvironment(): EnvironmentInfo {
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    nodeVersion: process.version,
    npmVersion: npmVersion(),
  };
}

function detectLockfile(cwd: string): LockfileInfo | null {
  for (const name of LOCKFILES) {
    const filename = path.join(cwd, name);
    if (!existsSync(filename)) {
      continue;
    }

    try {
      const sha256 = createHash("sha256").update(readFileSync(filename)).digest("hex");
      return { name, sha256 };
    } catch {
      return null;
    }
  }
  return null;
}

function detectPackageManager(cwd: string, lockfile: LockfileInfo | null): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && "packageManager" in parsed) {
      const value = (parsed as { packageManager?: unknown }).packageManager;
      if (typeof value === "string" && /^(?:npm|pnpm|yarn|bun)@[A-Za-z0-9.+_-]{1,48}$/.test(value)) {
        return value;
      }
    }
  } catch {
    // A package manifest is optional metadata.
  }

  if (lockfile?.name === "pnpm-lock.yaml") return "pnpm";
  if (lockfile?.name === "yarn.lock") return "yarn";
  if (lockfile) return "npm";
  return null;
}

export function collectRepository(cwd: string): RepositoryInfo {
  const lockfile = detectLockfile(cwd);
  const commit = runMetadataCommand("git", ["rev-parse", "--verify", "HEAD"], cwd);
  const status = commit === null
    ? null
    : runMetadataCommand("git", ["status", "--porcelain=v1", "--untracked-files=normal"], cwd);

  return {
    commit: commit !== null && /^[0-9a-f]{7,64}$/i.test(commit) ? commit.toLowerCase() : null,
    dirty: status === null ? null : status.length > 0,
    packageManager: detectPackageManager(cwd, lockfile),
    lockfile,
  };
}
