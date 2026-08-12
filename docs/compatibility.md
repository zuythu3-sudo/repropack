# Compatibility

This document separates runtime support, report-format compatibility, and
behavior intended for automation.

## Runtime support

The CLI requires Node.js 20 or newer. The continuous-integration matrix covers:

| Operating system | Node.js versions |
| --- | --- |
| Windows | 20, 22, 24 |
| Linux | 20, 22, 24 |
| macOS | 20, 22, 24 |

Other Node.js platforms represented by the schema may work but are not part of
the primary test matrix. npm is used for distribution; reports can describe npm,
pnpm, and Yarn lockfiles without invoking those package managers.

ReproPack passes arguments directly to native target processes. Quoting rules
belong to the terminal that launches ReproPack, and shell operators such as `|`,
`&&`, redirection, wildcards, and variable expansion are not interpreted after
`--`. Windows `.cmd` and `.bat` wrappers require the operating-system command
dispatcher; ReproPack rejects interpreter metacharacters in that guarded path
instead of attempting ambiguous escaping.

UTF-8 is the report encoding on every platform. Invalid byte sequences in command
output are replaced and recorded with `output.encodingIssues`.

## CLI compatibility

The documented command names and long option names are public interfaces.
Backward-compatible options may be added in minor releases. Removing an option,
changing its meaning, or changing an automation-relevant exit behavior requires a
major CLI release.

Human-readable `inspect`, `validate`, and error text may improve between minor
releases. Automation should use `--json` where available and should not parse
human prose. New machine-readable diagnostic fields may be added compatibly;
consumers should ignore fields they do not use.

`capture` returns the captured program's exit code after successfully writing a
report. This makes a failing captured test remain a failing CI step. Failures that
occur before a report is safely written are ReproPack errors and must not be
treated as the captured program's result.

## Report compatibility

The report's `schemaVersion` is independent from the CLI package version. Readers:

- accept only schema versions they explicitly support;
- reject unknown fields in the closed v1 schema;
- reject unsupported major versions rather than attempting best-effort parsing;
  and
- apply parser size and depth limits before schema validation.

Producers must validate the complete report before writing it. A v1 report should
not rely on undocumented fields, comments, trailing commas, duplicate object keys,
or non-finite numbers.

## GitHub Action compatibility

Pin the Action to a versioned release or immutable commit in consuming workflows.
The Action runtime is Node.js 24, while report validation follows the bundled CLI
and schema version. The `path` input remains relative to the checked-out workspace;
URLs, directories, and paths that resolve outside the workspace are rejected.

## Pre-release policy

Before `1.0.0`, incompatible behavior may be corrected in a minor release when
necessary for security or to make the documented contract implementable. Such
changes are called out in [CHANGELOG.md](../CHANGELOG.md). Once `1.0.0` is
published, semantic-versioning compatibility applies to the CLI and package API.
