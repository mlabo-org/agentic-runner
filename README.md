# Agentic Runner

Agentic Runner is a thin generic AGENT upper control-plane plugin for explicit Agentic Runner requests. It records route state, handoff, resume checkpoints, audit context, scoped assignments, and supervision metadata for declared subordinate owners such as tools, skills, plugins, MCP/app surfaces, `coding-agents`, Agentic StructCiv, CodexVideo, and future specialist workflows.

It is not the execution owner for ordinary one-off single-domain tasks. Leaf tools, skills, plugins, and specialist workflows produce domain artifacts; Agentic Runner keeps the route and cross-workflow state inspectable.

## Use Cases

- Explicit Agentic Runner or control-plane routing requests.
- `.agentic-runner/` workflow state with `task_id`, `epoch`, `scope`, and lifecycle fields.
- Handoff, resume, audit, and supervised assignment packets.
- Source/cache/runtime boundary audits for plugin-source work.
- Legacy `docs/codex` or `doc/codex` migration planning.

## Write Boundary

The plugin can write scoped workflow and migration state when the active command asks for it:

- `<git-root>/.agentic-runner/`
- the target repository's `.git/info/exclude`
- migration reports and preflight backups when migration apply/report commands are explicitly run

This does not include source edits, commits, cache refresh, plugin activation, marketplace updates, broad repository cleanup, or specialist-owned production artifacts.

## Source And Cache

This directory is the plugin source of truth. The installed runtime copy under `~/.codex/plugins/cache/` is disposable cache and should not be patched as the primary edit target.

After source changes, validate source behavior first. Cache refresh and Codex restart or new-thread activation are separate operational steps.

## Checks

```sh
npm test
npm run test:cli
npm run test:migration
npm run doctor:self
```

`doctor:self` validates the source-tree CLI against this plugin repository. It does not prove that the installed cache copy has been refreshed or activated.

## Legacy Migration

`scripts/migrate-legacy-agentic-runner-state.mjs` defaults to dry-run. Apply mode is explicit and creates preflight backups before changing a repository. Legacy directories are copied and untracked from Git when applicable; they are not deleted.
