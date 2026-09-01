import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDetectProjectConfig, mockLoadLocalConfig } = vi.hoisted(() => ({
  mockDetectProjectConfig: vi.fn(),
  mockLoadLocalConfig: vi.fn(),
}));

vi.mock('../config.js', () => ({
  detectProjectConfig: mockDetectProjectConfig,
  loadLocalConfig: mockLoadLocalConfig,
}));

vi.mock('../utils/logger.js', () => ({
  log: { debug: vi.fn() },
}));

import { computePackageHintOutput } from '../pkg/pkg-hint.js';
import {
  loadPackageManifest,
  packageDeclarationHash,
  savePackageLock,
} from '../pkg/manifest.js';

describe('package SessionStart hint', () => {
  let cwd: string;
  let teamRepo: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-pkg-hint-cwd-'));
    teamRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-pkg-hint-repo-'));
    mockDetectProjectConfig.mockResolvedValue({
      repo: { localPath: teamRepo, remote: 'x', kind: 'git' },
      username: 'alice',
      scope: 'project',
      projectRoot: cwd,
    });
    mockLoadLocalConfig.mockResolvedValue(null);
    fs.writeFileSync(path.join(teamRepo, 'teamai.yaml'), YAML.stringify({
      packages: {
        npm: [{ name: 'typescript', version: '*' }],
      },
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(teamRepo, { recursive: true, force: true });
  });

  it('hints when the local lock is missing or stale', async () => {
    const output = await computePackageHintOutput(cwd);
    expect(output).not.toBeNull();
    const parsed = JSON.parse(output!);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('teamai install');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('不会');
  });

  it('stays silent after install records the current declaration hash', async () => {
    const manifest = await loadPackageManifest(teamRepo);
    await savePackageLock(path.join(cwd, '.teamai'), {
      version: 1,
      declarationHash: packageDeclarationHash(manifest),
      packages: { npm: [{ name: 'typescript', version: '5.9.2', source: 'npm' }] },
    });

    expect(await computePackageHintOutput(cwd)).toBeNull();
  });
});
