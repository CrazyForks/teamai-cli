import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudePluginAdapter } from '../pkg/adapters/claude-plugin.js';
import { extractNpmLockEntries, NpmAdapter } from '../pkg/adapters/npm.js';
import type { CommandExecutor } from '../utils/exec.js';

describe('NpmAdapter', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-npm-adapter-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts only declared top-level packages from package-lock v3', () => {
    expect(extractNpmLockEntries({
      lockfileVersion: 3,
      packages: {
        'node_modules/typescript': {
          version: '5.9.2',
          integrity: 'sha512-ts',
          resolved: 'https://registry.test/typescript.tgz',
        },
        'node_modules/parent/node_modules/child': { version: '1.0.0' },
      },
    }, [{ name: 'typescript', version: '^5.9.0' }])).toEqual([{
      name: 'typescript',
      version: '5.9.2',
      source: 'npm',
      integrity: 'sha512-ts',
      resolved: 'https://registry.test/typescript.tgz',
    }]);
  });

  it('runs npm install with argument arrays and snapshots package-lock', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/typescript': { version: '5.9.2' },
      },
    }));
    const execute = vi.fn<CommandExecutor>().mockResolvedValue({
      code: 0,
      stdout: '',
      stderr: '',
    });
    const adapter = new NpmAdapter(execute);

    const lock = await adapter.install(
      [{ name: 'typescript', version: '^5.9.0' }],
      { cwd: dir, scope: 'project' },
    );

    expect(execute).toHaveBeenCalledWith(
      'npm',
      ['install', 'typescript@^5.9.0'],
      expect.objectContaining({ cwd: dir }),
    );
    expect(lock[0]).toMatchObject({ name: 'typescript', version: '5.9.2' });
  });

  it('does not execute npm in dry-run mode', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    const execute = vi.fn<CommandExecutor>();
    await new NpmAdapter(execute).install(
      [{ name: 'is-odd', version: '*' }],
      { cwd: dir, scope: 'project', dryRun: true },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('installs CLI tools globally with their declared registry and snapshots npm list', async () => {
    const execute = vi.fn<CommandExecutor>().mockImplementation(async (_command, args) => {
      if (args[0] === 'list') {
        return {
          code: 0,
          stdout: JSON.stringify({
            dependencies: {
              '@tencent/tokenlint': { version: '1.3.3' },
            },
          }),
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    const adapter = new NpmAdapter(execute);
    const declaration = [{
      name: '@tencent/tokenlint',
      version: 'latest',
      global: true,
      registry: 'https://mirrors.tencent.com/npm/',
    }];

    const lock = await adapter.install(declaration, { cwd: dir, scope: 'user' });

    expect(execute).toHaveBeenCalledWith(
      'npm',
      [
        'install',
        '--global',
        '@tencent/tokenlint@latest',
        '--registry',
        'https://mirrors.tencent.com/npm/',
      ],
      expect.objectContaining({ cwd: dir }),
    );
    expect(execute).toHaveBeenCalledWith(
      'npm',
      ['list', '--global', '--depth=0', '--json'],
      expect.any(Object),
    );
    expect(lock).toEqual([{
      name: '@tencent/tokenlint',
      version: '1.3.3',
      source: 'npm',
      global: true,
      registry: 'https://mirrors.tencent.com/npm/',
    }]);
  });

  it('groups installs by project/global scope and registry', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: { 'node_modules/typescript': { version: '5.9.2' } },
    }));
    const execute = vi.fn<CommandExecutor>().mockImplementation(async (_command, args) => ({
      code: 0,
      stdout: args[0] === 'list' ? '{"dependencies":{"tokenlint":{"version":"1.0.0"}}}' : '',
      stderr: '',
    }));

    await new NpmAdapter(execute).install([
      { name: 'typescript', version: '^5.9.0' },
      {
        name: 'tokenlint',
        version: '1.0.0',
        global: true,
        registry: 'https://registry.example.com/',
      },
    ], { cwd: dir, scope: 'project' });

    expect(execute).toHaveBeenCalledWith(
      'npm',
      ['install', 'typescript@^5.9.0'],
      expect.any(Object),
    );
    expect(execute).toHaveBeenCalledWith(
      'npm',
      [
        'install', '--global', 'tokenlint@1.0.0',
        '--registry', 'https://registry.example.com/',
      ],
      expect.any(Object),
    );
  });

  it('keeps global dry-run side-effect free without requiring package.json', async () => {
    const execute = vi.fn<CommandExecutor>();
    await new NpmAdapter(execute).install([{
      name: '@tencent/tokenlint',
      version: 'latest',
      global: true,
      registry: 'https://mirrors.tencent.com/npm/',
    }], { cwd: dir, scope: 'user', dryRun: true });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('ClaudePluginAdapter', () => {
  const declaration = {
    marketplaces: [{
      name: 'claude-plugins-official',
      repo: 'anthropics/claude-plugins-official',
      ref: 'v1.0.0',
    }],
    plugins: [{ name: 'code-review@claude-plugins-official' }],
  };

  it('orchestrates marketplace add, plugin install, and JSON snapshot', async () => {
    let marketplaceQueries = 0;
    const execute = vi.fn<CommandExecutor>().mockImplementation(async (_command, args) => {
      if (args.join(' ') === 'plugin --help') {
        return { code: 0, stdout: 'plugin help', stderr: '' };
      }
      if (args.join(' ') === 'plugin marketplace list --json') {
        marketplaceQueries++;
        return {
          code: 0,
          stdout: marketplaceQueries === 1
            ? '[]'
            : JSON.stringify([{
              name: 'claude-plugins-official',
              source: 'github',
              repo: 'anthropics/claude-plugins-official',
              installLocation: '/tmp/plugins/official',
            }]),
          stderr: '',
        };
      }
      if (args.join(' ') === 'plugin list --json') {
        return {
          code: 0,
          stdout: JSON.stringify([{
            id: 'code-review@claude-plugins-official',
            version: '1.2.0',
            scope: 'project',
            enabled: true,
            installPath: '/tmp/plugins/code-review',
          }]),
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const lock = await new ClaudePluginAdapter(execute).install(
      declaration,
      { cwd: '/tmp/project', scope: 'project' },
    );

    expect(execute).toHaveBeenCalledWith(
      'claude',
      [
        'plugin', 'marketplace', 'add',
        'anthropics/claude-plugins-official@v1.0.0',
        '--scope', 'project',
      ],
      expect.any(Object),
    );
    expect(execute).toHaveBeenCalledWith(
      'claude',
      [
        'plugin', 'install', 'code-review@claude-plugins-official',
        '--scope', 'project', '--yes',
      ],
      expect.any(Object),
    );
    expect(lock.plugins[0]).toMatchObject({
      id: 'code-review@claude-plugins-official',
      version: '1.2.0',
      enabled: true,
    });
  });

  it('does not invoke Claude CLI in dry-run mode', async () => {
    const execute = vi.fn<CommandExecutor>();
    await new ClaudePluginAdapter(execute).install(
      declaration,
      { cwd: '/tmp/project', scope: 'project', dryRun: true },
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
