# GitHub Action

The ReproPack Action validates one existing `.repropack.json` file. It does not
run `capture`, execute the report's argv, read referenced paths, open URLs, or use
the network.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `path` | yes | — | Path to a report inside the checked-out GitHub workspace. |
| `strict` | no | `true` | Treat residual redaction warnings as validation errors. |

The resolved path must be a regular file and must remain inside
`GITHUB_WORKSPACE`, including after symlink resolution. URL-like inputs are
rejected.

## Workflow shape

Pin a versioned release or an immutable commit in the `uses:` value:

```yaml
name: Validate ReproPack report

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Validate report
        uses: zuythu3-sudo/repropack@v0.1.0
        with:
          path: examples/failure.repropack.json
          strict: true
```

For a stricter supply-chain policy, replace the version tag with the immutable
commit SHA associated with the release.

## Trust guidance

- Use the minimum `contents: read` permission.
- Do not pass URLs or paths outside the checkout.
- Do not interpolate report fields into `run:` steps.
- Do not use `pull_request_target` to process report content from an untrusted
  pull request.
- Treat successful validation as proof of format conformance only. It is not a
  malware scan, privacy guarantee, signature, or provenance check.

If a workflow needs to display report content, validate first and use ReproPack's
renderer locally in a separate, deliberately permissioned step. Never execute the
captured command automatically.
