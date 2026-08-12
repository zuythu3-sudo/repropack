# repropack-cli

Command-line package for [ReproPack](https://github.com/zuythu3-sudo/repropack),
a local tool that turns a failing command into a reviewable, redacted
`.repropack.json` diagnostic report.

```sh
npm install --global repropack-cli@0.1.0
repropack capture --output failure.repropack.json -- npm test
repropack inspect failure.repropack.json --show-output
repropack validate failure.repropack.json --strict
```

Reports remain local unless you choose to share them. ReproPack does not upload
data, collect telemetry, or replay commands stored in reports. Automatic
redaction is not a privacy guarantee; inspect every report before publishing it.

The package includes the v1 JSON Schema through the `repropack-cli/schema`
export. The project is licensed under Apache-2.0. See the repository's
[security policy](https://github.com/zuythu3-sudo/repropack/security/policy) and
[documentation](https://github.com/zuythu3-sudo/repropack#readme) for details.
