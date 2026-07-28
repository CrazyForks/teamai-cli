import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fse from 'fs-extra';

vi.mock('../utils/logger.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dim: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })),
}));

import { reconcileMcpForConfig, spliceCodexBlock, codexServerNames } from '../mcp-reconcile.js';
import type { TeamaiConfig, LocalConfig } from '../types.js';

const TOOL_PATHS = {
  claude: { skills: '.claude/skills', settings: '.claude/settings.json', mcp: '.claude.json', mcpProject: '.mcp.json' },
  cursor: { skills: '.cursor/skills', settings: '.cursor/hooks.json', mcp: '.cursor/mcp.json' },
  codebuddy: { skills: '.codebuddy/skills', settings: '.codebuddy/settings.json', mcp: '.codebuddy/mcp.json' },
  codex: { skills: '.codex/skills', settings: '.codex/hooks.json', mcp: '.codex/config.toml' },
};

describe('MCP reconcile', () => {
  let tmpDir: string;
  let homeDir: string;
  let repoPath: string;
  let teamConfig: TeamaiConfig;
  let localConfig: LocalConfig;

  async function writeMcpYaml(body: string): Promise<void> {
    await fse.ensureDir(path.join(repoPath, 'mcp'));
    await fse.writeFile(path.join(repoPath, 'mcp', 'mcp.yaml'), body);
  }

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-mcp-test-'));
    homeDir = path.join(tmpDir, 'home');
    repoPath = path.join(tmpDir, 'team-repo');

    // Only claude + cursor are "installed".
    await fse.ensureDir(path.join(homeDir, '.claude', 'skills'));
    await fse.ensureDir(path.join(homeDir, '.cursor', 'skills'));
    await fse.ensureDir(path.join(homeDir, '.teamai'));

    vi.stubEnv('HOME', homeDir);

    teamConfig = {
      team: 't',
      description: '',
      repo: 'r',
      provider: 'tgit',
      reviewers: [],
      sharing: {
        skills: {},
        rules: { enforced: [] },
        docs: { localDir: '~/.teamai/docs' },
        env: { injectShellProfile: false },
      },
      toolPaths: TOOL_PATHS,
    } as unknown as TeamaiConfig;

    localConfig = {
      repo: { localPath: repoPath, remote: 'r' },
      username: 'u',
      scope: 'user',
      additionalRoles: [],
    } as unknown as LocalConfig;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fse.remove(tmpDir);
  });

  it('preserves every unrelated key in ~/.claude.json', async () => {
    const claudeJson = path.join(homeDir, '.claude.json');
    const original = {
      oauthAccount: { emailAddress: 'me@example.com', accountUuid: 'abc-123' },
      projects: { '/some/project': { trustLevel: 'trusted', allowedTools: ['Bash'] } },
      numStartups: 42,
      mcpServers: { 'my-own': { command: 'my-server' } },
    };
    await fse.writeJson(claudeJson, original);

    await writeMcpYaml(`
servers:
  - name: team-server
    transport: http
    url: https://example.com/mcp
`);

    await reconcileMcpForConfig(teamConfig, localConfig);

    const after = await fse.readJson(claudeJson);
    expect(after.oauthAccount).toEqual(original.oauthAccount);
    expect(after.projects).toEqual(original.projects);
    expect(after.numStartups).toBe(42);
    // User's own server survives alongside the team one.
    expect(after.mcpServers['my-own']).toEqual({ command: 'my-server' });
    expect(after.mcpServers['team-server']).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
    });
  });

  it('is idempotent — a second run does not rewrite the file', async () => {
    await writeMcpYaml(`
servers:
  - name: s1
    transport: http
    url: https://example.com/mcp
`);

    const first = await reconcileMcpForConfig(teamConfig, localConfig);
    expect(first.wrote).toBe(true);

    const claudeJson = path.join(homeDir, '.claude.json');
    const mtimeBefore = (await fse.stat(claudeJson)).mtimeMs;

    const second = await reconcileMcpForConfig(teamConfig, localConfig);
    expect(second.wrote).toBe(false);
    expect((await fse.stat(claudeJson)).mtimeMs).toBe(mtimeBefore);
  });

  it('does not overwrite a user-owned server with a colliding name', async () => {
    const cursorMcp = path.join(homeDir, '.cursor', 'mcp.json');
    await fse.writeJson(cursorMcp, { mcpServers: { shared: { url: 'https://mine.example/mcp' } } });

    await writeMcpYaml(`
servers:
  - name: shared
    transport: http
    url: https://team.example/mcp
    tools: [cursor]
`);

    const { changes } = await reconcileMcpForConfig(teamConfig, localConfig);

    const after = await fse.readJson(cursorMcp);
    expect(after.mcpServers.shared.url).toBe('https://mine.example/mcp');
    expect(changes).toContainEqual(
      expect.objectContaining({ tool: 'cursor', server: 'shared', action: 'skipped' }),
    );
  });

  it('skips a server whose ${VAR} cannot be resolved instead of injecting it broken', async () => {
    await writeMcpYaml(`
servers:
  - name: needs-token
    transport: http
    url: https://example.com/mcp
    headers:
      Authorization: Bearer \${DEFINITELY_UNSET_TOKEN_XYZ}
`);

    const { changes } = await reconcileMcpForConfig(teamConfig, localConfig);

    expect(await fse.pathExists(path.join(homeDir, '.claude.json'))).toBe(false);
    expect(changes.every((c) => c.action === 'skipped')).toBe(true);
    expect(changes[0].reason).toContain('DEFINITELY_UNSET_TOKEN_XYZ');
  });

  it('resolves ${VAR} from the team env file', async () => {
    await fse.writeFile(path.join(homeDir, '.teamai', 'env'), 'TEAM_TOKEN=s3cret\n');
    await writeMcpYaml(`
servers:
  - name: with-token
    transport: http
    url: https://example.com/mcp
    headers:
      Authorization: Bearer \${TEAM_TOKEN}
    tools: [claude]
`);

    await reconcileMcpForConfig(teamConfig, localConfig);

    const after = await fse.readJson(path.join(homeDir, '.claude.json'));
    expect(after.mcpServers['with-token'].headers.Authorization).toBe('Bearer s3cret');
  });

  it('removes a server once it disappears from mcp.yaml', async () => {
    await writeMcpYaml(`
servers:
  - name: temp
    transport: http
    url: https://example.com/mcp
    tools: [claude]
`);
    await reconcileMcpForConfig(teamConfig, localConfig);
    expect((await fse.readJson(path.join(homeDir, '.claude.json'))).mcpServers.temp).toBeDefined();

    await writeMcpYaml('servers: []\n');
    await reconcileMcpForConfig(teamConfig, localConfig);

    const after = await fse.readJson(path.join(homeDir, '.claude.json'));
    expect(after.mcpServers.temp).toBeUndefined();
  });

  it('skips tools that are not installed', async () => {
    await writeMcpYaml(`
servers:
  - name: s1
    transport: http
    url: https://example.com/mcp
`);
    await reconcileMcpForConfig(teamConfig, localConfig);

    // codebuddy has no ~/.codebuddy directory in this fixture.
    expect(await fse.pathExists(path.join(homeDir, '.codebuddy', 'mcp.json'))).toBe(false);
  });

  it('skips http servers for codex, which cannot express them', async () => {
    await fse.ensureDir(path.join(homeDir, '.codex', 'skills'));
    await writeMcpYaml(`
servers:
  - name: remote
    transport: http
    url: https://example.com/mcp
    tools: [codex]
`);

    const { changes } = await reconcileMcpForConfig(teamConfig, localConfig);
    expect(changes).toContainEqual(
      expect.objectContaining({ tool: 'codex', server: 'remote', action: 'skipped' }),
    );
    expect(await fse.pathExists(path.join(homeDir, '.codex', 'config.toml'))).toBe(false);
  });

  it('writes a stdio server into codex config.toml without destroying user comments', async () => {
    await fse.ensureDir(path.join(homeDir, '.codex', 'skills'));
    const configToml = path.join(homeDir, '.codex', 'config.toml');
    await fse.writeFile(
      configToml,
      '# my important comment\nmodel = "gpt-5"\n\n[projects."/x"]\ntrust_level = "trusted"\n',
    );

    await writeMcpYaml(`
servers:
  - name: local-tool
    transport: stdio
    command: my-mcp
    args: ['--flag']
    tools: [codex]
`);

    await reconcileMcpForConfig(teamConfig, localConfig);

    const after = await fse.readFile(configToml, 'utf-8');
    expect(after).toContain('# my important comment');
    expect(after).toContain('trust_level = "trusted"');
    expect(after).toContain('[mcp_servers.local-tool]');
    expect(after).toContain('command = "my-mcp"');
  });

  it('leaves an unparseable config file alone rather than clobbering it', async () => {
    const claudeJson = path.join(homeDir, '.claude.json');
    await fse.writeFile(claudeJson, '{ this is not valid json');

    await writeMcpYaml(`
servers:
  - name: s1
    transport: http
    url: https://example.com/mcp
    tools: [claude]
`);

    await reconcileMcpForConfig(teamConfig, localConfig);
    expect(await fse.readFile(claudeJson, 'utf-8')).toBe('{ this is not valid json');
  });

  it('enforces the allowedHosts policy', async () => {
    teamConfig.sharing.mcp = { autoApply: true, allowedCommands: [], allowedHosts: ['*.trusted.com'] };
    await writeMcpYaml(`
servers:
  - name: sketchy
    transport: http
    url: https://evil.example/mcp
    tools: [claude]
`);

    const { changes } = await reconcileMcpForConfig(teamConfig, localConfig);
    expect(changes[0]).toMatchObject({ action: 'skipped' });
    expect(changes[0].reason).toContain('allowedHosts');
  });
});

describe('spliceCodexBlock', () => {
  it('replaces a block and its nested env sub-table, leaving neighbours intact', () => {
    const src = [
      '# header comment',
      'model = "gpt-5"',
      '',
      '[mcp_servers.a]',
      'command = "old"',
      '',
      '[mcp_servers.a.env]',
      'OLD = "1"',
      '',
      '[projects."/x"]',
      'trust_level = "trusted"',
      '',
    ].join('\n');

    const out = spliceCodexBlock(src, 'a', '[mcp_servers.a]\ncommand = "new"\n');

    expect(out).toContain('# header comment');
    expect(out).toContain('command = "new"');
    expect(out).not.toContain('OLD = "1"');
    expect(out).toContain('[projects."/x"]');
    expect(out).toContain('trust_level = "trusted"');
  });

  it('deletes a block when passed null', () => {
    const src = '[mcp_servers.a]\ncommand = "x"\n\n[projects."/y"]\ntrust_level = "trusted"\n';
    const out = spliceCodexBlock(src, 'a', null);
    expect(out).not.toContain('mcp_servers.a');
    expect(out).toContain('[projects."/y"]');
  });

  // Regression: the end-of-input branch was originally written as \z, which JS
  // reads as a literal "z", so a trailing block could never be matched.
  it('deletes a block sitting at end-of-file', () => {
    const src = 'model = "gpt-5"\n\n[mcp_servers.last]\ncommand = "x"\n';
    const out = spliceCodexBlock(src, 'last', null);
    expect(out).not.toContain('mcp_servers.last');
    expect(out).toContain('model = "gpt-5"');
  });

  it('deletes a trailing block including its env sub-table', () => {
    const src = '[projects."/y"]\nt = 1\n\n[mcp_servers.last]\ncommand = "x"\n\n[mcp_servers.last.env]\nA = "1"\n';
    const out = spliceCodexBlock(src, 'last', null);
    expect(out).not.toContain('mcp_servers.last');
    expect(out).not.toContain('A = "1"');
    expect(out).toContain('[projects."/y"]');
  });

  it('replaces a trailing block in place', () => {
    const src = 'model = "x"\n\n[mcp_servers.last]\ncommand = "old"\n';
    const out = spliceCodexBlock(src, 'last', '[mcp_servers.last]\ncommand = "new"\n');
    expect(out).toContain('command = "new"');
    expect(out).not.toContain('command = "old"');
  });

  it('appends when the block is absent', () => {
    const src = 'model = "gpt-5"\n';
    const out = spliceCodexBlock(src, 'newone', '[mcp_servers.newone]\ncommand = "x"\n');
    expect(out).toContain('model = "gpt-5"');
    expect(out).toContain('[mcp_servers.newone]');
  });

  it('lists existing server names', () => {
    const src = '[mcp_servers.a]\n\n[mcp_servers.b]\n\n[mcp_servers.b.env]\nX = "1"\n';
    expect(codexServerNames(src).sort()).toEqual(['a', 'b']);
  });
});
