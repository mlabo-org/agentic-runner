import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "bin", "agentic-runner.mjs");

test("source identity rejects legacy Coding Agents identity misuse but allows controlled routed workflow names", () => {
  assert.deepEqual(
    findLegacyIdentityMisuse("fixture.md", "Agentic Runner routes source fixes to coding-agents from the control-plane."),
    [],
  );
  assert.ok(findLegacyIdentityMisuse("fixture.json", `"name": "${["coding", "agents"].join("-")}"`).length);
  assert.ok(findLegacyIdentityMisuse("fixture.yaml", `display_name: ${["Coding", "Agents"].join(" ")}`).length);
  assert.ok(findLegacyIdentityMisuse("fixture.mjs", `const STATE_DIR_NAME = ".${["coding", "agents"].join("-")}";`).length);
  assert.ok(findLegacyIdentityMisuse("fixture.mjs", `const env = '${["CODING", "AGENTS"].join("_")}';`).length);

  const listed = spawnSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);

  const hits = [];
  for (const file of listed.stdout.trim().split("\n").filter(Boolean)) {
    const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
    hits.push(...findLegacyIdentityMisuse(file, text));
  }

  assert.deepEqual(hits, []);
});

test("doctor reports explicit self-host gate for the Agentic Runner source repo", () => {
  const result = runCli(["doctor", "--target-cwd", "."]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok self-host gate: explicit_self_host_target/);
});

test("intake refuses implicit self-host writes to the Agentic Runner source repo", () => {
  const result = runCli([
    "intake",
    "--task",
    "attempt implicit self-host intake",
    "--task-id",
    "implicit-self-host",
    "--epoch",
    "e1",
    "--scope",
    "scope:v1 paths=bin/agentic-runner.mjs",
    "--work-type",
    "source-change",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Self-Host Gate: refusing intake/);
  assert.match(result.stderr, /--target-cwd/);
});

test("cross-repo intake records non-self-host gate state", () => {
  const repo = makeTempGitRepo();
  try {
    const result = runCli([
      "intake",
      "--target-cwd",
      repo,
      "--task",
      "plan external target work",
      "--task-id",
      "external-target",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--work-type",
      "source-change",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ok self_host_target: false/);
    assert.match(result.stdout, /ok self_host_gate: external_supervised_non_self_target/);
    assert.match(readState(repo, "project.md"), /self_host_target: false/);
    assert.match(readState(repo, "project.md"), /self_host_gate: external_supervised_non_self_target/);
    assert.match(readState(repo, "audit.md"), /self_host_target: false/);
    assert.match(readState(repo, "audit.md"), /self_host_gate: external_supervised_non_self_target/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("runner commands require matching intake state before writing runner state", () => {
  const repo = makeTempGitRepo();
  try {
    const beforeIntake = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "state-safety",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "make a scoped change",
      "--expected-output",
      "implementation packet",
    ]);
    assert.notEqual(beforeIntake.status, 0);
    assert.match(beforeIntake.stderr, /requires current intake state/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);

    intake(repo, { taskId: "state-safety", epoch: "e1", scope: "README.md" });

    const wrongTask = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "wrong-task",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "make a scoped change",
      "--expected-output",
      "implementation packet",
    ]);
    assert.notEqual(wrongTask.status, 0);
    assert.match(wrongTask.stderr, /does not match current task state-safety/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);

    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "state-safety",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "make a scoped change",
      "--expected-output",
      "implementation packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);
    assert.match(readState(repo, "runner.md"), /type: assignment/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("handoff validates requested task id before printing the handoff body", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "handoff-current", epoch: "e1", scope: "README.md" });

    const wrong = runCli(["handoff", "--target-cwd", repo, "--task-id", "wrong-task"]);
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /does not match current task handoff-current/);
    assert.doesNotMatch(wrong.stdout, /# Handoff Prompt/);

    const current = runCli(["handoff", "--target-cwd", repo, "--task-id", "handoff-current"]);
    assert.equal(current.status, 0, current.stderr);
    assert.match(current.stdout, /# Handoff Prompt/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("identity isolation fields reject CR/LF injection before state writes", () => {
  const repo = makeTempGitRepo();
  try {
    for (const [field, value] of [
      ["--task-id", "identity\n- epoch: injected"],
      ["--epoch", "e1\r- scope: injected"],
      ["--scope", "README.md\n- task_id: injected"],
    ]) {
      const intakeArgs = [
        "intake",
        "--target-cwd",
        repo,
        "--task",
        "Add a focused workflow-state safety improvement",
        "--task-id",
        "identity-safe",
        "--epoch",
        "e1",
        "--scope",
        "README.md",
      ];
      intakeArgs[intakeArgs.indexOf(field) + 1] = value;
      const rejected = runCli(intakeArgs);
      assert.notEqual(rejected.status, 0, `${field} unexpectedly passed`);
      assert.match(rejected.stderr, /CR\/LF are not allowed/);
    }

    assert.equal(existsSync(path.join(repo, ".agentic-runner")), false);

    intake(repo, { taskId: "identity-current", epoch: "e1", scope: "README.md" });
    const commands = [
      [
        "assign",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        "identity-current\n- scope: injected",
        "--epoch",
        "e1",
        "--scope",
        "README.md",
        "--assignment",
        "make a scoped change",
        "--expected-output",
        "implementation packet",
      ],
      [
        "collect",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        "identity-current",
        "--epoch",
        "e1\r- scope: injected",
        "--scope",
        "README.md",
        "--status",
        "blocked",
        "--blockers",
        "blocked by identity validation test",
        "--next-investigation",
        "retry with clean identity",
      ],
      [
        "run",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        "identity-current",
        "--epoch",
        "e1",
        "--scope",
        "README.md\n- task_id: injected",
        "--assignment",
        "make a scoped change",
        "--expected-output",
        "runner packet",
      ],
      ["handoff", "--target-cwd", repo, "--task-id", "identity-current\n- scope: injected"],
    ];

    for (const args of commands) {
      const rejected = runCli(args);
      assert.notEqual(rejected.status, 0, `${args[0]} unexpectedly passed`);
      assert.match(rejected.stderr, /CR\/LF are not allowed/);
    }
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("validation rejects corrupted workflow state with injected identity fields", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "identity-state", epoch: "e1", scope: "README.md" });
    const taskPath = path.join(repo, ".agentic-runner", "task.md");
    const task = readFileSync(taskPath, "utf8");
    writeFileSync(taskPath, task.replace("- task_id: identity-state", "- task_id: identity-state\n- task_id: injected"), "utf8");

    const verify = runCli(["verify-assignments", "--target-cwd", repo]);
    assert.notEqual(verify.status, 0);
    assert.match(verify.stdout, /invalid workflow identity fields/);

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /task_id duplicated/);

    const normalize = runCli(["normalize-debugging-integrity", "--target-cwd", repo]);
    assert.notEqual(normalize.status, 0);
    assert.match(normalize.stderr, /requires valid workflow identity fields/);

    const assign = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "identity-state",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "make a scoped change",
      "--expected-output",
      "implementation packet",
    ]);
    assert.notEqual(assign.status, 0);
    assert.match(assign.stderr, /task_id duplicated/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("workflow identity ignores task body fenced field-looking bullets", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, {
      taskId: "task-fence",
      epoch: "e1",
      scope: "README.md",
      task: `Investigate a user-supplied Markdown sample.

\`\`\`markdown
- task_id: fake-task
- epoch: fake-epoch
- scope: fake-scope
\`\`\`

The fenced sample is task prose, not workflow identity.`,
    });

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
    assert.doesNotMatch(doctor.stdout, /duplicated|fake-task|fake-epoch|fake-scope/);

    const handoff = runCli(["handoff", "--target-cwd", repo, "--task-id", "task-fence"]);
    assert.equal(handoff.status, 0, handoff.stderr);

    const fakeHandoff = runCli(["handoff", "--target-cwd", repo, "--task-id", "fake-task"]);
    assert.notEqual(fakeHandoff.status, 0);
    assert.match(fakeHandoff.stderr, /does not match current task task-fence/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("assignment validation does not accept fenced fake identity fields", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "assignment-fence", epoch: "e1", scope: "README.md" });
    const assignmentsPath = path.join(repo, ".agentic-runner", "assignments.md");
    const assignments = readFileSync(assignmentsPath, "utf8");
    const corrupted = assignments.replace(
      /(## Implementer[\s\S]*?)- task_id: assignment-fence\n/,
      "$1```markdown\n- task_id: assignment-fence\n```\n",
    );
    writeFileSync(assignmentsPath, corrupted, "utf8");

    const verify = runCli(["verify-assignments", "--target-cwd", repo]);
    assert.notEqual(verify.status, 0);
    assert.match(verify.stdout, /Implementer\.task_id/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("doctor verifies the target git info exclude without mutating it", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "exclude-check", epoch: "e1", scope: "README.md" });
    const excludePath = path.join(repo, ".git", "info", "exclude");
    const originalExclude = readFileSync(excludePath, "utf8");
    assert.match(originalExclude, /^\.agentic-runner\/$/m);

    writeFileSync(excludePath, originalExclude.replace(/^\.agentic-runner\/\n?/m, ""), "utf8");
    const missing = runCli(["doctor", "--target-cwd", repo]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stdout, /missing \.agentic-runner\/ in/);
    assert.doesNotMatch(readFileSync(excludePath, "utf8"), /^\.agentic-runner\/$/m);

    writeFileSync(excludePath, originalExclude, "utf8");
    const restored = runCli(["doctor", "--target-cwd", repo]);
    assert.equal(restored.status, 0, restored.stdout + restored.stderr);
    assert.match(restored.stdout, /ok \.agentic-runner\/ ignored by git info exclude/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("intake describes fixed roles as scaffold, not resident agents", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "role-scaffold", epoch: "e1", scope: "README.md" });
    const assignments = readState(repo, "assignments.md");
    assert.match(assignments, /# Role Assignment Scaffold/);
    assert.match(assignments, /not resident agents or spawned workers/);
    assert.equal([...assignments.matchAll(/^## (?!Debugging|Meta-Cognitive|Nested|Subagent|Specialist)(.+)$/gm)].length, 14);
    assert.match(assignments, /- status: scaffolded/);

    const verify = runCli(["verify-assignments", "--target-cwd", repo]);
    assert.equal(verify.status, 0, verify.stdout + verify.stderr);

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
    assert.match(doctor.stdout, /14 role assignment scaffold sections present/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("intake generates supervision guidance in assignments and handoff", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "supervision-intake", epoch: "e1", scope: "README.md" });
    const assignments = readState(repo, "assignments.md");
    const implementer = getRoleSection(assignments, "Implementer");
    assert.match(assignments, /## Subagent Supervision Contract/);
    assert.match(assignments, /Silence before heartbeat deadline is neutral, not failure/);
    assert.match(assignments, /Heartbeat is telemetry, not completion evidence/);
    assert.match(assignments, /completed_retire, user_stop, safety_stop, scope_violation, stale_timeout, blocker_or_failure, stale_premise/);
    assert.match(assignments, /missed heartbeat -> soft ping\/status request -> grace wait -> stale mark -> cancel\/replace only if still silent or invalid/);
    assert.match(assignments, /descendants inherit supervision and cancellation rules; they cannot expand scope\/depth\/permissions/);
    assertSupervisionSchema(implementer);

    const handoff = readState(repo, "handoff.md");
    assert.match(handoff, /^Supervision:$/m);
    assert.match(handoff, /Parent must not cancel, interrupt, retire, or replace during the no-interrupt window/);
    assert.match(handoff, /^- hierarchy_mode: none$/m);
    assert.match(handoff, /^- heartbeat_interval: PT15M$/m);
    assert.match(handoff, /^- cancel_reason_required: true$/m);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
    assert.equal(runCli(["doctor", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("intake persists the default workflow profile and domain contract", () => {
  const repo = makeTempGitRepo();
  try {
    const result = runCli([
      "intake",
      "--target-cwd",
      repo,
      "--task",
      "record default workflow profile metadata",
      "--task-id",
      "workflow-default",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ok workflow_profile: default/);
    assert.match(result.stdout, /ok workflow_domain_contract: agentic-runner\.workflow\.default\.v1/);

    for (const file of ["project.md", "task.md", "assignments.md", "handoff.md"]) {
      const text = readState(repo, file);
      assert.match(text, /workflow_profile: default/);
      assert.match(text, /workflow_domain: agentic-runner/);
      assert.match(text, /workflow_domain_contract: agentic-runner\.workflow\.default\.v1/);
    }
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
    assert.equal(runCli(["doctor", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("old workflow state without workflow profile fields behaves as default", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "workflow-legacy-default", epoch: "e1", scope: "README.md" });
    for (const file of ["project.md", "task.md", "assignments.md", "handoff.md", "audit.md", "decisions.md"]) {
      const filePath = path.join(repo, ".agentic-runner", file);
      writeFileSync(filePath, stripWorkflowProfileLines(readFileSync(filePath, "utf8")), "utf8");
    }

    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
    assert.equal(runCli(["doctor", "--target-cwd", repo]).status, 0);

    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "workflow-legacy-default",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "append a packet from old no-profile state",
      "--expected-output",
      "assignment packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);
    const runner = readState(repo, "runner.md");
    assert.match(runner, /workflow_profile: default/);
    assert.match(runner, /workflow_domain_contract: agentic-runner\.workflow\.default\.v1/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("coding-agent workflow profile persists separately from feature profiles and runner packets inherit it", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, {
      taskId: "workflow-coding-agent",
      epoch: "e1",
      scope: "README.md",
      workflowProfile: "coding-agent",
    });

    const project = readState(repo, "project.md");
    const task = readState(repo, "task.md");
    const assignments = readState(repo, "assignments.md");
    const handoff = readState(repo, "handoff.md");
    for (const text of [project, task, assignments, handoff]) {
      assert.match(text, /workflow_profile: coding-agent/);
      assert.match(text, /workflow_domain: agentic-runner\.coding-agent/);
      assert.match(text, /workflow_domain_contract: agentic-runner\.workflow\.coding-agent\.v1/);
    }
    assert.equal([...assignments.matchAll(/^## (?!Debugging|Meta-Cognitive|Nested|Subagent|Specialist)(.+)$/gm)].length, 14);

    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "workflow-coding-agent",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--feature-profile",
      "debug.reproducer",
      "--assignment",
      "confirm profile metadata stays distinct",
      "--expected-output",
      "assignment packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);

    const runner = readState(repo, "runner.md");
    assert.match(runner, /feature_profile: debug\.reproducer/);
    assert.match(runner, /workflow_profile: coding-agent/);
    assert.match(runner, /workflow_domain_contract: agentic-runner\.workflow\.coding-agent\.v1/);
    assert.doesNotMatch(assignments, /feature_profile: debug\.reproducer/);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("plugin-source workflow profile remains a narrower source cache boundary profile", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, {
      taskId: "workflow-plugin-source",
      epoch: "e1",
      scope: "README.md",
      workflowProfile: "plugin-source",
    });

    const task = readState(repo, "task.md");
    const assignments = readState(repo, "assignments.md");
    assert.match(task, /workflow_profile: plugin-source/);
    assert.match(task, /workflow_domain: agentic-runner\.plugin-source/);
    assert.match(task, /workflow_domain_contract: agentic-runner\.workflow\.plugin-source\.v1/);
    assert.match(assignments, /workflow_profile_guidance: Narrow metadata-only profile for plugin source work/);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("intake classifies upper-layer routes and records controlled workflow boundaries", () => {
  for (const [taskId, task, expectedRoute, expectedExecutionOwner] of [
    ["route-article", "BLOG記事をSWELL向けに構成して本文を作る", "article", "agentic-structciv"],
    ["route-coding", "Fix a source CLI bug and run tests", "coding", "coding-agents"],
    ["route-video", "この原稿で3分程度のショート動画を作れ。声は俺の声でな。", "video", "codex-video"],
    ["route-mixed", "BLOG記事を作ってからショート動画化し、必要ならsource CLIも修正する", "mixed", "agentic-runner"],
  ]) {
    const repo = makeTempGitRepo();
    try {
      const result = runCli([
        "intake",
        "--target-cwd",
        repo,
        "--task",
        task,
        "--task-id",
        taskId,
        "--epoch",
        "e1",
        "--scope",
        "README.md",
      ]);
      assert.equal(result.status, 0, `${taskId}: ${result.stderr}`);
      assert.match(result.stdout, new RegExp(`ok route_class: ${expectedRoute}`));
      assert.match(result.stdout, new RegExp(`ok primary_workflow: ${expectedExecutionOwner}`));

      const taskState = readState(repo, "task.md");
      assert.match(taskState, new RegExp(`route_class: ${expectedRoute}`));
      assert.match(taskState, /agentic_runner_layer: control-plane/);
      assert.match(taskState, /controlled_workflows:/);
      assert.match(taskState, new RegExp(`execution_owner: ${expectedExecutionOwner}`));
      assert.match(taskState, /route_contract: Agentic Runner routes and audits; specialist workflows are not replaced by this state scaffold\./);

      const assignments = readState(repo, "assignments.md");
      assert.match(assignments, /route_layer: Agentic Runner is the upper orchestration layer; specialist workflows are execution layers\./);
      assert.match(assignments, /route_contract: Agentic Runner owns routing, handoff, state, supervision, and audit; specialist workflows own production and verification evidence\./);
      assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
      assert.equal(runCli(["doctor", "--target-cwd", repo]).status, 0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("mixed route requires explicit subordinate execution owner on runner packets", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, {
      taskId: "mixed-owner",
      epoch: "e1",
      scope: "README.md",
      workType: "source-change",
      task: "BLOG記事を作り、ショート動画化し、必要ならsource CLIも修正する",
    });

    const missingOwner = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "mixed-owner",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--work-type",
      "source-change",
      "--assignment",
      "route one subordinate execution unit",
      "--expected-output",
      "assignment packet",
    ]);
    assert.notEqual(missingOwner.status, 0);
    assert.match(missingOwner.stderr, /--specialist-owner is required for route_class mixed/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);

    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "mixed-owner",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--work-type",
      "source-change",
      "--specialist-owner",
      "coding-agents",
      "--assignment",
      "route the source repair unit below Agentic Runner",
      "--expected-output",
      "coding-agents packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);

    const runner = readState(repo, "runner.md");
    assert.match(runner, /route_class: mixed/);
    assert.match(runner, /agentic_runner_layer: control-plane/);
    assert.match(runner, /controlled_workflows: agentic-runner, coding-agents, agentic-structciv, codex-video/);
    assert.match(runner, /execution_owner: coding-agents/);
    assert.match(runner, /specialist_owner: coding-agents/);
    assert.match(runner, /layer_boundary: Agentic Runner operates above coding-agents, Agentic StructCiv, and CodexVideo/);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("doctor and verify reject corrupted route state and subordinate owner fields", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "route-corrupt-task", epoch: "e1", scope: "README.md" });
    const taskPath = path.join(repo, ".agentic-runner", "task.md");
    writeFileSync(taskPath, readFileSync(taskPath, "utf8").replace("route_class: unknown", "route_class: impossible"), "utf8");

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /task\.md\.route_class unknown \(impossible\)/);

    const verify = runCli(["verify-assignments", "--target-cwd", repo]);
    assert.notEqual(verify.status, 0);
    assert.match(verify.stdout, /task\.md\.route_class unknown \(impossible\)/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }

  const packetRepo = makeTempGitRepo();
  try {
    intake(packetRepo, {
      taskId: "route-corrupt-packet",
      epoch: "e1",
      scope: "README.md",
      task: "Fix source CLI behavior",
    });
    const assigned = runCli([
      "assign",
      "--target-cwd",
      packetRepo,
      "--role",
      "Implementer",
      "--task-id",
      "route-corrupt-packet",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "route coding work below Agentic Runner",
      "--expected-output",
      "assignment packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);
    const runnerPath = path.join(packetRepo, ".agentic-runner", "runner.md");
    writeFileSync(runnerPath, readFileSync(runnerPath, "utf8").replace("specialist_owner: coding-agents", "specialist_owner: nobody"), "utf8");

    const verify = runCli(["verify-assignments", "--target-cwd", packetRepo]);
    assert.notEqual(verify.status, 0);
    assert.match(verify.stdout, /specialist_owner unknown \(nobody\)/);

    const doctor = runCli(["doctor", "--target-cwd", packetRepo]);
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /specialist_owner unknown \(nobody\)/);
  } finally {
    rmSync(packetRepo, { recursive: true, force: true });
  }
});

test("orchestrate records control-plane orchestration state and rejects process runners", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, {
      taskId: "route-orchestrate",
      epoch: "e1",
      scope: "README.md",
      task: "Fix source CLI behavior",
    });

    const rejected = runCli([
      "orchestrate",
      "--target-cwd",
      repo,
      "--role",
      "Planner",
      "--task-id",
      "route-orchestrate",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "route coding work",
      "--expected-output",
      "orchestration state",
      "--runner",
      "codex-cli",
    ]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /orchestrate records route\/orchestration state only/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);

    const routed = runCli([
      "orchestrate",
      "--target-cwd",
      repo,
      "--role",
      "Planner",
      "--task-id",
      "route-orchestrate",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "route coding work",
      "--expected-output",
      "orchestration state",
    ]);
    assert.equal(routed.status, 0, routed.stderr);
    assert.match(routed.stdout, /ok orchestration_state: Planner/);

    const runner = readState(repo, "runner.md");
    assert.match(runner, /type: orchestration-state/);
    assert.doesNotMatch(runner, /type: process-runner-result/);
    assert.match(runner, /current_specialist: coding-agents/);
    assert.match(runner, /agentic_runner_layer: control-plane/);
    assert.match(runner, /cross_workflow_audit: coding-agents result accepted by agentic-runner route audit/);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("workflow profiles cannot be overridden by runner packets", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, {
      taskId: "workflow-packet-override",
      epoch: "e1",
      scope: "README.md",
      workflowProfile: "coding-agent",
    });

    const rejected = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "workflow-packet-override",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--workflow-profile",
      "plugin-source",
      "--assignment",
      "try to override workflow profile from a runner packet",
      "--expected-output",
      "rejected packet",
    ]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /--workflow-profile is only supported for intake/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("doctor and verify reject unknown workflow profile in task state", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, {
      taskId: "workflow-corrupt-profile",
      epoch: "e1",
      scope: "README.md",
      workflowProfile: "coding-agent",
    });
    const taskPath = path.join(repo, ".agentic-runner", "task.md");
    writeFileSync(
      taskPath,
      readFileSync(taskPath, "utf8").replace("workflow_profile: coding-agent", "workflow_profile: impossible-profile"),
      "utf8",
    );

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /task\.md:workflow_profile unknown \(impossible-profile\)/);

    const verify = runCli(["verify-assignments", "--target-cwd", repo]);
    assert.notEqual(verify.status, 0);
    assert.match(verify.stdout, /task\.md:workflow_profile unknown \(impossible-profile\)/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("unknown workflow profile fails before writing state", () => {
  const repo = makeTempGitRepo();
  try {
    const rejected = runCli([
      "intake",
      "--target-cwd",
      repo,
      "--workflow-profile",
      "unknown-domain",
      "--task",
      "try an unknown workflow profile",
      "--task-id",
      "workflow-reject",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
    ]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /unknown workflow profile: unknown-domain/);
    assert.match(rejected.stderr, /default, coding-agent, plugin-source/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("feature profiles are optional overlays and do not change the fixed 14-role scaffold", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "profile-scaffold", epoch: "e1", scope: "README.md" });

    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "profile-scaffold",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--feature-profile",
      "workflow.state-safety",
      "--assignment",
      "check workflow state append safety",
      "--expected-output",
      "assignment packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);

    const assignments = readState(repo, "assignments.md");
    assert.equal([...assignments.matchAll(/^## (?!Debugging|Meta-Cognitive|Nested|Subagent|Specialist)(.+)$/gm)].length, 14);
    assert.doesNotMatch(assignments, /workflow\.state-safety/);
    assert.doesNotMatch(assignments, /^## workflow\.state-safety$/m);

    const runner = readState(repo, "runner.md");
    assert.match(runner, /feature_profile: workflow\.state-safety/);
    assert.match(runner, /feature_profile_guidance: .*optional assignment overlay, not a resident agent or spawned worker/);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("runner assignment packets carry supervision guidance", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "supervision-runner", epoch: "e1", scope: "README.md" });

    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "supervision-runner",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "record a supervised assignment packet",
      "--expected-output",
      "assignment packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);

    const runner = readState(repo, "runner.md");
    assert.match(runner, /type: assignment[\s\S]*supervision_contract: Subagent Supervision Contract/);
    assert.match(runner, /type: assignment[\s\S]*supervision_heartbeat: Silence before heartbeat deadline is neutral, not failure\. Heartbeat is telemetry, not completion evidence\./);
    assert.match(runner, /type: assignment[\s\S]*supervision_no_interrupt: Parent must not cancel, interrupt, retire, or replace during the no-interrupt window\./);
    assert.match(runner, /type: assignment[\s\S]*supervision_retire_cancel_reasons: completed_retire, user_stop, safety_stop, scope_violation, stale_timeout, blocker_or_failure, stale_premise/);
    assert.match(runner, /type: assignment[\s\S]*hierarchy_mode: none/);
    assert.match(runner, /type: assignment[\s\S]*heartbeat_interval: PT15M/);
    assert.match(runner, /type: assignment[\s\S]*cancel_reason_required: true/);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("runner assignment packets can override finite hierarchy and supervision timing", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "supervision-override", epoch: "e1", scope: "README.md" });

    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "supervision-override",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--hierarchy-mode",
      "one_level",
      "--heartbeat-interval",
      "PT10M",
      "--heartbeat-deadline",
      "PT20M",
      "--max-silence",
      "PT40M",
      "--soft-timeout",
      "PT60M",
      "--hard-timeout",
      "PT90M",
      "--no-interrupt-until",
      "PT40M",
      "--assignment",
      "record a supervised assignment packet with delegated depth",
      "--expected-output",
      "assignment packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);

    const runner = readState(repo, "runner.md");
    assert.match(runner, /type: assignment[\s\S]*hierarchy_mode: one_level/);
    assert.match(runner, /type: assignment[\s\S]*max_depth: 1/);
    assert.match(runner, /type: assignment[\s\S]*depth: 0/);
    assert.match(runner, /type: assignment[\s\S]*remaining_depth: 1/);
    assert.match(runner, /type: assignment[\s\S]*heartbeat_interval: PT10M/);
    assert.match(runner, /type: assignment[\s\S]*heartbeat_deadline: PT20M/);
    assert.match(runner, /type: assignment[\s\S]*no_interrupt_until: PT40M/);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("n_level hierarchy requires finite max depth before runner state append", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "supervision-invalid-depth", epoch: "e1", scope: "README.md" });

    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "supervision-invalid-depth",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--hierarchy-mode",
      "n_level",
      "--assignment",
      "record an invalid depth packet",
      "--expected-output",
      "assignment packet",
    ]);
    assert.notEqual(assigned.status, 0);
    assert.match(assigned.stderr, /--max-depth is required/);
    assert.throws(() => readState(repo, "runner.md"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("valid feature profile renders in assignment, collect, and control-plane orchestration packets", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "profile-render", epoch: "e1", scope: "README.md" });

    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "profile-render",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--feature-profile",
      "debug.reproducer",
      "--assignment",
      "capture a reproduction",
      "--expected-output",
      "assignment packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);
    assert.match(assigned.stdout, /ok feature_profile: debug\.reproducer/);

    const collected = runCli([
      "collect",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "profile-render",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--feature-profile",
      "debug.reproducer",
      "--status",
      "blocked",
      "--findings",
      "reproduction needs a fixture",
      "--blockers",
      "fixture is not available",
      "--next",
      "parent decides fixture source",
    ]);
    assert.equal(collected.status, 0, collected.stderr);
    assert.match(collected.stdout, /ok feature_profile: debug\.reproducer/);

    const run = runCli([
      "orchestrate",
      "--target-cwd",
      repo,
      "--role",
      "Test Runner",
      "--task-id",
      "profile-render",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--feature-profile",
      "debug.reproducer",
      "--assignment",
      "record a runner skeleton",
      "--expected-output",
      "runner skeleton",
    ]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /ok feature_profile: debug\.reproducer/);

    const runner = readState(repo, "runner.md");
    assert.match(runner, /type: assignment[\s\S]*feature_profile: debug\.reproducer/);
    assert.match(runner, /type: parent-integration[\s\S]*feature_profile: debug\.reproducer/);
    assert.match(runner, /type: orchestration-state[\s\S]*feature_profile: debug\.reproducer/);
    assert.match(runner, /type: assignment[\s\S]*feature_profile: debug\.reproducer[\s\S]*work_type: auto/);
    assert.match(runner, /type: parent-integration[\s\S]*feature_profile: debug\.reproducer[\s\S]*work_type: auto/);
    assert.match(runner, /type: orchestration-state[\s\S]*feature_profile: debug\.reproducer[\s\S]*work_type: auto/);
    assert.match(runner, /type: orchestration-state[\s\S]*agentic_runner_layer: control-plane/);
    assert.match(runner, /type: orchestration-state[\s\S]*layer_boundary: Agentic Runner operates above coding-agents/);
    assert.match(runner, /feature_profile_guidance: .*reproduce the expected versus actual behavior/);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("codex-cli runner prompt and result carry the feature profile overlay", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    intake(repo, { taskId: "profile-runner", epoch: "e1", scope: "README.md" });
    const fakeCodex = path.join(fakeBin, "codex");
    writeFileSync(fakeCodex, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const prompt = args[args.length - 1] || "";
if (!prompt.includes("feature_profile: runner.scope-guard")) process.exit(7);
if (!prompt.includes("optional assignment overlay, not a resident agent or spawned worker")) process.exit(8);
if (!prompt.includes("Silence before heartbeat deadline is neutral, not failure")) process.exit(9);
if (!prompt.includes("Parent must not cancel, interrupt, retire, or replace during the no-interrupt window")) process.exit(10);
if (!prompt.includes("missed heartbeat -> soft ping/status request -> grace wait -> stale mark")) process.exit(11);
if (!prompt.includes("hierarchy_mode: none")) process.exit(12);
if (!prompt.includes("heartbeat_interval: PT15M")) process.exit(13);
if (!prompt.includes("cancel_reason_required: true")) process.exit(14);
const outputIndex = args.indexOf("--output-last-message");
if (outputIndex !== -1) writeFileSync(args[outputIndex + 1], "runner prompt included feature_profile: runner.scope-guard and supervision\\n", "utf8");
process.stdout.write("fake codex completed\\n");
`, "utf8");
    chmodSync(fakeCodex, 0o755);

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Test Runner",
      "--task-id",
      "profile-runner",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--feature-profile",
      "runner.scope-guard",
      "--assignment",
      "verify the prompt carries the feature profile",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      },
    });

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /ok feature_profile: runner\.scope-guard/);
    const runner = readState(repo, "runner.md");
    assert.match(runner, /type: assignment[\s\S]*feature_profile: runner\.scope-guard/);
    assert.match(runner, /type: process-runner-result[\s\S]*feature_profile: runner\.scope-guard/);
    assert.match(runner, /type: process-runner-result[\s\S]*supervision_contract: Subagent Supervision Contract/);
    assert.match(runner, /type: process-runner-result[\s\S]*hierarchy_mode: none/);
    assert.match(runner, /type: process-runner-result[\s\S]*hard_timeout: PT120M/);
    assert.match(runner, /summary: runner prompt included feature_profile: runner\.scope-guard and supervision/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("unknown feature profiles fail before runner state is appended", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "profile-reject", epoch: "e1", scope: "README.md" });

    for (const args of [
      [
        "assign",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        "profile-reject",
        "--epoch",
        "e1",
        "--scope",
        "README.md",
        "--feature-profile",
        "debug.unknown",
        "--assignment",
        "make a scoped change",
        "--expected-output",
        "assignment packet",
      ],
      [
        "collect",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        "profile-reject",
        "--epoch",
        "e1",
        "--scope",
        "README.md",
        "--feature-profile",
        "debug.unknown",
        "--status",
        "blocked",
        "--blockers",
        "unknown profile",
        "--next",
        "retry with known profile",
      ],
      [
        "run",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        "profile-reject",
        "--epoch",
        "e1",
        "--scope",
        "README.md",
        "--feature-profile",
        "debug.unknown",
        "--assignment",
        "make a scoped change",
        "--expected-output",
        "runner packet",
      ],
    ]) {
      const rejected = runCli(args);
      assert.notEqual(rejected.status, 0, `${args[0]} unexpectedly passed`);
      assert.match(rejected.stderr, /unknown feature profile: debug\.unknown/);
      assert.match(rejected.stderr, /debug\.reproducer/);
      assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("unknown work types fail before runner state is appended", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "work-type-reject", epoch: "e1", scope: "README.md" });

    for (const args of [
      [
        "assign",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        "work-type-reject",
        "--epoch",
        "e1",
        "--scope",
        "README.md",
        "--work-type",
        "mystery",
        "--assignment",
        "make a scoped change",
        "--expected-output",
        "assignment packet",
      ],
      [
        "collect",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        "work-type-reject",
        "--epoch",
        "e1",
        "--scope",
        "README.md",
        "--work-type",
        "mystery",
        "--status",
        "blocked",
        "--blockers",
        "unknown work type",
        "--next",
        "retry with known work type",
      ],
      [
        "run",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        "work-type-reject",
        "--epoch",
        "e1",
        "--scope",
        "README.md",
        "--work-type",
        "mystery",
        "--assignment",
        "make a scoped change",
        "--expected-output",
        "runner packet",
      ],
    ]) {
      const rejected = runCli(args);
      assert.notEqual(rejected.status, 0, `${args[0]} unexpectedly passed`);
      assert.match(rejected.stderr, /unknown work type: mystery/);
      assert.match(rejected.stderr, /auto, documentation, source-change, debug/);
      assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("omitted feature profile remains backwards compatible and records none", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "profile-none", epoch: "e1", scope: "README.md" });

    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "profile-none",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "make a scoped change",
      "--expected-output",
      "assignment packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);
    assert.match(assigned.stdout, /ok feature_profile: none/);

    const collected = runCli([
      "collect",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "profile-none",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--status",
      "completed",
      "--findings",
      "done",
      "--changed-files",
      "README.md",
      "--verification",
      "not run",
    ]);
    assert.equal(collected.status, 0, collected.stderr);
    const runner = readState(repo, "runner.md");
    assert.match(runner, /feature_profile: none/);
    assert.doesNotMatch(runner, /feature_profile_guidance:/);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("legacy runner packets without work_type remain explicitly backwards compatible", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "work-type-legacy", epoch: "e1", scope: "README.md" });
    const legacy = legacyRunnerWithoutWorkType("work-type-legacy");
    assert.doesNotMatch(legacy, /work_type:/);
    assert.doesNotMatch(legacy, /hierarchy_mode|heartbeat_interval|cancel_reason_required/);
    writeFileSync(path.join(repo, ".agentic-runner", "runner.md"), legacy, "utf8");

    const verify = runCli(["verify-assignments", "--target-cwd", repo]);
    assert.equal(verify.status, 0, verify.stdout + verify.stderr);
    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("validation rejects assignments missing hierarchy fields", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "hierarchy-missing", epoch: "e1", scope: "README.md" });
    const assignmentsPath = path.join(repo, ".agentic-runner", "assignments.md");
    writeFileSync(assignmentsPath, stripHierarchyLines(readFileSync(assignmentsPath, "utf8")), "utf8");

    const verify = runCli(["verify-assignments", "--target-cwd", repo]);
    assert.notEqual(verify.status, 0);
    assert.match(verify.stdout, /missing or incomplete supervision assignment fields/);
    assert.match(verify.stdout, /hierarchy_mode/);

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /remaining_depth/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("validation rejects modern runner packets missing supervision contract", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "supervision-missing", epoch: "e1", scope: "README.md" });
    writeFileSync(
      path.join(repo, ".agentic-runner", "runner.md"),
      stripSupervisionLines(modernRunnerPacket("supervision-missing")),
      "utf8",
    );

    const verify = runCli(["verify-assignments", "--target-cwd", repo]);
    assert.notEqual(verify.status, 0);
    assert.match(verify.stdout, /missing or incomplete supervision runner packet fields/);
    assert.match(verify.stdout, /supervision_contract/);

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /supervision_heartbeat/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("validation rejects modern runner packets missing machine timing fields", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "timing-missing", epoch: "e1", scope: "README.md" });
    writeFileSync(
      path.join(repo, ".agentic-runner", "runner.md"),
      stripTimingLines(modernRunnerPacket("timing-missing")),
      "utf8",
    );

    const verify = runCli(["verify-assignments", "--target-cwd", repo]);
    assert.notEqual(verify.status, 0);
    assert.match(verify.stdout, /missing or incomplete supervision runner packet fields/);
    assert.match(verify.stdout, /heartbeat_interval/);

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /hard_timeout/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("normalize adds missing hierarchy and machine supervision fields to stale generated state", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "normalize-supervision", epoch: "e1", scope: "README.md" });
    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "normalize-supervision",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "record a stale packet",
      "--expected-output",
      "assignment packet",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);

    const assignmentsPath = path.join(repo, ".agentic-runner", "assignments.md");
    const runnerPath = path.join(repo, ".agentic-runner", "runner.md");
    writeFileSync(assignmentsPath, stripTimingLines(stripHierarchyLines(readFileSync(assignmentsPath, "utf8"))), "utf8");
    writeFileSync(runnerPath, stripTimingLines(stripHierarchyLines(readFileSync(runnerPath, "utf8"))), "utf8");

    const stale = runCli(["verify-assignments", "--target-cwd", repo]);
    assert.notEqual(stale.status, 0);

    const normalized = runCli(["normalize-debugging-integrity", "--target-cwd", repo, "--execute"]);
    assert.equal(normalized.status, 0, normalized.stderr);
    assert.match(normalized.stdout, /Updated: assignments\.md/);
    assert.match(normalized.stdout, /Updated: runner\.md/);

    assertSupervisionSchema(getRoleSection(readState(repo, "assignments.md"), "Implementer"));
    assert.match(readState(repo, "runner.md"), /type: assignment[\s\S]*hierarchy_mode: none/);
    assert.match(readState(repo, "runner.md"), /type: assignment[\s\S]*heartbeat_interval: PT15M/);
    assert.equal(runCli(["verify-assignments", "--target-cwd", repo]).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("doctor does not treat trailing legacy runner packet identity as modern duplicates", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "legacy-boundary", epoch: "e1", scope: "README.md" });
    writeFileSync(path.join(repo, ".agentic-runner", "runner.md"), modernPacketFollowedByLegacyRunnerPacket("legacy-boundary"), "utf8");

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
    assert.doesNotMatch(doctor.stdout, /duplicated/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("doctor still reports duplicate identity fields inside a modern runner packet", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "runner-duplicate", epoch: "e1", scope: "README.md" });
    const runner = modernRunnerPacket("runner-duplicate")
      .replace("- task_id: runner-duplicate", "- task_id: runner-duplicate\n- task_id: duplicate");
    writeFileSync(path.join(repo, ".agentic-runner", "runner.md"), runner, "utf8");

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /task_id duplicated/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("runner validation ignores fenced field-looking bullets inside modern packets", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "runner-fence", epoch: "e1", scope: "README.md" });
    const runner = `${modernRunnerPacket("runner-fence")}
\`\`\`markdown
- task_id: fake-runner-task
- epoch: fake-runner-epoch
- scope: fake-runner-scope
\`\`\`
`;
    writeFileSync(path.join(repo, ".agentic-runner", "runner.md"), runner, "utf8");

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
    assert.doesNotMatch(doctor.stdout, /duplicated|fake-runner/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("runner validation does not accept fenced fake identity for missing structural fields", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "runner-missing-fence", epoch: "e1", scope: "README.md" });
    const runner = `${modernRunnerPacket("runner-missing-fence").replace("- task_id: runner-missing-fence\n", "")}
\`\`\`markdown
- task_id: runner-missing-fence
\`\`\`
`;
    writeFileSync(path.join(repo, ".agentic-runner", "runner.md"), runner, "utf8");

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /task_id/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("normalize runner debugging integrity stops modern packets before legacy runner packets", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "normalize-legacy-boundary", epoch: "e1", scope: "README.md" });
    const runner = modernPacketFollowedByLegacyRunnerPacket("normalize-legacy-boundary")
      .replace("- debugging_integrity: debug work requires root cause and verification\n", "");
    writeFileSync(path.join(repo, ".agentic-runner", "runner.md"), runner, "utf8");

    const normalized = runCli(["normalize-debugging-integrity", "--target-cwd", repo, "--execute"]);
    assert.equal(normalized.status, 0, normalized.stderr);
    assert.match(normalized.stdout, /Updated: runner\.md/);

    const nextRunner = readState(repo, "runner.md");
    const modernSection = nextRunner.slice(0, nextRunner.indexOf("## runner packet: legacy-import"));
    assert.match(modernSection, /- debugging_integrity: For debug or repair work, identify root cause/);

    const doctor = runCli(["doctor", "--target-cwd", repo]);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("normalize runner metacognitive gate does not accept packet fields as preamble", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, {
      taskId: "normalize-runner-preamble",
      epoch: "e1",
      scope: "bin/agentic-runner.mjs",
      workType: "source-change",
    });
    const assigned = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "normalize-runner-preamble",
      "--epoch",
      "e1",
      "--scope",
      "bin/agentic-runner.mjs",
      "--work-type",
      "source-change",
      "--assignment",
      "change source parser behavior",
      "--expected-output",
      "source patch and tests",
    ]);
    assert.equal(assigned.status, 0, assigned.stderr);

    const runner = readState(repo, "runner.md");
    assert.doesNotMatch(runner, /^## Meta-Cognitive Debug\/Repair Gate$/m);
    assert.match(runner, /^- metacognitive_gate_required: true$/m);

    const normalized = runCli(["normalize-debugging-integrity", "--target-cwd", repo, "--execute"]);
    assert.equal(normalized.status, 0, normalized.stderr);
    assert.match(normalized.stdout, /Updated: runner\.md/);

    const nextRunner = readState(repo, "runner.md");
    assert.match(nextRunner, /^## Meta-Cognitive Debug\/Repair Gate$/m);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("codex-cli runner fails when it writes outside the machine-checkable scope", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    intake(repo, { taskId: "runner-scope", epoch: "e1", scope: "allowed.txt" });
    const fakeCodex = path.join(fakeBin, "codex");
    writeFileSync(fakeCodex, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync("outside.txt", "scope drift\\n", "utf8");
process.stdout.write("fake codex completed\\n");
`, "utf8");
    chmodSync(fakeCodex, 0o755);

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-scope",
      "--epoch",
      "e1",
      "--scope",
      "allowed.txt",
      "--assignment",
      "write only the allowed file",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      },
    });

    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /outside scope allowed\.txt/);
    const runner = readState(repo, "runner.md");
    assert.match(runner, /type: process-runner-result/);
    assert.match(runner, /status: failed/);
    assert.match(runner, /failure: runner changed files outside scope allowed\.txt: outside\.txt/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner refuses pre-existing dirty paths outside scope before appending or launching", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    intake(repo, { taskId: "runner-predirty", epoch: "e1", scope: "allowed.txt" });
    writeFileSync(path.join(repo, "outside.txt"), "already dirty\n", "utf8");
    const fakeCodex = path.join(fakeBin, "codex");
    writeFileSync(fakeCodex, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync("launched.txt", "runner launched\\n", "utf8");
process.stdout.write("fake codex completed\\n");
`, "utf8");
    chmodSync(fakeCodex, 0o755);

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-predirty",
      "--epoch",
      "e1",
      "--scope",
      "allowed.txt",
      "--assignment",
      "write only the allowed file",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      },
    });

    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /dirty files outside scope allowed\.txt: outside\.txt/);
    assert.equal(existsSync(path.join(repo, "launched.txt")), false);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner rejects negative prose scope without blocking intake", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    const scope = "allowed.txt except outside.txt";
    intake(repo, { taskId: "runner-negative-scope", epoch: "e1", scope });
    const fakeCodex = path.join(fakeBin, "codex");
    writeFileSync(fakeCodex, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync("launched.txt", "runner launched\\n", "utf8");
process.stdout.write("fake codex completed\\n");
`, "utf8");
    chmodSync(fakeCodex, 0o755);

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-negative-scope",
      "--epoch",
      "e1",
      "--scope",
      scope,
      "--assignment",
      "write only the allowed file",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      },
    });

    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /negative or exclusion wording is not supported/);
    assert.equal(existsSync(path.join(repo, "launched.txt")), false);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);

    const assign = runCli([
      "assign",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-negative-scope",
      "--epoch",
      "e1",
      "--scope",
      scope,
      "--assignment",
      "record the prose scope for a human worker",
      "--expected-output",
      "assignment packet",
    ]);
    assert.equal(assign.status, 0, assign.stderr);
    assert.match(readState(repo, "runner.md"), /type: assignment/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner accepts explicit scope:v1 paths grammar", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    const scope = `scope:v1 paths=README.md,${path.join(repo, "bin/agentic-runner.mjs")},tests/`;
    intake(repo, { taskId: "runner-v1-paths", epoch: "e1", scope, workType: "documentation" });
    installFakeCodex(fakeBin, "fake codex completed\\n");

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-v1-paths",
      "--epoch",
      "e1",
      "--scope",
      scope,
      "--work-type",
      "documentation",
      "--assignment",
      "validate explicit machine paths grammar",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: pathWithFakeCodex(fakeBin),
    });

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /ok runner: codex-cli/);
    assert.match(readState(repo, "runner.md"), /type: process-runner-result/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner accepts explicit scope:v1 all grammar as whole repo", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    const scope = "scope:v1 all";
    intake(repo, { taskId: "runner-v1-all", epoch: "e1", scope });
    installFakeCodex(fakeBin, "fake codex completed\\n", 'writeFileSync("anywhere.txt", "whole repo allowed\\n", "utf8");');

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-v1-all",
      "--epoch",
      "e1",
      "--scope",
      scope,
      "--assignment",
      "validate whole-repo machine grammar",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: pathWithFakeCodex(fakeBin),
    });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(path.join(repo, "anywhere.txt"), "utf8"), "whole repo allowed\n");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner rejects glob scope before appending or launching", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    const scope = "scope:v1 paths=*.md";
    intake(repo, { taskId: "runner-glob-reject", epoch: "e1", scope });
    installFakeCodex(fakeBin, "fake codex completed\\n", 'writeFileSync("launched.txt", "runner launched\\n", "utf8");');

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-glob-reject",
      "--epoch",
      "e1",
      "--scope",
      scope,
      "--assignment",
      "glob scope should fail before launch",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: pathWithFakeCodex(fakeBin),
    });

    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /globs, wildcards, or list punctuation are not supported/);
    assert.equal(existsSync(path.join(repo, "launched.txt")), false);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner rejects outside absolute and dot-dot scope before launch", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    installFakeCodex(fakeBin, "fake codex completed\\n", 'writeFileSync("launched.txt", "runner launched\\n", "utf8");');

    for (const [taskId, scope, expected] of [
      ["runner-absolute-reject", `scope:v1 paths=${path.join(os.tmpdir(), "outside-agentic-runner.txt")}`, /absolute paths must resolve inside target cwd/],
      ["runner-dotdot-reject", "scope:v1 paths=../outside.txt", /\.\. escapes are not supported/],
    ]) {
      intake(repo, { taskId, epoch: "e1", scope, workType: "documentation" });
      const run = runCli([
        "run",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        taskId,
        "--epoch",
        "e1",
        "--scope",
        scope,
        "--assignment",
        "invalid scope should fail before launch",
        "--expected-output",
        "runner result",
        "--runner",
        "codex-cli",
      ], {
        env: pathWithFakeCodex(fakeBin),
      });

      assert.notEqual(run.status, 0, `${scope} unexpectedly passed`);
      assert.match(run.stderr, expected);
      assert.equal(existsSync(path.join(repo, "launched.txt")), false);
      assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner preserves legacy simple path-only scopes", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    installFakeCodex(fakeBin, "fake codex completed\\n");

    for (const [index, scope] of [
      "README.md",
      "allowed/",
      "bin/agentic-runner.mjs tests/workflow-state.test.mjs",
      ".",
      "repo",
      "whole repo",
    ].entries()) {
      const taskId = `runner-legacy-scope-${index}`;
      intake(repo, { taskId, epoch: "e1", scope, workType: "documentation" });
      const run = runCli([
        "run",
        "--target-cwd",
        repo,
        "--role",
        "Implementer",
        "--task-id",
        taskId,
        "--epoch",
        "e1",
        "--scope",
        scope,
        "--work-type",
        "documentation",
        "--assignment",
        "validate legacy simple path scope",
        "--expected-output",
        "runner result",
        "--runner",
        "codex-cli",
      ], {
        env: pathWithFakeCodex(fakeBin),
      });

      assert.equal(run.status, 0, `${scope}: ${run.stderr}`);
      assert.match(run.stdout, /ok runner: codex-cli/);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner rejects ambiguous legacy prose before appending or launching", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    const scope = "please edit README.md";
    intake(repo, { taskId: "runner-prose-reject", epoch: "e1", scope });
    installFakeCodex(fakeBin, "fake codex completed\\n", 'writeFileSync("launched.txt", "runner launched\\n", "utf8");');

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-prose-reject",
      "--epoch",
      "e1",
      "--scope",
      scope,
      "--assignment",
      "ambiguous prose should fail before launch",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: pathWithFakeCodex(fakeBin),
    });

    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /requires a machine-checkable path-only scope/);
    assert.equal(existsSync(path.join(repo, "launched.txt")), false);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner rejects legacy list punctuation before appending or launching", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    const scope = "README.md;tests/";
    intake(repo, { taskId: "runner-legacy-punctuation-reject", epoch: "e1", scope });
    installFakeCodex(fakeBin, "fake codex completed\\n", 'writeFileSync("launched.txt", "runner launched\\n", "utf8");');

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-legacy-punctuation-reject",
      "--epoch",
      "e1",
      "--scope",
      scope,
      "--assignment",
      "legacy punctuation should fail before launch",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: pathWithFakeCodex(fakeBin),
    });

    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /requires a machine-checkable path-only scope/);
    assert.equal(existsSync(path.join(repo, "launched.txt")), false);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner scope guard treats git rename source and destination as changed paths", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    commitFile(repo, "outside.txt", "tracked outside\n");
    intake(repo, { taskId: "runner-rename", epoch: "e1", scope: "allowed/" });
    const fakeCodex = path.join(fakeBin, "codex");
    writeFileSync(fakeCodex, `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
mkdirSync("allowed", { recursive: true });
execFileSync("git", ["mv", "outside.txt", "allowed/outside.txt"]);
process.stdout.write("fake codex renamed\\n");
`, "utf8");
    chmodSync(fakeCodex, 0o755);

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-rename",
      "--epoch",
      "e1",
      "--scope",
      "allowed/",
      "--assignment",
      "write only under allowed",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      },
    });

    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /outside scope allowed\/: outside\.txt/);
    const runner = readState(repo, "runner.md");
    assert.match(runner, /type: process-runner-result/);
    assert.match(runner, /failure: runner changed files outside scope allowed\/: outside\.txt/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner scope guard handles rename paths with spaces", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-fake-codex-"));
  try {
    commitFile(repo, "outside old name.txt", "tracked outside\n");
    intake(repo, { taskId: "runner-rename-spaces", epoch: "e1", scope: "allowed/" });
    const fakeCodex = path.join(fakeBin, "codex");
    writeFileSync(fakeCodex, `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
mkdirSync("allowed", { recursive: true });
execFileSync("git", ["mv", "outside old name.txt", "allowed/new name.txt"]);
process.stdout.write("fake codex renamed\\n");
`, "utf8");
    chmodSync(fakeCodex, 0o755);

    const run = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-rename-spaces",
      "--epoch",
      "e1",
      "--scope",
      "allowed/",
      "--assignment",
      "write only under allowed",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
    ], {
      env: pathWithFakeCodex(fakeBin),
    });

    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /outside scope allowed\/: outside old name\.txt/);
    const runner = readState(repo, "runner.md");
    assert.match(runner, /failure: runner changed files outside scope allowed\/: outside old name\.txt/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("codex-cli runner validates runner name and timeout before appending assignment state", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo, { taskId: "runner-validation", epoch: "e1", scope: "README.md" });

    const badRunner = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-validation",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "write only the readme",
      "--expected-output",
      "runner result",
      "--runner",
      "bad-runner",
    ]);
    assert.notEqual(badRunner.status, 0);
    assert.match(badRunner.stderr, /unknown runner: bad-runner/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);

    const badTimeout = runCli([
      "run",
      "--target-cwd",
      repo,
      "--role",
      "Implementer",
      "--task-id",
      "runner-validation",
      "--epoch",
      "e1",
      "--scope",
      "README.md",
      "--assignment",
      "write only the readme",
      "--expected-output",
      "runner result",
      "--runner",
      "codex-cli",
      "--timeout-ms",
      "0",
    ]);
    assert.notEqual(badTimeout.status, 0);
    assert.match(badTimeout.stderr, /invalid --timeout-ms: expected positive integer/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

function intake(repo, options) {
  const args = [
    "intake",
    "--target-cwd",
    repo,
    "--task",
    options.task || "Add a focused workflow-state safety improvement",
    "--task-id",
    options.taskId,
    "--epoch",
    options.epoch,
    "--scope",
    options.scope,
  ];
  if (options.workflowProfile) args.splice(3, 0, "--workflow-profile", options.workflowProfile);
  if (options.workType) args.splice(3, 0, "--work-type", options.workType);
  const result = runCli(args);
  assert.equal(result.status, 0, result.stderr);
}

function makeTempGitRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-workflow-"));
  const init = spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  return repo;
}

function commitFile(repo, file, contents) {
  writeFileSync(path.join(repo, file), contents, "utf8");
  assert.equal(spawnSync("git", ["config", "user.email", "agentic-runner-test@example.com"], { cwd: repo, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Agentic Runner Test"], { cwd: repo, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["add", file], { cwd: repo, encoding: "utf8" }).status, 0);
  const commit = spawnSync("git", ["commit", "-m", `track ${file}`], { cwd: repo, encoding: "utf8" });
  assert.equal(commit.status, 0, commit.stderr);
}

function installFakeCodex(fakeBin, message, extraBody = "") {
  const fakeCodex = path.join(fakeBin, "codex");
  writeFileSync(fakeCodex, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
if (outputIndex !== -1) writeFileSync(args[outputIndex + 1], "${message}", "utf8");
${extraBody}
process.stdout.write("fake codex completed\\n");
`, "utf8");
  chmodSync(fakeCodex, 0o755);
}

function pathWithFakeCodex(fakeBin) {
  return {
    ...process.env,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd || REPO_ROOT,
    env: options.env || process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function readState(repo, file) {
  return readFileSync(path.join(repo, ".agentic-runner", file), "utf8");
}

function legacyRunnerWithoutWorkType(taskId) {
  return `# Agentic Runner Operations

This file records legacy packets without work_type.

## Issued Assignments

### 2026-06-13T00:00:00.000Z Implementer ${taskId}

- type: assignment
- role: Implementer
- status: assigned
- task_id: ${taskId}
- epoch: e1
- scope: README.md
- feature_profile: none
- invocation_cwd: /tmp/legacy
- target_cwd: /tmp/legacy
- assignment: make a scoped documentation change
- expected_output: assignment packet
- nested_agentic_runner_preflight: parent already selected Agentic Runner
- debugging_integrity: debug work requires root cause and verification
- lifecycle: return concise parent-integration material, then stop

## Parent Integration Packets

### 2026-06-13T00:01:00.000Z Implementer ${taskId}

- type: parent-integration
- role: Implementer
- status: completed
- task_id: ${taskId}
- epoch: e1
- scope: README.md
- feature_profile: none
- invocation_cwd: /tmp/legacy
- target_cwd: /tmp/legacy
- findings: legacy packet completed documentation work
- changed_files: README.md
- verification: not run
- blockers: none
- assumptions: none
- next: parent final verification
- debugging_integrity: debug work requires root cause and verification
- lifecycle: Parent integrates this packet, records any blocker or follow-up, then closes or retires the subagent unless an explicitly scoped continuation is required.
`;
}

function modernRunnerPacket(taskId) {
  return `# Agentic Runner Operations

## Issued Assignments

### 2026-06-13T00:00:00.000Z Implementer ${taskId}

- type: assignment
- role: Implementer
- status: assigned
- task_id: ${taskId}
- epoch: e1
- scope: README.md
- feature_profile: none
- work_type: auto
${testPacketRouteFieldLines()}
- invocation_cwd: /tmp/modern
- target_cwd: /tmp/modern
- assignment: make a scoped documentation change
- expected_output: assignment packet
- nested_agentic_runner_preflight: parent already selected Agentic Runner
- debugging_integrity: debug work requires root cause and verification
${supervisionFieldLines()}
- lifecycle: return concise parent-integration material, then stop
`;
}

function modernPacketFollowedByLegacyRunnerPacket(taskId) {
  return `${modernRunnerPacket(taskId)}
## runner packet: legacy-import

- type: assignment
- role: Implementer
- task_id: legacy-task
- epoch: legacy-epoch
- scope: legacy-scope
- assignment: legacy docs/codex packet outside the modern section
- expected_output: legacy integration material
- debugging_integrity: legacy text outside modern packet
- lifecycle: legacy lifecycle outside modern packet
`;
}

function supervisionFieldLines() {
  return `- supervision_contract: Subagent Supervision Contract
- supervision_heartbeat: Silence before heartbeat deadline is neutral, not failure. Heartbeat is telemetry, not completion evidence.
- supervision_no_interrupt: Parent must not cancel, interrupt, retire, or replace during the no-interrupt window.
- supervision_retire_cancel_reasons: completed_retire, user_stop, safety_stop, scope_violation, stale_timeout, blocker_or_failure, stale_premise
- supervision_stale_timeout_path: missed heartbeat -> soft ping/status request -> grace wait -> stale mark -> cancel/replace only if still silent or invalid
- supervision_descendants: For permitted nested depth, descendants inherit supervision and cancellation rules; they cannot expand scope/depth/permissions.
- hierarchy_mode: none
- max_depth: 0
- depth: 0
- remaining_depth: 0
- heartbeat_interval: PT15M
- heartbeat_deadline: PT30M
- max_silence: PT45M
- soft_timeout: PT60M
- hard_timeout: PT120M
- no_interrupt_until: PT30M
- cancel_reason_required: true`;
}

function testPacketRouteFieldLines() {
  return `- route_class: unknown
- agentic_runner_layer: control-plane
- controlled_workflows: agentic-runner
- execution_owner: agentic-runner
- primary_workflow: agentic-runner
- workflow_owners: agentic-runner
- artifact_owners: agentic-runner
- verification_owners: agentic-runner
- handoff_artifacts: agentic-runner route note
- resume_checkpoint: agentic-runner-after-intake-clarification
- cross_workflow_completion: agentic-runner confirms whether specialist workflow routing is required
- specialist_owner: agentic-runner
- specialist_owner_label: Agentic Runner
- specialist_ownership: control-plane routing, cross-workflow handoff, state, supervision, resume decisions, and final audit
- agentic_runner_ownership: control-plane routing, cross-workflow handoff, state, supervision, resume decisions, and final audit
- layer_boundary: Agentic Runner operates above coding-agents, Agentic StructCiv, and CodexVideo; it routes, supervises, resumes, and audits them instead of duplicating their specialist execution.`;
}

function stripSupervisionLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^- supervision_/.test(line))
    .join("\n");
}

function stripHierarchyLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^- (?:hierarchy_mode|max_depth|depth|remaining_depth):/.test(line))
    .join("\n");
}

function stripTimingLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^- (?:heartbeat_interval|heartbeat_deadline|max_silence|soft_timeout|hard_timeout|no_interrupt_until|cancel_reason_required):/.test(line))
    .join("\n");
}

function stripWorkflowProfileLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^- workflow_(?:profile|domain|domain_contract|profile_guidance):/.test(line))
    .join("\n");
}

function assertSupervisionSchema(text) {
  assert.match(text, /^- supervision_contract: Subagent Supervision Contract$/m);
  assert.match(text, /^- hierarchy_mode: none$/m);
  assert.match(text, /^- max_depth: 0$/m);
  assert.match(text, /^- depth: 0$/m);
  assert.match(text, /^- remaining_depth: 0$/m);
  assert.match(text, /^- heartbeat_interval: PT15M$/m);
  assert.match(text, /^- heartbeat_deadline: PT30M$/m);
  assert.match(text, /^- max_silence: PT45M$/m);
  assert.match(text, /^- soft_timeout: PT60M$/m);
  assert.match(text, /^- hard_timeout: PT120M$/m);
  assert.match(text, /^- no_interrupt_until: PT30M$/m);
  assert.match(text, /^- cancel_reason_required: true$/m);
}

function getRoleSection(text, role) {
  const startMatch = new RegExp(`^## ${escapeRegExp(role)}$`, "m").exec(text);
  if (!startMatch) return "";
  const start = startMatch.index;
  const next = text.slice(start + startMatch[0].length).search(/^## /m);
  if (next === -1) return text.slice(start);
  return text.slice(start, start + startMatch[0].length + next);
}

function findLegacyIdentityMisuse(file, text) {
  const routedName = ["coding", "agents"].join("-");
  const titleName = ["Coding", "Agents"].join(" ");
  const snakeName = ["coding", "agents"].join("_");
  const upperSnakeName = ["CODING", "AGENTS"].join("_");
  const rules = [
    [new RegExp(`"name"\\s*:\\s*"${escapeRegExp(routedName)}"`, "i"), "plugin name uses legacy routed workflow id"],
    [new RegExp(`^display_name:\\s*${escapeRegExp(titleName)}\\s*$`, "m"), "display_name uses legacy title"],
    [new RegExp(`"displayName"\\s*:\\s*"${escapeRegExp(titleName)}"`, "i"), "displayName uses legacy title"],
    [new RegExp(`Generated by ${escapeRegExp(routedName)}`, "i"), "generated identity uses legacy routed workflow id"],
    [new RegExp(`\\bSTATE_DIR_NAME\\s*=\\s*["']\\.${escapeRegExp(routedName)}["']`), "state dir uses legacy dot-dir"],
    [new RegExp(`\\.${escapeRegExp(routedName)}\\/`), "path uses legacy dot-dir"],
    [new RegExp(`\\b${escapeRegExp(snakeName)}\\b`), "snake_case legacy workflow id"],
    [new RegExp(`\\b${escapeRegExp(upperSnakeName)}\\b`), "upper snake legacy workflow id"],
  ];
  return rules
    .filter(([pattern]) => pattern.test(text))
    .map(([, message]) => `${file}: ${message}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
