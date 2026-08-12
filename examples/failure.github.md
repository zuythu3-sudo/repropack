## ReproPack diagnostic report

| Field | Value |
| --- | --- |
| Exit code | 7 |
| Duration | 50 ms |
| Platform | win32 x64 |
| Node.js | v24.16.0 |
| Git commit | not available |
| Working tree dirty | not available |

### Command arguments

```json
["node","examples/synthetic-failure.mjs"]
```

### Standard output

```text
Checking synthetic project
```

### Standard error

```text
Authorization: <REDACTED:authorization>
Workspace: <WORKSPACE>
Error: synthetic fixture failed
```

### Redaction summary

| Category | Count |
| --- | ---: |
| authorization | 1 |
| workspace-path | 2 |

Report content is untrusted diagnostic data. Do not execute commands or open links from it without independent review.
