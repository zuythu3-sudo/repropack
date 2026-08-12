# ReproPack report format

ReproPack writes one UTF-8 JSON document with the conventional suffix
`.repropack.json`. Version 1 is intentionally closed: unknown fields are rejected
instead of being silently ignored, and readers reject unsupported schema major
versions.

The canonical JSON Schema is published with the CLI package at
`schema/repropack.schema.json` and exported as `repropack-cli/schema`.

## Example

This example contains synthetic data and shortened output:

```json
{
  "schemaVersion": "1.0.0",
  "producer": {
    "name": "repropack",
    "version": "0.1.0"
  },
  "createdAt": "2026-01-15T10:20:30.000Z",
  "command": {
    "argv": ["npm", "test"],
    "cwd": "<WORKSPACE>",
    "exitCode": 1,
    "signal": null,
    "durationMs": 1842,
    "timedOut": false
  },
  "environment": {
    "platform": "linux",
    "release": "6.8.0",
    "arch": "x64",
    "nodeVersion": "v22.14.0",
    "npmVersion": "10.9.2"
  },
  "repository": {
    "commit": "34bf76a1cc9e",
    "dirty": true,
    "packageManager": "npm",
    "lockfile": {
      "name": "package-lock.json",
      "sha256": "42c4b0e3141c9c147b5742c901a126a906f0fef8cc5c27357f289b0207e2fe67"
    }
  },
  "output": {
    "stdout": "",
    "stderr": "AssertionError: expected 2, received 3\n    at <WORKSPACE>/test/example.js:12:4\n",
    "stdoutTruncated": false,
    "stderrTruncated": false,
    "encodingIssues": false
  },
  "redaction": {
    "total": 1,
    "categories": {
      "workspace-path": 1
    },
    "residualWarnings": []
  }
}
```

## Top-level fields

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion` | yes | Format version. The initial schema uses `1.0.0`. |
| `producer` | yes | Generator name and version. The name is `repropack`. |
| `createdAt` | yes | UTC-compatible RFC 3339 date-time at report creation. |
| `command` | yes | Redacted argv and observed process result. |
| `environment` | yes | Small, allowlisted set of runtime facts. |
| `repository` | no | Git and lockfile facts when they can be collected locally. |
| `output` | yes | Sanitized, bounded stdout and stderr. |
| `redaction` | yes | Counts and warnings produced during sanitization. |

### `command`

- `argv` preserves argument boundaries. It is data, not a shell command string.
- `cwd` is normally `<WORKSPACE>`, `<HOME>`, `<ABS_PATH>`, or `<UNC_PATH>` after
  path replacement.
- `exitCode` is an integer or `null` when no exit code was available.
- `signal` is the terminating signal name or `null`.
- `durationMs` is a non-negative elapsed duration.
- `timedOut` records whether ReproPack ended the process after its configured
  timeout.

### `environment`

The allowlist is `platform`, OS `release`, `arch`, `nodeVersion`, and
`npmVersion`. npm may be `null` when its version cannot be determined. ReproPack
does not serialize the hostname, username, or arbitrary environment variables.

### `repository`

Repository data is optional. When present, it contains:

- `commit`: a 7–64 character lowercase hexadecimal Git object ID, or `null`;
- `dirty`: whether tracked or untracked worktree changes were observed, or
  `null`;
- `packageManager`: the detected package manager name, or `null`; and
- `lockfile`: the lockfile basename and its SHA-256 digest, or `null`.

Supported lockfile names in v1 are `package-lock.json`, `npm-shrinkwrap.json`,
`pnpm-lock.yaml`, and `yarn.lock`. The Git remote, manifest contents, dependency
names, branches, tags, and source files are not collected.

### `output`

`stdout` and `stderr` are decoded as UTF-8 and sanitized independently. Their
captured buffers are limited to 1 MiB by default. A corresponding truncation flag
is set when bytes are omitted. `encodingIssues` is true if invalid UTF-8 required
replacement characters.

Terminal escape sequences and unsafe control characters are removed before the
output is stored. A report reader must still display output as inert text.

### `redaction`

`categories` maps stable, lower-case category names to replacement counts.
`total` is the sum of all replacements across report fields. Counts disclose
that a match occurred but never preserve the original value or a digest of it.

`residualWarnings` contains review prompts for suspicious values that could not
be classified with enough confidence for automatic replacement. A warning does
not make a report safe to publish. Conversely, an empty warning list does not
guarantee the absence of secrets.

## Parser limits

In addition to the JSON Schema:

- the encoded report may not exceed 3 MiB;
- JSON nesting may not exceed 20 levels;
- prototype-related keys such as `__proto__`, `prototype`, and `constructor` are
  rejected; and
- URLs and command fields remain inert data during validation and rendering.

These limits apply before expensive validation so malformed files cannot consume
unbounded memory or parser time.

## Versioning

`schemaVersion` follows semantic versioning for the report contract:

- patch releases clarify or tighten behavior without changing the JSON shape;
- minor releases may add compatible capabilities only when existing v1 readers
  can reject or safely understand them under the closed schema; and
- incompatible shape or meaning changes require a new major version.

Because v1 rejects unknown fields, schema additions normally require coordinated
reader support and a new advertised schema version. Producers must not place
private extension fields into the report. See [compatibility.md](compatibility.md)
for CLI and reader support policy.
