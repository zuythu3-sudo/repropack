# Troubleshooting

## ReproPack says the program could not be started

Everything after `--` is passed as an argument vector. The first value must name
an executable available from the current environment or an executable path.

```sh
repropack capture -- node ./scripts/check.mjs --verbose
```

Shell syntax is intentionally not interpreted. `cd`, aliases, pipelines,
redirection, wildcards, and environment assignment are shell features rather than
executables. When shell behavior is genuinely required, invoke the shell
explicitly and review its quoting rules; ReproPack does not make shell input safe.

## Options intended for the program are parsed by ReproPack

Add `--` before the program name. ReproPack options go before it, and every token
after it belongs to the captured program.

```sh
repropack capture --output lint.repropack.json -- npm run lint -- --fix-dry-run
```

## A failing command leaves the terminal with a non-zero status

That is expected. After it safely writes the report, `capture` preserves the
captured program's exit code. In CI, run upload or validation as a later step with
the workflow's appropriate failure condition; do not hide the original failure
unless that is intentional.

## No report was written

Check the message immediately above the exit. ReproPack refuses to write when:

- the output path already exists;
- confirmation is required but input is non-interactive (use `--yes` only after
  accepting the privacy tradeoff);
- a high-confidence secret remains after redaction;
- the requested program cannot be started;
- the report would exceed the 3 MiB limit; or
- the destination cannot be written safely.

Do not work around a secret warning by posting raw output. Remove the source of the
secret, rotate it if it was exposed, and capture again with a synthetic value.

## Output is truncated

stdout and stderr are each limited to 1 MiB by default. The report records the
corresponding truncation flag. Narrow the failing command's output or reproduce the
smallest failing case instead of raising limits solely to collect unrelated logs.

## Paths are still visible

ReproPack replaces the current workspace, home directory, common absolute paths,
drive paths, and UNC paths. Relative paths, mount aliases, filenames, and paths in
unexpected formats can remain. Use `inspect --show-output`, then remove or replace
identifying data before sharing the report.

## Validation reports an unsupported or unknown field

Check `schemaVersion` and the CLI version that produced the file. Version 1 uses a
closed schema, so hand-edited fields and producer-specific extensions are invalid.
Upgrade the reader if the producer uses a newer supported schema; otherwise ask
for a report generated with a compatible ReproPack release.

Do not delete fields until the file happens to validate. Required fields and their
meaning are documented in [report-format.md](report-format.md).

## Validation rejects a large or deeply nested file

Reports are limited to 3 MiB and a JSON depth of 20 before schema validation.
These are safety limits, not configurable reader preferences. Generate a fresh
report rather than manually embedding additional logs or attachments.

## `npmVersion` or repository fields are missing

`npmVersion` may be `null` if npm is unavailable. Repository metadata is optional
when the working directory is not a Git repository or safe local inspection
fails. ReproPack does not contact a Git remote to fill missing data.

## GitHub Action cannot read the report

The `path` input must resolve to a regular file inside `GITHUB_WORKSPACE`. Absolute
paths outside the checkout, URLs, directories, broken links, and symlinks that
escape the workspace are rejected. Make sure checkout or report generation runs
before validation.

Keep workflow permissions at `contents: read`. Do not switch to
`pull_request_target` to gain access to a report supplied by an untrusted pull
request; see the [threat model](threat-model.md).

## The report validates but still looks sensitive

Validation checks structure, limits, and supported format—not whether every string
is appropriate to publish. Treat the report as private until a person has reviewed
the command, output, environment facts, repository facts, and residual warnings.
