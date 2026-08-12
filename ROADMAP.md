# Roadmap

ReproPack's roadmap is organized by product area rather than fixed dates. Planned
work may change as command-line use, security testing, and contributor feedback
reveal better priorities.

## Capture reliability

- Expand process and signal handling tests across Windows, Linux, and macOS.
- Improve diagnostics for unavailable executables, timeouts, and interrupted
  captures.
- Add adapters only where they can preserve direct argument passing and the
  existing privacy boundary.

## Redaction and report safety

- Extend credential detectors with synthetic regression fixtures.
- Improve residual-risk scoring while keeping reports deterministic and local.
- Publish a compact corpus of safe, generated edge cases for parser and renderer
  testing.
- Continue fuzz and property testing for malformed JSON, control sequences, and
  output-boundary cases.

## Format and tooling

- Stabilize the v1 report schema and compatibility policy.
- Improve machine-readable validation output and editor support.
- Add examples for common package managers without collecting dependency names or
  source files.

## Maintainer workflows

- Refine GitHub issue rendering and the read-only validation Action.
- Expand the Codex triage skill's isolated test cases.
- Document patterns for using reports in bug templates and local support
  workflows.

ReproPack does not currently plan to add automatic report uploads, telemetry,
command replay from reports, or unattended issue submission. Proposals in those
areas require a new threat-model review before implementation.
