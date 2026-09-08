import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const agents = ['claude', 'codex', 'codebuddy', 'opencode'];

function runCLI(args: string[], cwd: string, home: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: {
        ...process.env, HOME: home, FORCE_COLOR: '0',
        GITLAB_URL: '', TEAMAI_GITLAB_HOST: '', TEAMAI_DEFAULT_PROVIDER: '',
        GITLAB_TOKEN: 'must-not-be-sent-by-probe', GITLAB_PRIVATE_TOKEN: '', GITLAB_PAT: '',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

describe('self-hosted GitLab detection through the built CLI', () => {
  const requests: http.IncomingMessage[] = [];
  let server: http.Server;
  let baseUrl: string;
  let sandbox: string;

  beforeAll(async () => {
    expect(fs.existsSync(CLI), 'Run npm run build first').toBe(true);
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-gitlab-detection-'));
    server = http.createServer((request, response) => {
      requests.push(request);
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<html><head><meta content="GitLab" property="og:site_name">'
        + '<script>window.gon={};gon.api_version="v4";</script></head></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
  });

  for (const mode of ['team', 'self'] as const) {
    it.each(agents)(`${mode} init for %s identifies GitLab before authentication or writing configuration`, async (agent) => {
      const dir = fs.mkdtempSync(path.join(sandbox, `${mode}-${agent}-`));
      const home = path.join(dir, 'home');
      const project = path.join(dir, 'project');
      fs.mkdirSync(home);
      fs.mkdirSync(project);
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project });
      execFileSync('git', ['remote', 'add', 'origin', `${baseUrl}/team/repo.git`], { cwd: project });
      const before = requests.length;
      const result = await runCLI(
        ['init', mode === 'self' ? '.' : `${baseUrl}/team/repo.git`, '--agent', agent, '--force'],
        project, home,
      );
      expect(result.code, result.output).toBe(1);
      expect(result.output).toContain(`Detected self-hosted GitLab at ${baseUrl}`);
      expect(result.output).toContain(`Set GITLAB_URL=${baseUrl}`);
      expect(result.output).toContain('GITLAB_TOKEN');
      expect(result.output).not.toContain('Authenticated as');
      expect(result.output).not.toContain('must-not-be-sent-by-probe');
      expect(result.output).not.toContain('at detectProviderForInit');
      expect(result.output).not.toContain('node:internal');
      expect(fs.existsSync(path.join(project, '.teamai', 'config.yaml'))).toBe(false);
      expect(fs.existsSync(path.join(project, '.teamai', 'teamai.yaml'))).toBe(false);
      expect(fs.existsSync(path.join(project, '.teamai', 'team-repo'))).toBe(false);
      expect(requests.slice(before).map((request) => request.url)).toEqual(['/users/sign_in?auto_sign_in=false']);
      for (const request of requests.slice(before)) {
        expect(request.headers.authorization).toBeUndefined();
        expect(request.headers['private-token']).toBeUndefined();
        expect(request.headers.cookie).toBeUndefined();
      }
    });
  }

  it('uses explicit GitLab configuration without probing and still requires a token', async () => {
    const dir = fs.mkdtempSync(path.join(sandbox, 'explicit-'));
    const before = requests.length;
    const result = await runCLI(['init', `${baseUrl}/team/repo.git`, '--force'], dir, dir, {
      GITLAB_URL: baseUrl, GITLAB_TOKEN: '',
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('GitLab authentication unavailable');
    expect(result.output).not.toContain('Detected self-hosted GitLab');
    expect(requests).toHaveLength(before);
  });
});
