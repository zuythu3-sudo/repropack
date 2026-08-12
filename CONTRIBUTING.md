# Contributing to ReproPack

Thanks for helping improve ReproPack. Bug reports, platform-specific test cases,
documentation fixes, and small focused pull requests are especially useful.

## Before opening an issue

Search existing issues first. For a bug, include the ReproPack version, Node.js
version, operating system, expected behavior, and minimal reproduction. Remove
credentials, usernames, private paths, repository URLs, and proprietary output
before posting.

Use the private process in [SECURITY.md](SECURITY.md) for possible vulnerabilities
or redaction bypasses. Never attach a report containing a real secret to a public
issue, even when the issue concerns redaction.

## Development setup

Requirements:

- Node.js 20 or newer;
- npm with workspace support; and
- Git for repository metadata tests.

```sh
npm install
npm run typecheck
npm test
npm run test:security
npm run build
```

Run `npm run check` before submitting a pull request. The CLI build output is not
committed. The bundled JavaScript Action under `packages/action/dist` is committed
and must be regenerated when its source or bundled dependencies change.

## Pull requests

- Keep each pull request focused and explain the user-visible behavior.
- Add tests for fixes and new behavior, including Windows-specific cases when
  path or process handling changes.
- Preserve argument boundaries, the guarded Windows wrapper path, and the
  non-executing behavior of report readers.
- Update the schema and format documentation together when the public report
  shape changes.
- Add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for notable
  user-facing changes.
- Do not include real credentials, private diagnostic reports, or third-party
  logs in fixtures. Use unmistakably synthetic canary values.

The project uses conventional, direct commit subjects such as `feat:`, `fix:`,
`test:`, `docs:`, and `refactor:`. A maintainer may squash a pull request when it
keeps the history easier to follow.

## Report format changes

The `.repropack.json` format is a public interface. Changes must preserve these
rules:

- unknown fields remain invalid within v1;
- incompatible changes require a new schema major version;
- readers reject unsupported major versions instead of guessing; and
- no field may expose arbitrary environment variables, source content, hostnames,
  usernames, or Git remotes.

See [docs/report-format.md](docs/report-format.md) and
[docs/compatibility.md](docs/compatibility.md) before proposing a schema change.

## Security-sensitive changes

Changes to redaction, process spawning, parsing, output rendering, size limits,
or the GitHub Action need adversarial tests. Security fixtures must assert that
the original canary value is absent from reports, summaries, errors, and temporary
state—not only that a replacement marker appears.

By submitting a contribution, you agree that it may be licensed under the
Apache License 2.0 used by this repository.
