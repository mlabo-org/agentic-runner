import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "migrate-legacy-agentic-runner-state.mjs");

test("legacy migration dry-run reports planned actions without writes", () => {
  const repo = makeLegacyRepo();
  try {
    const excludePath = path.join(repo, ".git", "info", "exclude");
    const beforeExclude = readFileSync(excludePath, "utf8");
    const result = runMigration(["--repo", repo]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mode: dry-run/);
    assert.match(result.stdout, /legacy_dirs: docs\/codex/);
    assert.match(result.stdout, /would create preflight backup before apply/);
    assert.match(result.stdout, /would copy legacy contents to \.agentic-runner\//);
    assert.match(result.stdout, /would update \.git\/info\/exclude/);
    assert.match(result.stdout, /would untrack 1 legacy tracked file\(s\)/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner")), false);
    assert.equal(existsSync(path.join(repo, ".agentic-runner-migration-backups")), false);
    assert.equal(readFileSync(excludePath, "utf8"), beforeExclude);
    assert.equal(gitOutput(repo, ["ls-files", "--", "docs/codex"]).trim(), "docs/codex/task.md");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("legacy migration apply copies state, backs up, excludes, and untracks legacy docs", () => {
  const repo = makeLegacyRepo();
  try {
    const result = runMigration(["--repo", repo, "--apply"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mode: apply/);
    assert.equal(readFileSync(path.join(repo, ".agentic-runner", "task.md"), "utf8"), "legacy task\n");
    assert.equal(existsSync(path.join(repo, "docs", "codex", "task.md")), true);

    const backupRoot = path.join(repo, ".agentic-runner-migration-backups");
    const [backupId] = readdirSync(backupRoot);
    assert.ok(backupId, "missing migration backup id");
    const backupDir = path.join(backupRoot, backupId);
    assert.equal(readFileSync(path.join(backupDir, "legacy", "docs", "codex", "task.md"), "utf8"), "legacy task\n");
    assert.equal(existsSync(path.join(backupDir, "git-info-exclude.before")), true);
    assert.equal(existsSync(path.join(backupDir, "manifest.json")), true);

    const exclude = readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8");
    assert.match(exclude, /^\.agentic-runner\/$/m);
    assert.match(exclude, /^\.agentic-runner-migration-backups\/$/m);
    assert.match(exclude, /^docs\/codex\/$/m);
    assert.equal(gitOutput(repo, ["ls-files", "--", "docs/codex"]).trim(), "");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("legacy migration refuses broad apply without explicit root apply allowance", () => {
  const container = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-migration-root-"));
  const repo = path.join(container, "repo");
  mkdirSync(repo);
  makeLegacyRepo(repo);
  try {
    const result = runMigration(["--root", container, "--apply"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /--apply with --root or --default-roots requires --allow-root-apply/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner")), false);
    assert.equal(existsSync(path.join(repo, ".agentic-runner-migration-backups")), false);
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

test("legacy migration skips plugin cache paths", () => {
  const container = mkdtempSync(path.join(os.tmpdir(), "agentic-runner-cache-skip-"));
  const repo = path.join(container, ".codex", "plugins", "cache", "agentic-runner");
  mkdirSync(repo, { recursive: true });
  makeLegacyRepo(repo);
  try {
    const result = runMigration(["--repo", repo, "--apply"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skipped cache path/);
    assert.equal(existsSync(path.join(repo, ".agentic-runner")), false);
    assert.equal(existsSync(path.join(repo, ".agentic-runner-migration-backups")), false);
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

function makeLegacyRepo(existingPath = "") {
  const repo = existingPath || mkdtempSync(path.join(os.tmpdir(), "agentic-runner-migration-"));
  assert.equal(spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.email", "agentic-runner-test@example.com"], { cwd: repo, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Agentic Runner Test"], { cwd: repo, encoding: "utf8" }).status, 0);
  mkdirSync(path.join(repo, "docs", "codex"), { recursive: true });
  writeFileSync(path.join(repo, "docs", "codex", "task.md"), "legacy task\n", "utf8");
  assert.equal(spawnSync("git", ["add", "docs/codex/task.md"], { cwd: repo, encoding: "utf8" }).status, 0);
  const commit = spawnSync("git", ["commit", "-m", "track legacy state"], { cwd: repo, encoding: "utf8" });
  assert.equal(commit.status, 0, commit.stderr);
  return repo;
}

function runMigration(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function gitOutput(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
