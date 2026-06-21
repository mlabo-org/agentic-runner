#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const TOOL = "coding-agents legacy state migration";
const LEGACY_RELS = ["docs/codex", "doc/codex"];
const SKIP_DIR_NAMES = new Set([
  ".git",
  ".coding-agents",
  ".coding-agents-migration-backups",
  ".codex",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
]);
const DEFAULT_MAX_DEPTH = 4;

const DEFAULT_ROOTS = [
  {
    label: "Desktop",
    path: path.join(os.homedir(), "Desktop"),
  },
  {
    label: "plugin source canonical location",
    path: path.join(os.homedir(), "plugins"),
  },
  {
    label: "skill source canonical location",
    path: path.join(os.homedir(), ".codex", "skills"),
  },
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const startedAt = new Date();
  const runId = formatRunId(startedAt);
  const audit = {
    tool: TOOL,
    mode: args.apply ? "apply" : "dry-run",
    startedAt: startedAt.toISOString(),
    runId,
    cwd: process.cwd(),
    inputs: [],
    skippedInputs: [],
    repositories: [],
    errors: [],
  };

  try {
    const inputs = resolveInputs(args, audit);
    validateApplyScope(args, inputs);
    const repoPlans = discoverRepoPlans(args, inputs, audit);
    audit.repositories = repoPlans;

    if (args.apply) {
      for (const plan of repoPlans) {
        applyPlan(plan, runId);
      }
    }
  } catch (error) {
    audit.errors.push(error.message);
    process.exitCode = 1;
  }

  const report = renderAuditReport(audit);
  if (args.report) {
    writeTextFile(absPath(args.report), report);
  }
  if (args.apply) {
    writeApplyReports(audit, report);
  }
  process.stdout.write(report);
  if (!report.endsWith("\n")) process.stdout.write("\n");
}

function parseArgs(argv) {
  const args = {
    apply: false,
    allowRootApply: false,
    defaultRoots: false,
    help: false,
    maxDepth: DEFAULT_MAX_DEPTH,
    repos: [],
    roots: [],
    legacyDirs: [],
    report: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--apply") {
      args.apply = true;
      continue;
    }
    if (token === "--allow-root-apply") {
      args.allowRootApply = true;
      continue;
    }
    if (token === "--default-roots") {
      args.defaultRoots = true;
      continue;
    }
    if (token === "--repo") {
      args.repos.push(requireValue(argv, ++i, token));
      continue;
    }
    if (token === "--root") {
      args.roots.push(requireValue(argv, ++i, token));
      continue;
    }
    if (token === "--legacy") {
      args.legacyDirs.push(requireValue(argv, ++i, token));
      continue;
    }
    if (token === "--report") {
      args.report = requireValue(argv, ++i, token);
      continue;
    }
    if (token === "--max-depth") {
      args.maxDepth = parsePositiveInt(requireValue(argv, ++i, token), token);
      continue;
    }
    throw new CliError(`unknown argument: ${token}`);
  }

  return args;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/migrate-legacy-coding-agents-state.mjs [options]

Safe migration for legacy Coding Agents state directories.

Default behavior:
  - dry-run only; no file or Git index changes
  - if no --repo, --root, --legacy, or --default-roots is provided, inspect the current Git repository only
  - copy plans target <git-root>/.coding-agents/ and never delete legacy directories

Apply behavior:
  - requires --apply
  - creates a preflight backup before changing each repository
  - updates .git/info/exclude, never .gitignore
  - untracks legacy docs with git rm --cached -f while preserving working files
  - --root and --default-roots apply require --allow-root-apply to prevent broad accidental runs

Options:
  --repo <path>          Inspect one Git repository. Repeatable.
  --root <path>          Discover Git repositories under a container root. Repeatable.
  --legacy <path>        Inspect one legacy doc/codex or docs/codex directory. Repeatable.
  --default-roots        Add documented roots:
                         ${DEFAULT_ROOTS.map((root) => `${root.label}: ${root.path}`).join("\n                         ")}
  --max-depth <n>        Root discovery depth. Default: ${DEFAULT_MAX_DEPTH}
  --report <path>        Also write the audit report to this path.
  --apply                Perform migration. Without this flag the command is a dry-run.
  --allow-root-apply     Permit --apply with --root or --default-roots.
  -h, --help             Show this help.
`);
}

function resolveInputs(args, audit) {
  const inputs = [];

  for (const repo of args.repos) {
    inputs.push({ type: "repo", path: absPath(repo), source: "--repo" });
  }
  for (const root of args.roots) {
    inputs.push({ type: "root", path: absPath(root), source: "--root" });
  }
  for (const legacyDir of args.legacyDirs) {
    inputs.push({ type: "legacy", path: absPath(legacyDir), source: "--legacy" });
  }
  if (args.defaultRoots) {
    for (const root of DEFAULT_ROOTS) {
      inputs.push({ type: "root", path: root.path, source: `--default-roots:${root.label}` });
    }
  }

  if (inputs.length === 0) {
    const cwdRoot = gitRootOrNull(process.cwd());
    if (!cwdRoot) throw new CliError("current directory is not inside a Git repository; pass --repo or --root");
    inputs.push({ type: "repo", path: cwdRoot, source: "default-current-repo" });
  }

  for (const input of inputs) {
    audit.inputs.push(`${input.source} ${input.path}`);
  }

  return inputs;
}

function validateApplyScope(args, inputs) {
  if (!args.apply) return;
  const hasRootInput = inputs.some((input) => input.type === "root");
  if (hasRootInput && !args.allowRootApply) {
    throw new CliError("--apply with --root or --default-roots requires --allow-root-apply");
  }
}

function discoverRepoPlans(args, inputs, audit) {
  const reposByRoot = new Map();
  const explicitLegacyDirs = [];

  for (const input of inputs) {
    if (!existsSync(input.path)) {
      audit.skippedInputs.push(`${input.source} missing: ${input.path}`);
      continue;
    }
    if (isCachePath(input.path)) {
      audit.skippedInputs.push(`${input.source} skipped cache path: ${input.path}`);
      continue;
    }
    if (input.type === "repo") {
      const root = gitRootOrNull(input.path);
      if (!root) {
        audit.skippedInputs.push(`${input.source} is not a Git repository: ${input.path}`);
        continue;
      }
      reposByRoot.set(root, { root, discoveredBy: [input.source] });
      continue;
    }
    if (input.type === "legacy") {
      const root = gitRootOrNull(input.path);
      if (!root) {
        audit.skippedInputs.push(`${input.source} legacy dir is not inside Git: ${input.path}`);
        continue;
      }
      explicitLegacyDirs.push({ repoRoot: root, abs: input.path, source: input.source });
      reposByRoot.set(root, { root, discoveredBy: [input.source] });
      continue;
    }
    if (input.type === "root") {
      for (const repoRoot of discoverReposUnder(input.path, args.maxDepth, audit, input.source)) {
        const existing = reposByRoot.get(repoRoot);
        if (existing) existing.discoveredBy.push(input.source);
        else reposByRoot.set(repoRoot, { root: repoRoot, discoveredBy: [input.source] });
      }
      continue;
    }
  }

  const explicitByRepo = groupExplicitLegacyDirs(explicitLegacyDirs);
  const plans = [];
  for (const repo of Array.from(reposByRoot.values()).sort((a, b) => a.root.localeCompare(b.root))) {
    const legacyDirs = discoverLegacyDirs(repo.root);
    const extraLegacyDirs = explicitByRepo.get(repo.root) || [];
    for (const legacyDir of extraLegacyDirs) {
      if (!legacyDirs.some((candidate) => candidate.abs === legacyDir.abs)) legacyDirs.push(legacyDir);
    }
    if (legacyDirs.length === 0) continue;

    const trackedLegacyFiles = trackedFilesForLegacy(repo.root, legacyDirs);
    plans.push({
      repoRoot: repo.root,
      discoveredBy: repo.discoveredBy,
      legacyDirs: legacyDirs.sort((a, b) => a.rel.localeCompare(b.rel)),
      targetDir: path.join(repo.root, ".coding-agents"),
      backupDir: "",
      excludePatterns: excludePatternsFor(legacyDirs),
      trackedLegacyFiles,
      actions: [],
      warnings: [],
      errors: [],
    });
  }

  return plans;
}

function discoverReposUnder(root, maxDepth, audit, source) {
  const repos = [];
  const absRoot = absPath(root);
  const directRoot = gitRootOrNull(absRoot);
  if (directRoot && directRoot === absRoot) {
    repos.push(directRoot);
    return repos;
  }

  walk(absRoot, 0);
  return Array.from(new Set(repos)).sort();

  function walk(dir, depth) {
    if (depth > maxDepth || isCachePath(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      audit.skippedInputs.push(`${source} unreadable: ${dir} (${error.message})`);
      return;
    }

    if (entries.some((entry) => entry.name === ".git")) {
      repos.push(dir);
      return;
    }
    if (depth === maxDepth) return;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (isCachePath(child)) continue;
      walk(child, depth + 1);
    }
  }
}

function groupExplicitLegacyDirs(legacyDirs) {
  const grouped = new Map();
  for (const legacyDir of legacyDirs) {
    const rel = slash(path.relative(legacyDir.repoRoot, legacyDir.abs));
    if (!isLegacyRel(rel)) continue;
    const item = { ...legacyDir, rel };
    const list = grouped.get(legacyDir.repoRoot) || [];
    list.push(item);
    grouped.set(legacyDir.repoRoot, list);
  }
  return grouped;
}

function discoverLegacyDirs(repoRoot) {
  const legacyDirs = [];
  for (const rel of LEGACY_RELS) {
    const abs = path.join(repoRoot, rel);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      legacyDirs.push({ repoRoot, rel, abs, source: "repo-inspection" });
    }
  }
  return legacyDirs;
}

function trackedFilesForLegacy(repoRoot, legacyDirs) {
  const rels = legacyDirs.map((dir) => dir.rel);
  if (rels.length === 0) return [];
  const result = runGit(repoRoot, ["ls-files", "--", ...rels], { allowFailure: true });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

function excludePatternsFor(legacyDirs) {
  const patterns = [".coding-agents/", ".coding-agents-migration-backups/"];
  for (const legacyDir of legacyDirs) {
    patterns.push(`${slash(legacyDir.rel).replace(/\/+$/, "")}/`);
  }
  return Array.from(new Set(patterns));
}

function applyPlan(plan, runId) {
  try {
    plan.backupDir = path.join(plan.repoRoot, ".coding-agents-migration-backups", runId);
    createPreflightBackup(plan);
    addExcludePatterns(plan);
    migrateLegacyDirs(plan, runId);
    untrackLegacyDirs(plan);
  } catch (error) {
    plan.errors.push(error.message);
  }
}

function createPreflightBackup(plan) {
  mkdirSync(plan.backupDir, { recursive: true });

  for (const legacyDir of plan.legacyDirs) {
    const dest = path.join(plan.backupDir, "legacy", legacyDir.rel);
    copyTree(legacyDir.abs, dest, {
      onSkip: (message) => plan.warnings.push(`backup skip: ${message}`),
    });
  }

  if (existsSync(plan.targetDir)) {
    copyTree(plan.targetDir, path.join(plan.backupDir, "existing-dot-coding-agents"), {
      onSkip: (message) => plan.warnings.push(`backup skip: ${message}`),
    });
  }

  const excludePath = gitPath(plan.repoRoot, "info/exclude");
  if (existsSync(excludePath)) {
    ensureParentDir(path.join(plan.backupDir, "git-info-exclude.before"));
    copyFileSync(excludePath, path.join(plan.backupDir, "git-info-exclude.before"));
  } else {
    writeTextFile(path.join(plan.backupDir, "git-info-exclude.before"), "");
  }

  writeTextFile(path.join(plan.backupDir, "git-status.before.txt"), mustRunGit(plan.repoRoot, ["status", "--short", "--branch"]));
  writeTextFile(path.join(plan.backupDir, "git-ls-files.before.txt"), mustRunGit(plan.repoRoot, ["ls-files"]));
  writeTextFile(
    path.join(plan.backupDir, "manifest.json"),
    `${JSON.stringify(
      {
        repoRoot: plan.repoRoot,
        backupDir: plan.backupDir,
        legacyDirs: plan.legacyDirs.map((dir) => dir.rel),
        targetDir: ".coding-agents",
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  plan.actions.push(`created preflight backup: ${slash(path.relative(plan.repoRoot, plan.backupDir))}`);
}

function addExcludePatterns(plan) {
  const excludePath = gitPath(plan.repoRoot, "info/exclude");
  ensureParentDir(excludePath);
  const original = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  const existing = new Set(
    original
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const additions = plan.excludePatterns.filter((pattern) => !existing.has(pattern));
  if (additions.length === 0) {
    plan.actions.push("git info/exclude already contained migration patterns");
    return;
  }

  const prefix = original.endsWith("\n") || original.length === 0 ? "" : "\n";
  const block = `${prefix}# coding-agents legacy state migration\n${additions.join("\n")}\n`;
  writeTextFile(excludePath, original + block);
  plan.actions.push(`updated .git/info/exclude: ${additions.join(", ")}`);
}

function migrateLegacyDirs(plan, runId) {
  mkdirSync(plan.targetDir, { recursive: true });
  for (const legacyDir of plan.legacyDirs) {
    copyLegacyContents({
      sourceDir: legacyDir.abs,
      targetDir: plan.targetDir,
      conflictDir: path.join(plan.targetDir, "_migration_conflicts", runId, legacyDir.rel),
      actions: plan.actions,
      warnings: plan.warnings,
      label: legacyDir.rel,
    });
  }
}

function copyLegacyContents(context) {
  const entries = listTree(context.sourceDir);
  if (entries.length === 0) {
    context.actions.push(`legacy dir empty: ${context.label}`);
    return;
  }

  let copied = 0;
  let identical = 0;
  let conflicts = 0;
  let skipped = 0;

  for (const entry of entries) {
    const rel = slash(path.relative(context.sourceDir, entry.abs));
    const dest = path.join(context.targetDir, rel);
    if (entry.kind === "directory") {
      mkdirSync(dest, { recursive: true });
      continue;
    }
    if (entry.kind === "unsupported") {
      skipped += 1;
      context.warnings.push(`skipped unsupported file type: ${context.label}/${rel}`);
      continue;
    }

    if (!existsSync(dest)) {
      ensureParentDir(dest);
      copyNode(entry.abs, dest, entry.kind);
      copied += 1;
      continue;
    }

    if (entry.kind === "file" && isFile(dest) && sameFile(entry.abs, dest)) {
      identical += 1;
      continue;
    }

    const conflictDest = path.join(context.conflictDir, rel);
    ensureParentDir(conflictDest);
    copyNode(entry.abs, nextAvailablePath(conflictDest), entry.kind);
    conflicts += 1;
  }

  context.actions.push(
    `copied ${context.label} -> .coding-agents/ (new=${copied}, identical=${identical}, conflicts-preserved=${conflicts}, skipped=${skipped})`,
  );
}

function untrackLegacyDirs(plan) {
  if (plan.trackedLegacyFiles.length === 0) {
    plan.actions.push("no tracked legacy docs to untrack");
    return;
  }
  const rels = plan.legacyDirs.map((dir) => dir.rel);
  const result = runGit(plan.repoRoot, ["rm", "-r", "--cached", "-f", "--ignore-unmatch", "--", ...rels], {
    allowFailure: true,
  });
  if (result.status !== 0) {
    plan.errors.push(`git rm --cached failed: ${result.stderr || result.stdout}`.trim());
    return;
  }
  plan.actions.push(`untracked legacy docs from Git index: ${rels.join(", ")}`);
}

function writeApplyReports(audit, report) {
  for (const plan of audit.repositories) {
    if (!plan.backupDir) continue;
    try {
      writeTextFile(path.join(plan.backupDir, "audit-report.md"), report);
    } catch (error) {
      plan.warnings.push(`failed to write backup audit report: ${error.message}`);
    }
  }
}

function renderAuditReport(audit) {
  const lines = [];
  lines.push("# Coding Agents Legacy State Migration Audit");
  lines.push("");
  lines.push(`- mode: ${audit.mode}`);
  lines.push(`- started_at: ${audit.startedAt}`);
  lines.push(`- run_id: ${audit.runId}`);
  lines.push(`- cwd: ${audit.cwd}`);
  lines.push("");
  lines.push("## Inputs");
  if (audit.inputs.length === 0) lines.push("- none");
  else for (const input of audit.inputs) lines.push(`- ${input}`);
  if (audit.skippedInputs.length > 0) {
    lines.push("");
    lines.push("## Skipped Inputs");
    for (const skipped of audit.skippedInputs) lines.push(`- ${skipped}`);
  }

  lines.push("");
  lines.push("## Repositories");
  if (audit.repositories.length === 0) {
    lines.push("- no legacy doc/codex or docs/codex directories discovered");
  } else {
    for (const plan of audit.repositories) {
      lines.push(`### ${plan.repoRoot}`);
      lines.push(`- discovered_by: ${plan.discoveredBy.join(", ")}`);
      lines.push(`- target: ${slash(path.relative(plan.repoRoot, plan.targetDir)) || ".coding-agents"}`);
      if (plan.backupDir) lines.push(`- backup: ${slash(path.relative(plan.repoRoot, plan.backupDir))}`);
      lines.push(`- legacy_dirs: ${plan.legacyDirs.map((dir) => dir.rel).join(", ")}`);
      lines.push(`- tracked_legacy_files: ${plan.trackedLegacyFiles.length}`);
      lines.push(`- exclude_patterns: ${plan.excludePatterns.join(", ")}`);
      lines.push("- actions:");
      const actions = plan.actions.length > 0 ? plan.actions : plannedActions(plan);
      for (const action of actions) lines.push(`  - ${action}`);
      if (plan.warnings.length > 0) {
        lines.push("- warnings:");
        for (const warning of plan.warnings) lines.push(`  - ${warning}`);
      }
      if (plan.errors.length > 0) {
        lines.push("- errors:");
        for (const error of plan.errors) lines.push(`  - ${error}`);
      }
    }
  }

  if (audit.errors.length > 0) {
    lines.push("");
    lines.push("## Errors");
    for (const error of audit.errors) lines.push(`- ${error}`);
  }

  lines.push("");
  lines.push("## Safety Notes");
  lines.push("- Dry-run is the default. Apply requires --apply.");
  lines.push("- Legacy directories are copied and untracked only; they are not deleted.");
  lines.push("- Ignore rules are written to .git/info/exclude, not .gitignore.");
  lines.push("- Cache paths under ~/.codex/plugins/cache are skipped.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function plannedActions(plan) {
  const actions = [];
  actions.push("would create preflight backup before apply");
  actions.push(`would copy legacy contents to .coding-agents/ without overwriting divergent files`);
  actions.push(`would update .git/info/exclude: ${plan.excludePatterns.join(", ")}`);
  if (plan.trackedLegacyFiles.length > 0) {
    actions.push(`would untrack ${plan.trackedLegacyFiles.length} legacy tracked file(s) with git rm --cached -f`);
  } else {
    actions.push("would not run git rm --cached because no tracked legacy files were found");
  }
  return actions;
}

function listTree(root) {
  const results = [];
  walk(root);
  return results;

  function walk(current) {
    const stat = lstatSync(current);
    if (stat.isDirectory()) {
      results.push({ abs: current, kind: "directory" });
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        walk(path.join(current, entry.name));
      }
      return;
    }
    if (stat.isFile()) {
      results.push({ abs: current, kind: "file" });
      return;
    }
    if (stat.isSymbolicLink()) {
      results.push({ abs: current, kind: "symlink" });
      return;
    }
    results.push({ abs: current, kind: "unsupported" });
  }
}

function copyTree(src, dest, hooks = {}) {
  const stat = lstatSync(src);
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      copyTree(path.join(src, entry.name), path.join(dest, entry.name), hooks);
    }
    return;
  }
  if (stat.isFile()) {
    ensureParentDir(dest);
    copyFileSync(src, dest);
    return;
  }
  if (stat.isSymbolicLink()) {
    ensureParentDir(dest);
    symlinkSync(readlinkSync(src), dest);
    return;
  }
  hooks.onSkip?.(`${src} has unsupported file type`);
}

function copyNode(src, dest, kind) {
  if (kind === "file") {
    copyFileSync(src, dest);
    return;
  }
  if (kind === "symlink") {
    symlinkSync(readlinkSync(src), dest);
    return;
  }
  throw new CliError(`unsupported copy kind: ${kind}`);
}

function sameFile(left, right) {
  return hashFile(left) === hashFile(right);
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function isFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function nextAvailablePath(filePath) {
  if (!existsSync(filePath)) return filePath;
  const parsed = path.parse(filePath);
  for (let i = 1; i < 1000; i += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}.${i}${parsed.ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new CliError(`could not find available conflict path for ${filePath}`);
}

function gitRootOrNull(startPath) {
  const result = runGit(absPath(startPath), ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function gitPath(repoRoot, gitRelativePath) {
  const result = runGit(repoRoot, ["rev-parse", "--git-path", gitRelativePath], { allowFailure: false });
  const raw = result.stdout.trim();
  return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
}

function mustRunGit(repoRoot, args) {
  const result = runGit(repoRoot, args, { allowFailure: false });
  return result.stdout;
}

function runGit(cwd, args, options = {}) {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    if (!options.allowFailure) throw error;
    return {
      status: typeof error.status === "number" ? error.status : 1,
      stdout: error.stdout?.toString() || "",
      stderr: error.stderr?.toString() || error.message,
    };
  }
}

function isLegacyRel(rel) {
  return rel === "docs/codex" || rel === "doc/codex" || rel.endsWith("/docs/codex") || rel.endsWith("/doc/codex");
}

function isCachePath(filePath) {
  const normalized = slash(absPath(filePath));
  return normalized.includes("/.codex/plugins/cache/") || normalized.endsWith("/.codex/plugins/cache");
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new CliError(`missing value for ${flag}`);
  return value;
}

function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new CliError(`${flag} must be a non-negative integer`);
  return parsed;
}

function ensureParentDir(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeTextFile(filePath, body) {
  ensureParentDir(filePath);
  writeFileSync(filePath, body, "utf8");
}

function absPath(filePath) {
  if (filePath.startsWith("~")) return path.join(os.homedir(), filePath.slice(1));
  return path.resolve(filePath);
}

function slash(filePath) {
  return filePath.split(path.sep).join("/");
}

function formatRunId(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

class CliError extends Error {}

main();
