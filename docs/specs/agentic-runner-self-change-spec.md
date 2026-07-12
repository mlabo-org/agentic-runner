# Agentic Runner Self-Change And Legacy Cleanup Spec

This document is a tracked source specification for confirmed Agentic Runner
behavior. It is not workflow state and must not be treated as a generated
`docs/codex` log.

Read this together with
`docs/specs/agentic-runner-orchestration-purpose-spec.md` when evaluating
Agentic Runner's future purpose, self-change work, or risk of drifting into a
generic code generator.

## Confirmed Boundary

Items 0-8 are Agentic Runner self changes. Item 9 is external legacy cleanup.

0. Operating modes and self-host gate
   - Agentic Runner operates in external-supervised mode by default.
   - External-supervised mode means a parent Codex session or another explicit
     external supervisor owns policy decisions, source edits, verification
     acceptance, commits, cache refresh, and activation.
   - Self-host mode means Agentic Runner may orchestrate edits to
     `/Users/suzukimakoto/plugins/agentic-runner` using its own
     `.agentic-runner/` workflow state, assignments, runner prompts, or scoped
     subagent handoff material.
   - Self-host mode is allowed only when the user explicitly requests or
     approves Agentic Runner self-hosting for the Agentic Runner source
     repository, the resolved jobsite Git root is the Agentic Runner source
     repository, the invocation uses explicit `--target-cwd` for that source
     repository, the active scope is machine-checkable and limited to named
     source paths, `work_type` is `source-change` or `debug`, the
     metacognitive gate is required and recorded, and an external supervisor
     reviews the plan and accepts verification.
   - Documentation mode cannot authorize self-hosted source edits.
   - Self-host permission does not include cache refresh, marketplace
     registration, plugin activation, commits, destructive actions, external
     sending, or scope expansion. Those remain separate explicit approvals.
   - If any condition is missing, stay in external-supervised mode and stop
     before self-hosted state writes or source edits.
   - The source CLI enforces the mechanical gate: when the target Git root is
     the Agentic Runner source repository, state-writing commands require
     explicit `--target-cwd` and record `self_host_target` plus
     `self_host_gate` in generated project and audit state.

1. State directory
   - Agentic Runner runtime/workflow state belongs under `<git-root>/.agentic-runner/`.
   - The state directory is resolved from the jobsite/target repository git root,
     not from the invocation repository or plugin source repository unless that
     repository is also the target.
   - `invocation_cwd` is the directory where Codex or the source CLI was launched.
     `jobsite`, `target cwd`, and `target-cwd` identify the repository being
     planned, repaired, edited, or audited.
   - If no target is named, `invocation_cwd` remains the jobsite. This preserves
     the default `cwd is jobsite` behavior.
   - If the user names another target, or the CLI receives `--target-cwd <path>`,
     the named target becomes the jobsite and owns `.agentic-runner/`.
   - If target selection or the target git root is ambiguous, missing, outside
     the active scope, or unresolved, stop before edits or workflow state writes
     and ask for the intended target.

2. Git non-pollution
   - Generated local state must avoid polluting the target repository.
   - Use the target repository's `.git/info/exclude` for local ignore rules.
   - Do not broaden tracked `.gitignore` files just to hide Agentic Runner local
     state unless the user explicitly asks for that repository policy change.

3. Conditional runner log
   - `runner.md` is an operational log, not a universal required source document.
   - Create or update it only when runner, assignment dispatch, parent-integration
     packet, or process-result activity actually occurs.
   - Do not require `runner.md` for unrelated intake/spec/documentation flows.

4. Workflow-state lifecycle disposition
   - Subagents must return concise parent-integration material and must not stay
     open waiting for more work after returning it.
   - Current workflow state and modern packets record
     `lifecycle_contract_version: 1`, `lifecycle_scope: workflow_state_only`,
     `lifecycle_disposition`, `cancel_reason`,
     `runtime_thread_disposition: unmanaged_by_workflow_cli`, and
     `runtime_changed: false`.
   - `state_retired` requires exactly one allowed `cancel_reason`.
     `continuation_expected` requires `cancel_reason: none` and is the safe
     default when `collect` omits `--lifecycle-disposition`.
   - This workflow state does not close a runtime thread. `interrupt_agent` and
     process exit are not runtime-thread close evidence, and generated output
     must never claim `runtime_thread_closed: true`.
   - A fieldless current packet under versioned task state is invalid. Existing
     fieldless packets remain `unknown_legacy` only when workflow state
     verifiably predates the lifecycle contract marker or the packet is
     non-current history; migration and validation must not synthesize retirement.
     Explicit normalization may add only `continuation_expected` lifecycle
     fields to a fieldless current packet; it must not infer `state_retired`.
   - Generated assignments, runner prompts, runner packets, and handoff material
     must carry this lifecycle rule so future job state preserves it.

5. Subagent supervision and finite delegation depth
   - Delegation hierarchy must be finite. Valid modes are `none`, `one_level`,
     and `n_level`.
   - `none` means no descendant delegation and requires `max_depth: 0`,
     `depth: 0`, and `remaining_depth: 0`.
   - `one_level` permits direct children only. The assigned worker receives
     `max_depth: 1`, `depth: 0`, and `remaining_depth: 1`; its direct children
     receive `depth: 1` and `remaining_depth: 0`.
   - `n_level` permits a bounded descendant chain only when the parent provides
     finite `max_depth`, current `depth`, and calculated `remaining_depth`.
   - Every subagent assignment must include the finite hierarchy fields. Infinite
     or unbounded depth is invalid. Descendants inherit supervision,
     cancellation, scope, depth, and permission limits and may narrow but never
     broaden them.
   - Long-running or delegated assignments must carry supervision fields:
     `heartbeat_interval`, `heartbeat_deadline`, `max_silence`,
     `soft_timeout`, `hard_timeout`, `no_interrupt_until`, and
     `cancel_reason_required: true`.
   - Silence before `heartbeat_deadline` or `no_interrupt_until` is neutral and
     must not trigger `state_retired`, cancellation, interruption, replacement,
     or reassignment by itself.
   - Heartbeats and progress reports are telemetry only. They are not completion
     evidence, verification evidence, root-cause evidence, or permission to
     broaden scope.
   - Every `state_retired` workflow transition, cancellation, interruption, or
     replacement must record exactly one allowed reason: `completed_retire`, `user_stop`, `safety_stop`,
     `scope_violation`, `stale_timeout`, `blocker_or_failure`, or
     `stale_premise`.
   - Cancellation for quiet staleness must follow this path: missed heartbeat,
     soft ping or status request, grace wait, stale mark, then cancel or replace
     only if the worker remains silent, returns invalid status, violates scope,
     or crosses the hard timeout.
   - The parent retains policy, cancellation judgment, replacement assignment,
     final result acceptance, and final integration.

6. Debugging integrity
   - Debug or repair work is complete only when the root cause is identified,
     fixed, and verified against the intended outcome.
   - Log-only, error-message-only, exception-catch-only, skip-only,
     fallback-only, failure-output-only, and return-to-main-loop-only changes are
     temporary containment at most and must not be accepted as debug completion.
   - Generated assignments, runner prompts, runner packets, audit material, and
     handoff material must carry this debugging integrity rule so delegated work
     preserves it.
   - Existing `.agentic-runner` state that predates this rule is stale when
     assignments, handoff material, runner docs, or runner packets lack the
     debugging integrity gate. Validation must not be weakened to accept stale
     state; use an explicit normalization command or regenerate intake state.

7. Meta-Cognitive Debug/Repair Gate
   - Debug, repair, source-of-truth correction, plugin-contract correction,
     generated-artifact inconsistency investigation, generated state versus
     source mismatch, cache/runtime versus source mismatch, and stale contract
     repair are context-impact work, not only local patch work.
   - Self-hosted Agentic Runner source edits are always gate-required
     context-impact work and must not be downgraded by `documentation` mode.
   - Assignments, audits, handoffs, runner packets, and final reports for this
     gate must separate the intended contract, observed mismatch, affected
     source/generated/cache/runtime surfaces, changed assumptions, neighboring
     feature impact, before-context effects, after-context effects,
     cross-feature consequences, verification performed, skipped checks,
     unresolved risks, and next investigation.
   - Result quality degrades when Agentic Runner stays local. The workflow must
     inspect before/after context effects and cross-feature consequences before
     claiming completion for gate-required work.
   - Passive checklists, prose-only `debugging_integrity`, log-only completion,
     fallback-only completion, skip-only completion, failure-output-only
     completion, and local-wrapper fixes without premise reconsideration are
     non-completion for gate-required work.
   - If neighboring feature or before/after context checks cannot be completed
     inside the active scope, the skipped checks, reason, remaining risk, and
     next investigation must be recorded instead of treating the gate as passed.

8. Nested Agentic Runner preflight suppression
   - Parent-managed child workers operate under an Agentic Runner assignment that
     the parent already selected.
   - Generated assignments, runner prompts, runner packets, and handoff material
     must tell child workers not to ask `agentic-runner を使いますか？ [Y/n]` and
     not to start independent nested Agentic Runner workflows inside the assigned
     `task_id`/`epoch`/`scope`.
   - Descendant delegation is allowed only when finite hierarchy fields grant
     `remaining_depth > 0`, and it must preserve the same task, epoch, scope
     lineage, inherited supervision, and cancellation rules.
   - This suppression does not authorize scope expansion, destructive
     operations, external sending, commits, cache refresh, plugin activation, or
     unrelated edits.
   - Nested descendants also inherit the finite delegation depth and supervision
     contract. They cannot broaden scope, depth, permissions, or cancellation
     authority.

9. Legacy migration and cleanup
   - Existing legacy locations are cleaned through an explicit migration workflow,
     not by silent deletion or broad automatic rewriting.
   - The migration workflow must perform a preflight backup before destructive or
     move-like actions.
   - Dry-run is the default.
   - Apply mode runs only when the user explicitly requests it.
   - Broad migration apply requires user confirmation.

## Cache Refresh Timing

- Refreshing the plugin cache is separate from source editing.
- Self-host permission does not authorize cache refresh, marketplace
  registration, plugin activation, commits, or restart/reload.
- Cache refresh must be cautious and happen only after source validation.
- When the source change is intended for publication, commit the validated source
  change before refreshing cache.
- Broad cache refresh requires user confirmation.
- Do not edit `~/.codex/plugins/cache/` as the primary source of truth.

## Operational Instruction

Future implementation work should preserve this split:

- Source self-change work may update the Agentic Runner source repository only
  under external supervision by default, or under self-host mode after the
  Self-Host Gate is explicitly satisfied.
- Cross-repo source invocation must keep source/cache files separate from the
  target repository's generated `.agentic-runner/` state. Running the source CLI
  from the plugin repository does not make the plugin repository the state owner
  when `--target-cwd` or an explicit target points elsewhere.
- Generated job state must preserve nested Agentic Runner preflight suppression,
  finite delegation depth, subagent supervision and cancellation rules,
  workflow-state lifecycle disposition, runtime-thread boundary, concise integration-output rules, debug
  root-cause completion requirements, and metacognitive context-impact checks
  for gate-required work.
- Stale generated state must be normalized explicitly before verification is
  treated as current.
- Legacy cleanup work may inspect external target repositories but must remain
  dry-run until the user explicitly requests apply.
- Migration apply and plugin cache refresh are separate user-confirmed steps.
