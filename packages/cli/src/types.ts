export interface ProducerInfo {
  name: "repropack";
  version: string;
}

export interface CommandInfo {
  argv: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
}

export interface EnvironmentInfo {
  platform: NodeJS.Platform;
  release: string;
  arch: string;
  nodeVersion: string;
  npmVersion: string | null;
}

export interface LockfileInfo {
  name: "package-lock.json" | "npm-shrinkwrap.json" | "pnpm-lock.yaml" | "yarn.lock";
  sha256: string;
}

export interface RepositoryInfo {
  commit: string | null;
  dirty: boolean | null;
  packageManager: string | null;
  lockfile: LockfileInfo | null;
}

export interface OutputInfo {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  encodingIssues: boolean;
}

export interface RedactionInfo {
  total: number;
  categories: Record<string, number>;
  residualWarnings: string[];
}

export interface ReproPackReport {
  schemaVersion: "1.0.0";
  producer: ProducerInfo;
  createdAt: string;
  command: CommandInfo;
  environment: EnvironmentInfo;
  repository?: RepositoryInfo;
  output: OutputInfo;
  redaction: RedactionInfo;
}

export interface ValidationOptions {
  strict?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  report?: ReproPackReport;
}

export interface ReproPackConfig {
  timeoutMs: number;
  maxOutputBytes: number;
  redactEnvironment: string[];
}

export interface CaptureOptions {
  argv: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  redactEnvironment: string[];
}

export interface CaptureResult {
  report: ReproPackReport;
  blockingSecrets: string[];
}
