# Agentic Runner Orchestration Purpose Spec

This purpose spec is a tracked source specification for the strategic purpose
of Agentic Runner. It is not workflow state, not a generated log, and not a
replacement for `.agentic-runner/` job state.

## Core Thesis

Agentic Runner exists to be a thin generic AGENT upper control-plane and
orchestration kernel for complex Codex work, not another specialist workflow
and not a generic content/code generator.

Its value is not that it can write code, draft articles, generate videos, or
run every task itself. Its value is that it can decide which declared tool,
skill, plugin, MCP/app surface, or already-specialized workflow should own each
part of a mixed request, preserve handoff state between them, and audit whether
the combined result is actually complete.

If Agentic Runner drifts into "one more execution workflow", it loses its
reason to exist. Code/debug/tool work can belong to `coding-agents`.
Article/SWELL/WordPress production can belong to `Agentic StructCiv`.
Video/TTS/Remotion production can belong to `CodexVideo`. Other domains can
belong to declared tools, skills, plugins, MCP/app surfaces, or future
specialist workflows.

Agentic Runner should coordinate those systems. The named workflows are
built-in examples, not the boundary of the control-plane. It should not compete
with leaf execution owners.

## Why It Can Look Unnecessary Today

In a single live Codex conversation, the parent agent can often route work
directly by reading `AGENTS.md`, plugin metadata, `SKILL.md` contracts, and
local repo state. For a one-off coding task, one article job, or one simple
tool build, Agentic Runner may add more ceremony than value.

That does not prove Agentic Runner is unnecessary. It proves that the parent
agent can still keep the orchestration in short-term working memory.

Agentic Runner becomes valuable when that working memory is not enough:

- the task crosses multiple specialist workflows;
- the task spans multiple threads, days, or restart points;
- the user wants to pause, sleep, resume, or hand off the job;
- source, cache, runtime, generated artifacts, and activation state must stay
  separated;
- subagents need bounded assignments, supervision, cancellation records, and
  integration evidence;
- completion depends on several workflows agreeing on handoff artifacts and
  verification;
- the user later asks why a route was chosen or whether Agentic Runner still
  has a purpose.

## Primary Responsibilities

Agentic Runner should own these responsibilities:

- classify a vague user request into built-in route classes such as article,
  coding, video, plugin-source, mixed, or unknown, while allowing additional
  declared controlled workflow ids;
- select the primary execution owner instead of reimplementing it;
- create and preserve handoff material between declared execution owners;
- record `task_id`, `epoch`, scope, non-goals, route state, owners, and stop
  conditions for resumed work;
- track which tool, skill, plugin, or workflow owns which artifact and which
  verification;
- supervise subagent lifecycle, finite delegation depth, and cancellation
  reasons when the work is delegated;
- detect when a specialist workflow must pause for a source hotfix, runtime
  repair, cache/activation boundary, or user confirmation;
- decide where to resume after a specialist workflow returns;
- audit completion across workflow boundaries, not only inside one specialist
  workflow;
- enforce self-host and source-change gates when Agentic Runner is asked to
  modify itself.

## Execution Owner Boundary

Agentic Runner must preserve leaf execution ownership:

- `coding-agents` owns code changes, debugging, tool implementation, source
  edits, root-cause repair, Coding Conduct Gate evidence, and code-facing
  verification.
- `Agentic StructCiv` owns BLOG/article production, Pre-StructCiv planning,
  editorial loops, SWELL decoration, WordPress handoff, article visuals, ALT,
  and publish-bound artifact gates.
- `CodexVideo` owns short/long video generation, source-to-video normalization,
  script/narration artifacts, TTS provider routing, user voice/PVN handling,
  Remotion rendering, visual-results manifests, and local upload packages.
- Other declared tools, skills, plugins, MCP/app surfaces, and future workflows
  own their own domain artifacts and verification evidence when the active route
  assigns them.
- Agentic Runner owns the route map, stateful handoff, scope boundaries,
  restart points, and cross-workflow audit.

When a leaf owner already owns a mature gate, Agentic Runner must not copy that
gate as a parallel implementation. It may require that the leaf owner runs the
gate and returns evidence.

## Non-Goals

Agentic Runner should not become:

- a generic code generator;
- a replacement for `coding-agents`;
- an article writer competing with `Agentic StructCiv`;
- a video generator competing with `CodexVideo`;
- a replacement for future declared tools, skills, plugins, MCP/app surfaces, or
  specialist workflows;
- a hidden fallback layer that silently patches around leaf execution
  failures;
- a cache patcher or activation shortcut;
- a broad "do everything" command with unobservable internal state;
- a serial-only workflow that prevents parent Codex from seeing failure points,
  artifacts, and restart boundaries.

If a future change adds leaf execution behavior directly to Agentic Runner, the
change must explain why that behavior is orchestration-owned rather than
belonging to an existing tool, skill, plugin, MCP/app surface, or specialist
workflow.

## Example Mixed Routes

### Article With Source Hotfix

User request: "このネタでBLOG記事を作って、途中で壊れていたら直して続けて。"

Expected route:

- `Agentic StructCiv` owns article production.
- If a plugin/source defect blocks the article route, Agentic Runner pauses the
  article workflow and routes the bounded fix to `coding-agents`.
- After `coding-agents` returns root cause, fix, and verification, Agentic
  Runner resumes `Agentic StructCiv` from the correct checkpoint.

### Article To Short Video

User request: "この原稿から3分程度のショートを作って。声は俺の声で。"

Expected route:

- If source article production is still needed, `Agentic StructCiv` owns the
  article/source artifact.
- `CodexVideo` owns short video generation, PVN/user voice handling, Japanese
  pronunciation QA, visual manifests, and Remotion output.
- Agentic Runner records the handoff from article artifact to video source,
  checks which workflow owns each artifact, and audits cross-workflow
  completion.

### Tool For Article Workflow

User request: "記事制作で使う小さいツールを作って、それを今後の流れに組み込んで。"

Expected route:

- `coding-agents` owns the tool implementation and tests.
- `Agentic StructCiv` owns whether the tool belongs in article production and
  how its artifact enters the article route.
- Agentic Runner owns the sequencing, handoff, scope boundary, and final
  combined audit.

## Future Reminder Answer

If the user later asks "Agentic Runner いらなくない？", answer at this grain:

> 単発のコード修正、単発の記事制作、単発の動画生成だけなら不要に見えます。
> その範囲は `coding-agents`、`Agentic StructCiv`、`CodexVideo` や、その場で宣言された tool / skill / plugin / workflow が直接担当できます。
>
> でも Agentic Runner の目的は、それらの実行 owner の代替ではありません。
> 複数 workflow をまたぐ依頼で、誰が何を担当し、どこで止まり、何を検証済みとみなし、どこから再開するかを外部化するための orchestration kernel です。
>
> だから「コード生成機」としてなら不要です。
> 「複合 tool / skill / plugin / workflow のルーター、状態管理、handoff、再開、監査」として育てるなら必要です。
> ここを忘れるなら畳んでよいが、ここを守るなら専門 workflow が増えるほど価値が出ます。

## Implementation Guardrail

Before implementing a new Agentic Runner feature, ask:

1. Does this feature route, supervise, resume, hand off, or audit declared
   tools, skills, plugins, MCP/app surfaces, or specialist workflows?
2. Does an existing leaf owner already own the actual production work?
3. Is Agentic Runner preserving the leaf owner boundary instead of duplicating
   it?
4. Will this leave durable state that a later Codex thread can use to continue
   or explain the job?
5. Does completion require cross-workflow evidence rather than only a local
   code diff?

If the answer to all of these is no, the feature probably belongs in a
  leaf execution workflow or should not exist.

## Success Condition

Agentic Runner is succeeding when it makes complex work easier to route,
pause, resume, supervise, and audit without taking ownership away from the
specialist workflows.

Agentic Runner is failing when it merely adds another place to generate code,
write prose, produce video, or hide failures.
