import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = path.join(ROOT, 'dist', 'index.js');

describe('CodeBuddy project MCP (e2e)', () => {
  let sandbox: string;
  let homeDir: string;
  let projectRoot: string;

  function runCLI(args: string[]): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, ...args], {
        cwd: projectRoot,
        env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('CLI timed out: ' + args.join(' ') + '\\n' + output));
      }, 30_000);
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, output }); });
      child.stdin.end();
    });
  }

  beforeAll(() => {
    if (!fs.existsSync(CLI)) throw new Error('Run npm run build before the E2E test.');
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-codebuddy-mcp-e2e-'));
    homeDir = path.join(sandbox, 'home');
    projectRoot = path.join(sandbox, 'project');
    const repoLocal = path.join(sandbox, 'team-repo');
    fs.mkdirSync(path.join(homeDir, '.codebuddy'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, '.codebuddy'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, '.teamai'), { recursive: true });
    fs.mkdirSync(path.join(repoLocal, 'mcp'), { recursive: true });
    fs.writeFileSync(path.join(repoLocal, 'teamai.yaml'), [
      'team: codebuddy-mcp-e2e',
      'repo: https://example.com/team.git',
      'provider: git',
    ].join('\n'));
    fs.writeFileSync(path.join(repoLocal, 'mcp', 'mcp.yaml'), [
      'servers:',
      '  - name: team-codebuddy',
      '    transport: http',
      '    url: https://example.com/mcp',
      '    tools: [codebuddy]',
    ].join('\n'));
    fs.writeFileSync(path.join(projectRoot, '.teamai', 'config.yaml'), [
      'repo:',
      `  localPath: ${JSON.stringify(repoLocal)}`,
      '  remote: https://example.com/team.git',
      'username: e2e-user',
      'scope: project',
    ].join('\n'));
    fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({
      mcpServers: { personal: { command: 'personal-server' } }, custom: true,
    }));
    fs.writeFileSync(path.join(homeDir, '.codebuddy', 'mcp.json'), '{"userConfig":true}');
  });

  afterAll(() => {
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('lists, injects and removes project MCP servers at the CodeBuddy reader path', async () => {
    const list = await runCLI(['mcp', 'list']);
    expect(list.code, list.output).toBe(0);
    expect(list.output).toContain(path.join(projectRoot, '.mcp.json'));
    expect(list.output).not.toContain(path.join(projectRoot, '.codebuddy', 'mcp.json'));

    const inject = await runCLI(['mcp', 'inject']);
    expect(inject.code, inject.output).toBe(0);
    expect(inject.output).toMatch(/added\s+codebuddy\/team-codebuddy/);
    const projectFile = path.join(projectRoot, '.mcp.json');
    const readProject = () => JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    expect(readProject()).toEqual({
      mcpServers: {
        personal: { command: 'personal-server' },
        'team-codebuddy': { type: 'http', url: 'https://example.com/mcp' },
      },
      custom: true,
    });
    expect(fs.existsSync(path.join(projectRoot, '.codebuddy', 'mcp.json'))).toBe(false);

    const repeat = await runCLI(['mcp', 'inject']);
    expect(repeat.code, repeat.output).toBe(0);
    expect(repeat.output).toContain('Already up to date.');

    const remove = await runCLI(['mcp', 'remove']);
    expect(remove.code, remove.output).toBe(0);
    expect(readProject()).toEqual({
      mcpServers: { personal: { command: 'personal-server' } }, custom: true,
    });
    expect(fs.readFileSync(path.join(homeDir, '.codebuddy', 'mcp.json'), 'utf8'))
      .toBe('{"userConfig":true}');
  }, 150_000);
});
