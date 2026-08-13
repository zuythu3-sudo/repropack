# Changelog

All notable user-facing changes to ReproPack will be documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository `AGENTS.md` for Codex maintainer workflows
- Pull request template
- CI job that runs `zuythu3-sudo/codex-oss-kit` maintainer checks
- Pin the maintainer-check Action to `v0.3.2`

## [0.1.0] - 2026-08-12

### Added

- Initial CLI for capturing, inspecting, validating, and rendering diagnostic
  reports.
- Strict v1 JSON Schema for `.repropack.json` files.
- Local path and credential redaction with residual-risk warnings.
- Read-only GitHub Action for report validation.
- Codex triage skill for human-reviewed diagnostic analysis.

### Fixed

- Canonical filesystem aliases are redacted before reports are written.
- Test discovery remains compatible with Node.js 20 across supported platforms.
