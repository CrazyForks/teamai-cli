import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalConfig } from '../types.js';
import { REPORTS_WORKTREE_DIRNAME } from '../types.js';
import { resolveMaintenancePaths } from '../maintenance/paths.js';
import { ensureReportsWorktree } from '../utils/reports-branch.js';

vi.mock('../utils/reports-branch.js', () => ({
  ensureReportsWorktree: vi.fn(),
}));

function makeConfig(kind: 'git' | 'self'): LocalConfig {
  const projectRoot = '/workspace/project';
  const localPath = kind === 'self'
    ? path.join(projectRoot, '.teamai')
    : '/home/alice/.teamai/team-repo';
  return {
    repo: {
      localPath,
      remote: 'https://example.com/team.git',
      kind,
      ...(kind === 'self' ? { businessRepoRoot: projectRoot } : {}),
    },
    username: 'alice',
    scope: kind === 'self' ? 'project' : 'user',
    ...(kind === 'self' ? { projectRoot } : {}),
    additionalRoles: [],
  };
}

describe('resolveMaintenancePaths', () => {
  beforeEach(() => {
    vi.mocked(ensureReportsWorktree).mockReset().mockResolvedValue(
      '/workspace/project/.teamai/reports-wt',
    );
  });

  it('reads self-mode votes from the reports worktree', async () => {
    const config = makeConfig('self');

    await expect(resolveMaintenancePaths(config)).resolves.toEqual({
      repoPath: '/workspace/project/.teamai',
      votesDir: path.join(
        '/workspace/project/.teamai',
        REPORTS_WORKTREE_DIRNAME,
        'votes',
      ),
      learningsDir: '/workspace/project/.teamai/learnings',
    });
    expect(ensureReportsWorktree).toHaveBeenCalledOnce();
    expect(ensureReportsWorktree).toHaveBeenCalledWith(config);
  });

  it('keeps knowledge and votes together for standalone team repos', async () => {
    const config = makeConfig('git');

    await expect(resolveMaintenancePaths(config)).resolves.toEqual({
      repoPath: '/home/alice/.teamai/team-repo',
      votesDir: '/home/alice/.teamai/team-repo/votes',
      learningsDir: '/home/alice/.teamai/team-repo/learnings',
    });
    expect(ensureReportsWorktree).not.toHaveBeenCalled();
  });
});
