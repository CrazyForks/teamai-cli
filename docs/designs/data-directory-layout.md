# Design: teamai data directory layout — global home + per-project partitioning

> Status: **P0 implemented** (this doc ships with the P0 PR for issue #374).
> P1–P3 are follow-up phases, tracked below.

## Problem

teamai's machine-local data currently lives inside the business repository. In a
real checkout `<repo>/.teamai/` measured **18 MB** — a team-repo clone (12 MB),
downloaded skill resources (4.1 MB), a search index (1.8 MB), plus config, state,
`env`, `token`, and docs. This causes three concrete problems:

- **Workspace residue.** Machine data pollutes the business repo working tree.
- **Worktree / subdirectory blindness.** teamai only looked at the cwd's own
  `.teamai/config.yaml`, so running from a subdirectory found nothing, and a git
  worktree (which does not carry gitignored `.teamai/`) had no config at all.
- **Cross-project mixing.** Global singletons under `~/.teamai/`
  (`dashboard`, `sessions`, `votes`, `usage.jsonl`, ...) are hardcoded to one
  location, so multiple projects' data is indistinguishable.

The end goal (P1+) is to move machine-local data to `~/.teamai/projects/<slug>/`
so the business workspace has **zero residue**, partitioned per project.

## The two anchors (the core model)

A git worktree has two distinct "roots", and teamai needs both:

```
projectAnchor  = first entry of `git worktree list --porcelain` (the main worktree)
                 → the MAIN checkout, SHARED by the repo and all its worktrees.
                 → the stable per-project identity; P1 keys machine data under
                   ~/.teamai/projects/<slug(projectAnchor)>/ by it.

workspaceRoot  = `git rev-parse --show-toplevel`
                 → the CURRENT checkout, DISTINCT per worktree.
                 → where project-scope AI-tool resources (skills/rules/agents,
                   tool config, CLAUDE.md) must be written.
```

They are equal for a plain (non-worktree) repository.

**Why resources must go to `workspaceRoot`, not `projectAnchor`:** every AI tool
(Claude, Codex, CodeBuddy, OpenCode) discovers project resources by scanning up
from the launch directory to the *current* repository root. None of them follows
`git-common-dir` back to the main checkout, and gitignored files do not appear in
a fresh worktree. So resources have to land in the worktree the user is actually
working in.

### Why the main worktree, not `git-common-dir` (verified)

`projectAnchor` uses the first entry of `git worktree list --porcelain` rather than
`dirname(git rev-parse --git-common-dir)`. Two traps make the git-common-dir route
wrong:

- With `git init --separate-git-dir`, the common dir lives outside the checkout
  (e.g. `gitdirs/proj.git`), so its parent is a shared `gitdirs/` — **colliding**
  across unrelated repos, and not the workspace either.
- `--git-common-dir` alone returns a **relative** path (`.git`) in the main repo
  (only absolute inside a worktree), so it needs `--path-format=absolute` (git
  ≥ 2.31) just to be usable — and still hits the collision above.

`git worktree list --porcelain` lists the main worktree first, and every linked
worktree reports the same first entry, giving a shared-yet-distinct identity in all
cases. Both anchors are `realpath`-normalized so a symlinked prefix (macOS `/tmp` →
`/private/tmp`) does not make one checkout look like two.

## P0 (this PR) — atomic lock + anchor split

P0 is deliberately **structural**: it establishes the primitive and fixes
discovery, WITHOUT relocating any data. The physical layout
(`<projectRoot>/.teamai/`, `getTeamaiHome()`) is unchanged, and the 61
`resolveBaseDir()` call sites are untouched — their divergence from the data home
is a P1 concern. This keeps P0 independently reviewable (issue R7).

1. **Atomic locking** — `src/update.ts` `acquireLock()` / `releaseLock()`.
   The old lock was check-then-write (`pathExists` → `writeFile`): two racing
   processes could both observe "no lock" and both succeed, and `releaseLock()`
   unconditionally deleted the file — including a lock another process later
   acquired. Rewritten to:
   - Acquire with an atomic exclusive create (`writeFile(path, payload, { flag: 'wx' })`
     = `O_CREAT|O_EXCL`); payload is JSON `{ pid, startedAt, owner }` with a random
     `owner` token.
   - On `EEXIST`, reclaim only a **stale** lock (dead pid via `process.kill(pid,0)`,
     or unparseable content). The reclaim is **serialized behind an atomically-created
     reclaim sentinel** and finished with an atomic rename-into-place, so concurrent
     reclaimers cannot each end up believing they hold the lock; a live holder returns
     "busy".
   - `releaseLock()` returns early when this process holds no owner token for the
     path, and otherwise deletes only when the on-disk `owner` still matches the token
     this process recorded — never another process's lock.
   - Back-compatible with legacy plain-integer PID lock files.
   The three call sites (`update.ts`, `bootstrap.ts`, `utils/reports-branch.ts`)
   keep their signatures and all benefit.

2. **Anchor primitive** — `src/utils/git.ts` `resolveAnchors(cwd?)`.
   Returns `{ workspaceRoot, projectAnchor }`, or `null` outside a git repo (callers
   fall back to cwd-based behavior).

3. **Subdirectory / worktree-aware discovery** — `src/config.ts`
   `detectProjectConfig()`. When the cwd has no `.teamai/config.yaml`, it retries at
   the git `workspaceRoot`, so teamai runs from any subdirectory and resolves a
   worktree's `projectRoot` to that worktree.

4. **Semantics** — `resolveBaseDir()` (`src/types.ts`) documented to return the
   *workspace root*; behavior unchanged.

### P0 acceptance (verified end-to-end with the real CLI)

- Concurrent `acquireLock` on one path → exactly one winner; stale locks reclaimed;
  non-owner release is a no-op (`src/__tests__/lock-atomic.test.ts`).
- `resolveAnchors` on a real repo + real `git worktree add`: shared anchor, distinct
  workspace (`src/__tests__/anchors.test.ts`).
- Real CLI: `status`/`pull` from a nested subdirectory detect **project** scope and
  deploy to the repo root; run inside a worktree, resources land in the worktree and
  the main checkout is untouched (`src/__tests__/detect-subdir.test.ts` + manual run).

## Follow-up phases (not in this PR)

- **P1** — `slug(projectAnchor) = <basename>-<sha256 prefix>`, `projectDataHome(anchor)`,
  partition-level `.sync-lock` for shared clones, `status` partition print, and the
  automatic migration (copy → verify → atomic rename → keep `.teamai.bak/` backup;
  triggered only on write commands, never on read/hook paths).
- **P2** — self (single-repo) mode slimming: only team knowledge (class B) stays in
  the repo.
- **P3** — functionize module-load-time path constants (so tests that swap `$HOME`
  at runtime take effect), then assign A1/A2 ownership per the data-classification
  table. `status --all` across partitions.

### Explicitly out of scope

`teamai migrate` / `gc` / `--revert` commands; cross-project shared team-repo clone;
Codex `.agents/skills` landing (separate issue). Downgrade to an older teamai after
P1 migration is not supported (`.teamai.bak/` is the manual rollback path).
