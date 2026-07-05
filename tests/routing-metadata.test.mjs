import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DISCOVERY_TERMS = [
  /Agentic Runner/,
  /generic AGENT/i,
  /control-plane/i,
  /tool/i,
  /skill/i,
  /plugin/i,
  /workflow/i,
  /handoff/i,
  /resume/i,
  /audit/i,
  /supervised assignments/i,
];

const BINDING_UI_TERMS = /\b(?:must|requires?|required|owns?|gate|self-host)\b/i;

function assertDiscoveryTerms(text) {
  for (const term of DISCOVERY_TERMS) {
    assert.match(text, term);
  }
}

function yamlScalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  assert.ok(match, `missing YAML scalar: ${key}`);
  return match[1].trim();
}

test("plugin UI metadata stays concise without binding operational rules", () => {
  const plugin = JSON.parse(readFileSync(path.join(REPO_ROOT, ".codex-plugin", "plugin.json"), "utf8"));

  const defaultPrompt = plugin.interface.defaultPrompt.join("\n");
  const uiCopy = [
    plugin.description,
    plugin.interface.shortDescription,
    plugin.interface.longDescription,
    defaultPrompt,
  ].join("\n");
  const discoveryMetadata = JSON.stringify({
    description: plugin.description,
    keywords: plugin.keywords,
    interface: plugin.interface,
  });

  assertDiscoveryTerms(uiCopy);
  assert.doesNotMatch(uiCopy, BINDING_UI_TERMS);
  assert.doesNotMatch(discoveryMetadata, BINDING_UI_TERMS);
  assert.ok(plugin.description.length <= 180);
  assert.ok(plugin.interface.shortDescription.length <= 180);
  assert.ok(plugin.interface.longDescription.length <= 320);
  assert.ok(defaultPrompt.length <= 220);
});

test("agent UI metadata preserves discovery terms without binding gate text", () => {
  const text = readFileSync(path.join(REPO_ROOT, "agents", "openai.yaml"), "utf8");
  const uiCopy = [
    yamlScalar(text, "display_name"),
    yamlScalar(text, "short_description"),
    yamlScalar(text, "default_prompt"),
  ].join("\n");

  assertDiscoveryTerms(uiCopy);
  assert.doesNotMatch(uiCopy, BINDING_UI_TERMS);
  assert.ok(yamlScalar(text, "short_description").length <= 180);
  assert.ok(yamlScalar(text, "default_prompt").length <= 260);
});

test("skill contract preserves control-plane routing and subordinate ownership boundaries", () => {
  const text = readFileSync(path.join(REPO_ROOT, "skills", "agentic-runner", "SKILL.md"), "utf8");

  assert.match(text, /## Specialist Workflow Routing/);
  assert.match(text, /Agentic Runner is the generic AGENT upper control-plane/);
  assert.match(text, /Declared subordinate owners may be tools, skills, plugins, MCP\/app surfaces, specialist workflows, or future workflow ids/s);
  assert.match(text, /Built-in subordinate workflow examples include `coding-agents`.*Agentic StructCiv.*CodexVideo/s);
  assert.match(text, /controlled_workflows/);
  assert.match(text, /--controlled-workflows/);
  assert.match(text, /execution_owner/);
  assert.match(text, /Do not treat Agentic Runner as a peer of leaf tools, skills, plugins, or specialist workflows/);
  assert.match(text, /Mixed routes require it before appending runner state/);
  assert.match(text, /orchestrate.*never accepts `--runner`/s);
  assert.match(text, /If a proposed implementation makes Agentic Runner perform leaf execution directly.*reconsider the route/s);
  assert.match(text, /## Self-Host Gate/);
  assert.match(text, /Self-host mode is allowed only when all conditions are met/);
});
