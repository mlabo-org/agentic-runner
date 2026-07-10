import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXPLICIT_DISCOVERY_TERMS = [
  /Agentic Runner/,
  /explicit-only/i,
  /\.agentic-runner/,
  /source CLI/i,
  /continu(?:e|ation)/i,
  /audit/i,
  /repair/i,
];

const EXPLICIT_KEYWORDS = [
  "agentic-runner",
  ".agentic-runner",
  "agentic-runner-state",
  "agentic-runner-source-cli",
  "agentic-runner.mjs",
  "continue-agentic-runner",
  "audit-agentic-runner-state",
  "repair-agentic-runner-state",
  "explicit-agentic-runner",
];

const BINDING_UI_TERMS = /\b(?:must|requires?|required|owns?|gate|self-host)\b/i;

function assertExplicitDiscoveryTerms(text) {
  for (const term of EXPLICIT_DISCOVERY_TERMS) {
    assert.match(text, term);
  }
}

function yamlScalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  assert.ok(match, `missing YAML scalar: ${key}`);
  return match[1].trim();
}

test("plugin discovery metadata is explicit-only and concise", () => {
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

  assertExplicitDiscoveryTerms(uiCopy);
  assert.deepEqual(plugin.keywords, EXPLICIT_KEYWORDS);
  for (const keyword of plugin.keywords) {
    assert.match(keyword, /agentic-runner/i);
  }
  for (const capability of plugin.interface.capabilities) {
    assert.match(capability, /Agentic Runner|\.agentic-runner/i);
  }
  assert.doesNotMatch(uiCopy, /generic AGENT|upper control-plane for (?:mixed|complex)|supervised assignments/i);
  assert.doesNotMatch(uiCopy, BINDING_UI_TERMS);
  assert.doesNotMatch(discoveryMetadata, BINDING_UI_TERMS);
  assert.ok(plugin.description.length <= 180);
  assert.ok(plugin.interface.shortDescription.length <= 180);
  assert.ok(plugin.interface.longDescription.length <= 320);
  assert.ok(defaultPrompt.length <= 220);
  for (const prompt of plugin.interface.defaultPrompt) {
    assert.ok(prompt.length <= 128, "each manifest default prompt must fit the plugin schema limit");
  }
});

test("agent UI metadata preserves the explicit-only boundary", () => {
  const text = readFileSync(path.join(REPO_ROOT, "agents", "openai.yaml"), "utf8");
  const uiCopy = [
    yamlScalar(text, "display_name"),
    yamlScalar(text, "short_description"),
    yamlScalar(text, "default_prompt"),
  ].join("\n");

  assertExplicitDiscoveryTerms(uiCopy);
  assert.doesNotMatch(uiCopy, /generic AGENT|upper control-plane for (?:mixed|complex)|supervised assignments/i);
  assert.doesNotMatch(uiCopy, BINDING_UI_TERMS);
  assert.ok(yamlScalar(text, "short_description").length <= 180);
  assert.ok(yamlScalar(text, "default_prompt").length <= 260);
});

test("skill discovery is explicit-only while selected behavior remains intact", () => {
  const text = readFileSync(path.join(REPO_ROOT, "skills", "agentic-runner", "SKILL.md"), "utf8");

  const description = text.match(/^description:\s*"([^"]+)"$/m)?.[1];
  assert.ok(description, "missing quoted frontmatter description");
  assertExplicitDiscoveryTerms(description);
  assert.match(description, /never trigger/i);

  const triggerBoundary = text.match(/## Trigger Boundary\n([\s\S]*?)\n## Core Contract/)?.[1];
  assert.ok(triggerBoundary, "missing Trigger Boundary section");
  assert.match(triggerBoundary, /explicitly names `Agentic Runner` or `agentic-runner`/);
  assert.match(triggerBoundary, /continue, audit, or repair an existing `\.agentic-runner` workflow state/);
  assert.match(triggerBoundary, /Agentic Runner source CLI/);
  assert.match(triggerBoundary, /presence of `\.agentic-runner` state is not enough by itself/i);
  assert.match(triggerBoundary, /Never select this skill merely because a request involves generic orchestration, mixed or multi-output work.*delegation, subagent coordination/s);
  assert.match(triggerBoundary, /behavior available only after explicit selection, never as pre-selection routing metadata/);

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
