import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("plugin metadata exposes Agentic Runner as an upper control-plane, not a peer generator", () => {
  const plugin = JSON.parse(readFileSync(path.join(REPO_ROOT, ".codex-plugin", "plugin.json"), "utf8"));
  const metadata = JSON.stringify(plugin);

  assert.match(metadata, /upper control-plane|control-plane/i);
  assert.match(metadata, /subordinate execution workflows/i);
  assert.match(metadata, /coding-agents/);
  assert.match(metadata, /Agentic StructCiv/);
  assert.match(metadata, /CodexVideo/);
  assert.match(metadata, /controlled_workflows/);
  assert.match(metadata, /execution_owner/);
  assert.match(metadata, /cross-workflow audit/i);
  assert.match(metadata, /instead of duplicating specialist execution/i);
});

test("agent metadata routes known subordinate workflows under Agentic Runner control", () => {
  const text = readFileSync(path.join(REPO_ROOT, "agents", "openai.yaml"), "utf8");

  assert.match(text, /upper control-plane above subordinate execution workflows/);
  assert.match(text, /coding-agents for code\/debug\/source repair/);
  assert.match(text, /Agentic StructCiv for article\/BLOG\/WordPress\/SWELL/);
  assert.match(text, /CodexVideo for video\/short\/voice\/narration/);
  assert.match(text, /Agentic Runner owns routing, stateful handoff, supervision, resume decisions, and final cross-workflow audit/);
  assert.match(text, /Mixed routes require --specialist-owner|mixed routes to name --specialist-owner/i);
  assert.match(text, /orchestrate as control-plane route state only/i);
});

test("skill contract preserves control-plane routing and subordinate ownership boundaries", () => {
  const text = readFileSync(path.join(REPO_ROOT, "skills", "agentic-runner", "SKILL.md"), "utf8");

  assert.match(text, /## Specialist Workflow Routing/);
  assert.match(text, /Agentic Runner is the upper control-plane/);
  assert.match(text, /coding-agents.*subordinate execution workflow for code generation, debugging, source repair/s);
  assert.match(text, /Agentic StructCiv.*subordinate execution workflow for article, BLOG, WordPress, SWELL/s);
  assert.match(text, /CodexVideo.*subordinate execution workflow for video, short-form production/s);
  assert.match(text, /Mixed routes require it before appending runner state/);
  assert.match(text, /orchestrate.*never accepts `--runner`/s);
  assert.match(text, /If a proposed implementation makes Agentic Runner generate code, articles, or video directly.*reconsider the route/s);
});
