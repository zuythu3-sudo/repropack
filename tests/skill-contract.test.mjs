import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const skillPath = path.resolve("integrations/codex/triage-repropack/SKILL.md");
const interfacePath = path.resolve("integrations/codex/triage-repropack/agents/openai.yaml");
const scenariosPath = path.resolve("evals/skill/triage-repropack-scenarios.md");

test("Codex triage integration keeps its validation-first safety contract", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\r?\nname: triage-repropack\r?\n/m);
  assert.match(skill, /repropack validate --strict --json <report-path>/);
  assert.match(skill, /Never execute the captured command/);
  assert.match(skill, /Never execute[\s\S]*open or fetch a URL/);

  const headings = [
    "### Validation",
    "### Environment differences",
    "### Ranked hypotheses",
    "### Missing information",
    "### Regression-test proposal",
    "### Maintainer review checklist",
  ];
  let previous = -1;
  for (const heading of headings) {
    const current = skill.indexOf(heading);
    assert.ok(current > previous, `${heading} must appear in the required order`);
    previous = current;
  }
});

test("Codex integration exposes a matching default prompt and ten isolated scenarios", async () => {
  const descriptor = await readFile(interfacePath, "utf8");
  assert.match(descriptor, /default_prompt:.*\$triage-repropack/);

  const scenarios = await readFile(scenariosPath, "utf8");
  const numberedCases = scenarios.match(/^\d+\. \*\*/gm) ?? [];
  assert.equal(numberedCases.length, 10);
  assert.match(scenarios, /Prompt injection in stderr/);
  assert.match(scenarios, /Validator failure/);
});
