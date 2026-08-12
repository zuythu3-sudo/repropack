import * as core from "@actions/core";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { validateReportFile } from "repropack-cli";

class SafeActionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SafeActionError";
  }
}

function isInsideWorkspace(workspace: string, candidate: string): boolean {
  const relativePath = relative(workspace, candidate);

  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

async function resolveLocalReport(input: string): Promise<string> {
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(input)) {
    throw new SafeActionError("The report path must be a local workspace file, not a URL.");
  }
  if (isAbsolute(input)) {
    throw new SafeActionError("The report path must be relative to the GitHub workspace.");
  }

  const workspace = await realpath(process.env.GITHUB_WORKSPACE ?? process.cwd());
  const lexicalCandidate = resolve(workspace, input);

  if (!isInsideWorkspace(workspace, lexicalCandidate)) {
    throw new SafeActionError("The report path must remain inside the GitHub workspace.");
  }

  let reportPath: string;
  try {
    reportPath = await realpath(lexicalCandidate);
  } catch {
    throw new SafeActionError("The report path does not point to a readable local file.");
  }

  if (!isInsideWorkspace(workspace, reportPath)) {
    throw new SafeActionError("The report path resolves outside the GitHub workspace.");
  }

  const reportStat = await stat(reportPath);
  if (!reportStat.isFile()) {
    throw new SafeActionError("The report path must point to a regular file.");
  }

  return reportPath;
}

function getStrictInput(): boolean {
  const value = core.getInput("strict", { trimWhitespace: true });
  return value === "" ? true : core.getBooleanInput("strict");
}

export async function run(): Promise<void> {
  try {
    const inputPath = core.getInput("path", {
      required: true,
      trimWhitespace: true,
    });
    const reportPath = await resolveLocalReport(inputPath);
    const result = await validateReportFile(reportPath, { strict: getStrictInput() });

    if (!result.valid) {
      core.setFailed(
        `ReproPack report validation failed with ${result.errors.length} error(s).`,
      );
      return;
    }

    core.info("ReproPack report is valid.");
  } catch (error: unknown) {
    if (error instanceof SafeActionError) {
      core.setFailed(error.message);
      return;
    }

    core.setFailed(
      "Unable to validate the ReproPack report. Ensure it is a readable local JSON file.",
    );
  }
}

void run();
