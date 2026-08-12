# Threat model

ReproPack is designed for a common support workflow: a user runs a failing command,
reviews a locally generated report, and shares that report with a maintainer. The
command, its output, the local machine, and any report received from someone else
must be treated as separate trust boundaries.

## Security goals

ReproPack aims to:

- reduce accidental disclosure of common credentials, sensitive environment
  values, usernames, and absolute local paths;
- preserve argument boundaries and prevent unguarded shell interpolation when
  starting the requested program;
- bound captured output, report size, JSON nesting, and diagnostic work;
- render terminal output as inert text without active control sequences;
- validate and inspect reports without executing commands, opening URLs, reading
  referenced files, or using the network; and
- keep all capture and redaction work local.

## Non-goals

ReproPack does not:

- sandbox or make an untrusted program safe to run;
- guarantee detection of every secret, private name, or identifying string;
- encrypt, sign, authenticate, or establish the provenance of a report;
- collect files needed to reproduce an entire environment;
- replay commands from reports; or
- prevent another local process with the same or greater privileges from observing
  the command while it runs.

The person sharing a report remains responsible for reviewing it.

## Data flow

Capture processes command arguments, stdout, and stderr in this order:

1. decode and normalize UTF-8;
2. remove ANSI/OSC sequences and unsafe control characters;
3. replace workspace, home, absolute, and UNC paths;
4. replace known credential patterns and configured sensitive environment values;
5. apply stream and report-size limits; and
6. scan the final text again for high-confidence secrets and suspicious
   high-entropy values.

High-confidence secret material remaining after redaction blocks report creation.
Lower-confidence findings become residual warnings for manual review. Original
secret values and hashes of those values are never included in the report.

Sensitive environment-variable values are used only as in-memory redaction
needles. The environment-variable names and values are not serialized unless they
also appear in captured output and survive all matching, which is why manual
review remains required.

## Threats and mitigations

| Threat | Mitigation | Remaining risk |
| --- | --- | --- |
| Shell metacharacters in arguments | Native executables receive an argv with shell handling disabled. Windows batch wrappers reject command-interpreter metacharacters before using the required OS dispatcher. | A user can explicitly choose a shell as `PROGRAM`; that shell then interprets its own arguments. |
| Credentials in argv or logs | Known token formats, keyed values, headers, URL credentials, private keys, and sensitive environment values are replaced. | Novel, short, encoded, or fragmented secrets may not match. |
| Paths reveal identity or layout | Workspace, home, drive, POSIX home, and UNC paths are replaced with placeholders. | Relative paths, unusual mount layouts, and filenames may still be identifying. |
| Terminal escape or OSC injection | Escape sequences and unsafe controls are removed before storage and display. | Harmless Unicode can still be visually confusing; consumers must render output as text. |
| Malicious JSON exhausts resources | File size, depth, field length, item count, and schema limits are enforced. | Resource use within those limits is still possible. |
| Prototype pollution | Prototype-related keys and unknown schema fields are rejected. | Downstream tools that bypass validation need their own safe parser. |
| Report triggers execution or requests | Readers never execute argv, open URLs, resolve remote references, or fetch data. | A person can manually copy a malicious command; reports must remain untrusted. |
| Filesystem escape in CI | The Action accepts one regular local file whose resolved path remains inside `GITHUB_WORKSPACE`. | An unsafe workflow can grant broader permissions or run unrelated untrusted steps. |
| Accidental overwrite | Capture refuses an existing output path. | Write races and attacker-controlled directories are operating-system concerns; use a trusted workspace. |

## GitHub Actions

The validation Action needs only `contents: read`. It validates a file already in
the checked-out workspace and does not capture or replay anything. Do not use
`pull_request_target` to read a report from an untrusted pull-request checkout:
that event combines base-repository privileges with attacker-controlled content.

Validation establishes conformance to the report schema, not the safety or truth
of its contents. Workflows should not pass report fields into a shell, expression
evaluator, URL fetcher, or file path.

## Rendering

All report fields are attacker-controlled strings. The GitHub renderer must quote
or escape content so Markdown cannot create active links, HTML, mentions, nested
fences, or hidden control effects. Consumers building other renderers should apply
the same rule and must validate before rendering.

## Reporting problems

Potential redaction bypasses, command-injection paths, unsafe render output, or
parser denial-of-service cases should follow the private process in
[SECURITY.md](../SECURITY.md). Use synthetic canary values in reproductions.
