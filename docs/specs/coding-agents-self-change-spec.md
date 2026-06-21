# Coding Agents Self-Change And Legacy Cleanup Spec

This document is a tracked source specification for confirmed Coding Agents
behavior. It is not workflow state and must not be treated as a generated
`docs/codex` log.

## Confirmed Boundary

Items 1-8 are Coding Agents self changes. Item 9 is external legacy cleanup.

1. State directory
   - Coding Agents runtime/workflow state belongs under `<git-root>/.coding-agents/`.
   - The state directory is resolved from the jobsite/target repository git root,
     not from the invocation repository or plugin source repository unless that
     repository is also the target.
   - `invocation_cwd` is the directory where Codex or the source CLI was launched.
     `jobsite`, `target cwd`, and `target-cwd` identify the repository being
     planned, repaired, edited, or audited.
   - If no target is named, `invocation_cwd` remains the jobsite. This preserves
     the default `cwd is jobsite` behavior.
   - If the user names another target, or the CLI receives `--target-cwd <path>`,
     the named target becomes the jobsite and owns `.coding-agents/`.
   - If target selection or the target git root is ambiguous, missing, outside
     the active scope, or unresolved, stop before edits or workflow state writes
     and ask for the intended target.

2. Git non-pollution
   - Generated local state must avoid polluting the target repository.
   - Use the target repository's `.git/info/exclude` for local ignore rules.
   - Do not broaden tracked `.gitignore` files just to hide Coding Agents local
     state unless the user explicitly asks for that repository policy change.

3. Conditional runner log
   - `runner.md` is an operational log, not a universal required source document.
   - Create or update it only when runner, assignment dispatch, parent-integration
     packet, or process-result activity actually occurs.
   - Do not require `runner.md` for unrelated intake/spec/documentation flows.

4. Subagent lifecycle closure
   - Subagents must return concise parent-integration material and must not stay
     open waiting for more work after returning it.
   - The parent is responsible for promptly closing or retiring no-longer-needed
     subagents after completed result integration, hard-timeout/failure/blocker
     handling, stale premise or scope change, and before final report when no
     further use is expected, without overriding the supervision and
     cancellation rules.
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
     must not trigger cancellation, interruption, retirement, replacement, or
     reassignment by itself.
   - Heartbeats and progress reports are telemetry only. They are not completion
     evidence, verification evidence, root-cause evidence, or permission to
     broaden scope.
   - Cancellation, interruption, retirement, or replacement must record exactly
     one allowed reason: `completed_retire`, `user_stop`, `safety_stop`,
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
   - Existing `.coding-agents` state that predates this rule is stale when
     assignments, handoff material, runner docs, or runner packets lack the
     debugging integrity gate. Validation must not be weakened to accept stale
     state; use an explicit normalization command or regenerate intake state.

7. Meta-Cognitive Debug/Repair Gate
   - Debug, repair, source-of-truth correction, plugin-contract correction,
     generated-artifact inconsistency investigation, generated state versus
     source mismatch, cache/runtime versus source mismatch, and stale contract
     repair are context-impact work, not only local patch work.
   - Assignments, audits, handoffs, runner packets, and final reports for this
     gate must separate the intended contract, observed mismatch, affected
     source/generated/cache/runtime surfaces, changed assumptions, neighboring
     feature impact, before-context effects, after-context effects,
     cross-feature consequences, verification performed, skipped checks,
     unresolved risks, and next investigation.
   - Result quality degrades when Coding Agents stays local. The workflow must
     inspect before/after context effects and cross-feature consequences before
     claiming completion for gate-required work.
   - Passive checklists, prose-only `debugging_integrity`, log-only completion,
     fallback-only completion, skip-only completion, failure-output-only
     completion, and local-wrapper fixes without premise reconsideration are
     non-completion for gate-required work.
   - If neighboring feature or before/after context checks cannot be completed
     inside the active scope, the skipped checks, reason, remaining risk, and
     next investigation must be recorded instead of treating the gate as passed.

8. Nested Coding Agents preflight suppression
   - Parent-managed child workers operate under a Coding Agents assignment that
     the parent already selected.
   - Generated assignments, runner prompts, runner packets, and handoff material
     must tell child workers not to ask `coding-agents を使いますか？ [Y/n]` and
     not to start independent nested Coding Agents workflows inside the assigned
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
- Cache refresh must be cautious and happen only after source validation.
- When the source change is intended for publication, commit the validated source
  change before refreshing cache.
- Broad cache refresh requires user confirmation.
- Do not edit `~/.codex/plugins/cache/` as the primary source of truth.

## Operational Instruction

Future implementation work should preserve this split:

- Source self-change work may update the Coding Agents source repository.
- Cross-repo source invocation must keep source/cache files separate from the
  target repository's generated `.coding-agents/` state. Running the source CLI
  from the plugin repository does not make the plugin repository the state owner
  when `--target-cwd` or an explicit target points elsewhere.
- Generated job state must preserve nested Coding Agents preflight suppression,
  finite delegation depth, subagent supervision and cancellation rules,
  subagent lifecycle closure, concise integration-output rules, debug
  root-cause completion requirements, and metacognitive context-impact checks
  for gate-required work.
- Stale generated state must be normalized explicitly before verification is
  treated as current.
- Legacy cleanup work may inspect external target repositories but must remain
  dry-run until the user explicitly requests apply.
- Migration apply and plugin cache refresh are separate user-confirmed steps.
