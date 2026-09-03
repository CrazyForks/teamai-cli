import path from 'node:path';

import type { LocalConfig } from '../types.js';
import { getKnowledgeDir, getReportsDir, isSelfMode } from '../types.js';

export interface MaintenancePaths {
  repoPath: string;
  votesDir: string;
  learningsDir: string;
}

/**
 * Resolve the knowledge and report roots used by recall maintenance commands.
 *
 * In self mode, knowledge remains on the business repository's main branch,
 * while votes live in the teamai-reports worktree. Other repository kinds keep
 * both data sets under localConfig.repo.localPath.
 */
export async function resolveMaintenancePaths(
  localConfig: LocalConfig,
): Promise<MaintenancePaths> {
  if (isSelfMode(localConfig)) {
    const { ensureReportsWorktree } = await import('../utils/reports-branch.js');
    await ensureReportsWorktree(localConfig);
  }

  const repoPath = getKnowledgeDir(localConfig);
  return {
    repoPath,
    votesDir: path.join(getReportsDir(localConfig), 'votes'),
    learningsDir: path.join(repoPath, 'learnings'),
  };
}
