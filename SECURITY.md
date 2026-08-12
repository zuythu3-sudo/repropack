# Security policy

ReproPack handles command output that may contain credentials, local paths, and
attacker-controlled text. Security reports are welcome and should be handled
privately until a fix is available.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository.
If it is unavailable, open a minimal public issue asking for a private contact
channel. Do not include secrets, exploit payloads, private reports, or identifying
machine data in a public issue.

Include, when possible:

- the affected ReproPack version and operating system;
- the command or report shape needed to reproduce the problem, with secrets
  replaced by obvious test values;
- the observed impact and the expected safe behavior; and
- whether the issue is already being exploited or has been disclosed elsewhere.

Maintainers will acknowledge a complete report as soon as practical, coordinate
validation and remediation with the reporter, and publish release notes once a
fix is available. Please allow time for a supported release to be prepared before
public disclosure.

## Supported versions

Until the first stable release, security fixes are made on the latest published
minor release only. After `1.0.0`, this table will list supported release lines
explicitly.

## Security boundaries

- `repropack capture` executes the requested program with the invoking user's
  permissions. It is not a sandbox and does not make an untrusted command safe.
- Redaction is best-effort defense in depth. Users must inspect reports before
  sharing them.
- `inspect`, `validate`, `render`, and the GitHub Action must treat every report
  field as untrusted data and must never execute commands, open URLs, or fetch
  remote content from a report.
- A valid report is structurally valid, not necessarily trustworthy or safe to
  publish.

See [docs/threat-model.md](docs/threat-model.md) for the detailed trust model and
out-of-scope risks.
