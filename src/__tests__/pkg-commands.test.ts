import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  autoDetectInit: vi.fn(),
  npmInstall: vi.fn(),
  npmSnapshot: vi.fn(),
  assertNotReadOnly: vi.fn(),
}));

vi.mock('../config.js', () => ({
  autoDetectInit: mocks.autoDetectInit,
}));

vi.mock('../read-only.js', () => ({
  assertNotReadOnly: mocks.assertNotReadOnly,
}));

vi.mock('../utils/logger.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../pkg/adapters/npm.js', () => ({
  NpmAdapter: class {
    validate = vi.fn().mockResolvedValue({ valid: true, errors: [] });
    install = mocks.npmInstall;
    snapshot = mocks.npmSnapshot;
    status = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock('../pkg/adapters/claude-plugin.js', () => ({
  ClaudePluginAdapter: class {
    validate = vi.fn().mockResolvedValue({ valid: true, errors: [] });
    registeredMarketplaces = vi.fn().mockResolvedValue([]);
    install = vi.fn().mockResolvedValue({ marketplaces: [], plugins: [] });
    snapshot = vi.fn().mockResolvedValue({ marketplaces: [], plugins: [] });
    status = vi.fn().mockResolvedValue([]);
  },
}));

import { pkgInstall } from '../pkg/commands.js';
import { loadPackageLock } from '../pkg/manifest.js';

describe('pkgInstall npm target options', () => {
  let teamRepo: string;
  let projectRoot: string;
  let previousCwd: string;

  beforeEach(() => {
    teamRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-pkg-command-repo-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-pkg-command-project-'));
    previousCwd = process.cwd();
    process.chdir(projectRoot);
    fs.writeFileSync(path.join(teamRepo, 'teamai.yaml'), YAML.stringify({
      team: 'platform',
      repo: 'acme/team',
    }));
    mocks.autoDetectInit.mockResolvedValue({
      localConfig: {
        repo: { localPath: teamRepo, remote: 'x', kind: 'git' },
        username: 'alice',
        scope: 'project',
        projectRoot,
      },
      teamConfig: {},
    });
    mocks.npmInstall.mockResolvedValue([{
      name: '@tencent/tokenlint',
      version: '1.3.3',
      source: 'npm',
      global: true,
      registry: 'https://mirrors.tencent.com/npm/',
    }]);
    mocks.npmSnapshot.mockResolvedValue([{
      name: '@tencent/tokenlint',
      version: '1.3.3',
      source: 'npm',
      global: true,
      registry: 'https://mirrors.tencent.com/npm/',
    }]);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    vi.clearAllMocks();
    fs.rmSync(teamRepo, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('installs a global target and persists global/registry in teamai.yaml', async () => {
    await pkgInstall('@tencent/tokenlint@latest', {
      global: true,
      registry: 'https://mirrors.tencent.com/npm/',
    });

    expect(mocks.npmInstall).toHaveBeenCalledWith(
      [{
        name: '@tencent/tokenlint',
        version: 'latest',
        global: true,
        registry: 'https://mirrors.tencent.com/npm/',
      }],
      expect.objectContaining({
        cwd: expect.stringContaining(path.basename(projectRoot)),
        scope: 'project',
      }),
    );
    const raw = YAML.parse(fs.readFileSync(path.join(teamRepo, 'teamai.yaml'), 'utf8'));
    expect(raw.packages.npm).toEqual([{
      name: '@tencent/tokenlint',
      version: 'latest',
      global: true,
      registry: 'https://mirrors.tencent.com/npm/',
    }]);
    expect((await loadPackageLock(path.join(projectRoot, '.teamai')))
      ?.packages.npm?.[0]).toMatchObject({
      name: '@tencent/tokenlint',
      global: true,
      registry: 'https://mirrors.tencent.com/npm/',
    });
    expect(mocks.assertNotReadOnly).toHaveBeenCalled();
  });

  it('restores a declared global tool when teammates run install without a target', async () => {
    fs.writeFileSync(path.join(teamRepo, 'teamai.yaml'), YAML.stringify({
      team: 'platform',
      repo: 'acme/team',
      packages: {
        npm: [{
          name: '@tencent/tokenlint',
          version: 'latest',
          global: true,
          registry: 'https://mirrors.tencent.com/npm/',
        }],
      },
    }));

    await pkgInstall(undefined, {});

    expect(mocks.npmInstall).toHaveBeenCalledWith(
      [{
        name: '@tencent/tokenlint',
        version: 'latest',
        global: true,
        registry: 'https://mirrors.tencent.com/npm/',
      }],
      expect.objectContaining({ scope: 'project' }),
    );
  });

  it('rejects target-only npm flags when no target is provided', async () => {
    await expect(pkgInstall(undefined, { global: true }))
      .rejects.toThrow('--global and --registry require an npm package target');
    expect(mocks.npmInstall).not.toHaveBeenCalled();
  });
});
