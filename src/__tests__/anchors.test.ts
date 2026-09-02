import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAnchors } from '../utils/git.js';

// ─── Real-git tests for resolveAnchors (issue #374 P0) ──────────────────────
//
// Uses a real git repository + a real `git worktree add` in a temp dir, so the
// distinction the two-anchor model rests on is genuinely exercised:
//   - workspaceRoot = the CURRENT checkout (per-worktree)
//   - projectAnchor = the MAIN checkout (shared by repo + all worktrees)
// It also covers the `--path-format=absolute` trap: without it, `--git-common-dir`
// returns a RELATIVE `.git` in the main repo, which would resolve the anchor
// against the wrong base.

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

let base: string;
let repoRoot: string;
let worktreeRoot: string;
let nonGitDir: string;

beforeAll(() => {
  // realpath so macOS /tmp -> /private/tmp matches resolveAnchors' own realpath.
  base = realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-anchors-')));
  repoRoot = path.join(base, 'main-repo');
  fs.mkdirSync(repoRoot);
  git(repoRoot, 'init', '-q');
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'config', 'user.name', 'Test');
  git(repoRoot, 'commit', '--allow-empty', '-q', '-m', 'init');

  // A worktree lives OUTSIDE the main repo tree to prove the anchor is shared.
  worktreeRoot = path.join(base, 'wt');
  git(repoRoot, 'worktree', 'add', '-q', worktreeRoot, 'HEAD');

  nonGitDir = path.join(base, 'plain');
  fs.mkdirSync(nonGitDir);
});

afterAll(() => {
  try {
    fs.rmSync(path.dirname(repoRoot), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('resolveAnchors', () => {
  it('returns workspace === anchor === repo root for a plain repository', async () => {
    const a = await resolveAnchors(repoRoot);
    expect(a).not.toBeNull();
    expect(a!.workspaceRoot).toBe(repoRoot);
    expect(a!.projectAnchor).toBe(repoRoot);
  });

  it('resolves a subdirectory of the main repo up to the repo root', async () => {
    const sub = path.join(repoRoot, 'src', 'nested');
    fs.mkdirSync(sub, { recursive: true });
    const a = await resolveAnchors(sub);
    expect(a).not.toBeNull();
    expect(a!.workspaceRoot).toBe(repoRoot);
    expect(a!.projectAnchor).toBe(repoRoot);
  });

  it('gives a worktree its own workspaceRoot but the shared main-checkout anchor', async () => {
    const a = await resolveAnchors(worktreeRoot);
    expect(a).not.toBeNull();
    // The current checkout is the worktree itself...
    expect(a!.workspaceRoot).toBe(worktreeRoot);
    // ...but the anchor points back at the MAIN checkout, shared with the repo.
    expect(a!.projectAnchor).toBe(repoRoot);
    expect(a!.workspaceRoot).not.toBe(a!.projectAnchor);
  });

  it('resolves a subdirectory of a worktree to that worktree, anchored at main', async () => {
    const sub = path.join(worktreeRoot, 'deep', 'dir');
    fs.mkdirSync(sub, { recursive: true });
    const a = await resolveAnchors(sub);
    expect(a!.workspaceRoot).toBe(worktreeRoot);
    expect(a!.projectAnchor).toBe(repoRoot);
  });

  it('returns null for a directory that is not inside any git repository', async () => {
    expect(await resolveAnchors(nonGitDir)).toBeNull();
  });

  it('handles --separate-git-dir without colliding on a shared gitdir parent', async () => {
    // Reviewer #374: dirname(--git-common-dir) would return the shared `gitdirs`
    // parent for BOTH repos → identical anchors → P1 partition collision. Using
    // the main-worktree path keeps them distinct, and workspaceRoot stays correct.
    const gitdirs = path.join(base, 'gitdirs');
    fs.mkdirSync(gitdirs, { recursive: true });
    const mk = (name: string) => {
      const ws = path.join(base, name);
      fs.mkdirSync(ws);
      git(ws, 'init', '-q', '--separate-git-dir', path.join(gitdirs, `${name}.git`));
      git(ws, 'config', 'user.email', 'test@example.com');
      git(ws, 'config', 'user.name', 'Test');
      git(ws, 'commit', '--allow-empty', '-q', '-m', 'init');
      return ws;
    };
    const wsA = mk('sepA');
    const wsB = mk('sepB');
    const a = await resolveAnchors(wsA);
    const b = await resolveAnchors(wsB);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.workspaceRoot).toBe(wsA);
    expect(b!.workspaceRoot).toBe(wsB);
    // The two repos must NOT share an anchor (no partition collision).
    expect(a!.projectAnchor).not.toBe(b!.projectAnchor);
    // And neither anchor is the shared parent directory.
    expect(a!.projectAnchor).not.toBe(gitdirs);
    expect(b!.projectAnchor).not.toBe(gitdirs);
  });
});
