import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(root, "packages", "cli", "dist", "bin.js");
const destination = path.join(root, "docs", "assets", "terminal-demo.svg");
const temporary = await mkdtemp(path.join(os.tmpdir(), "repropack-demo-"));

try {
  const fixture = path.join(temporary, "synthetic-failure.mjs");
  const report = path.join(temporary, "failure.repropack.json");
  await writeFile(fixture, [
    'process.stdout.write("Bundling synthetic project...\\n");',
    'process.stderr.write(`Error: build failed in ${process.cwd()}\\n`);',
    'process.stderr.write("api_key=sk-demo0123456789abcdef\\n");',
    "process.exitCode = 7;",
    "",
  ].join("\n"), "utf8");

  const capture = await run([cli, "capture", "--yes", "--output", report, "--", process.execPath, fixture], temporary);
  const inspect = await run([cli, "inspect", report, "--show-output"], temporary);
  const validate = await run([cli, "validate", report, "--strict"], temporary);
  const reportText = await readFile(report, "utf8");

  if (capture.code !== 7 || inspect.code !== 0 || validate.code !== 0) {
    throw new Error("Demo commands returned unexpected exit codes.");
  }
  if (reportText.includes("sk-demo") || !reportText.includes("<REDACTED:openai-token>") || !reportText.includes("<WORKSPACE>")) {
    throw new Error("Demo report did not satisfy its redaction assertions.");
  }

  const slides = [
    ["$ repropack capture --yes --output failure.repropack.json -- node synthetic-failure.mjs", ...lines(capture.output)],
    ["$ repropack inspect failure.repropack.json --show-output", ...lines(inspect.output)],
    ["$ repropack validate failure.repropack.json --strict", ...lines(validate.output), "", "[OK] Strict validation passed"],
  ].map((slide) => slide.slice(0, 16));

  await writeFile(destination, renderSvg(slides), "utf8");
  process.stdout.write(`Wrote ${destination}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: process.env, shell: false, windowsHide: true });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output: Buffer.concat(chunks).toString("utf8") }));
  });
}

function lines(value) {
  return value
    .replaceAll(temporary, "<DEMO_DIR>")
    .replace(/Created: .+/g, "Created: <TIMESTAMP>")
    .replace(/Platform: .+/g, "Platform: <PLATFORM> <ARCH>")
    .trim()
    .split(/\r?\n/u);
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderSvg(slides) {
  const groups = slides.map((slide, index) => {
    const rows = slide.map((line, row) => `<tspan x="48" dy="${row === 0 ? 0 : 27}">${escapeXml(line)}</tspan>`).join("");
    return `<g class="slide s${index + 1}"><text x="48" y="78">${rows}</text></g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1180" height="520" viewBox="0 0 1180 520" role="img" aria-labelledby="title description">
  <title id="title">ReproPack terminal demo</title>
  <desc id="description">A synthetic failure is captured, redacted, inspected, and strictly validated.</desc>
  <style>
    .slide { opacity: 0; animation: show 15s infinite; }
    .s2 { animation-delay: 5s; }
    .s3 { animation-delay: 10s; }
    text { fill: #d8e2ee; font: 18px Consolas, "Cascadia Mono", ui-monospace, monospace; }
    @keyframes show { 0%, 30% { opacity: 1; } 33.333%, 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .slide { animation: none; opacity: 0; } .s3 { opacity: 1; } }
  </style>
  <rect width="1180" height="520" rx="18" fill="#08121e"/>
  <rect x="1" y="1" width="1178" height="518" rx="17" fill="none" stroke="#2b4054" stroke-width="2"/>
  <circle cx="38" cy="30" r="7" fill="#ff5f57"/><circle cx="62" cy="30" r="7" fill="#febc2e"/><circle cx="86" cy="30" r="7" fill="#28c840"/>
  ${groups}
</svg>\n`;
}
