import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fse from 'fs-extra';

// ─── issue #374 P3: constant functionization + anchor-on-save ───────────────

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

let base: string, home: string;

beforeEach(() => {
  base = realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'p3-')));
  home = path.join(base, 'home');
  fs.mkdirSync(home);
  vi.stubEnv('HOME', home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('P3 path getters honor a runtime HOME change (no vi.resetModules)', () => {
  it('getTeamaiHomeDir / getUserVotesDir / getSessionLogsDir follow the current HOME', async () => {
    const types = await import('../types.js');
    // HOME was stubbed in beforeEach; the getters must reflect it at CALL time.
    expect(types.getTeamaiHomeDir()).toBe(path.join(home, '.teamai'));
    expect(types.getUserVotesDir()).toBe(path.join(home, '.teamai', 'votes'));
    expect(types.getSessionLogsDir()).toBe(path.join(home, '.teamai', 'session-logs'));

    // Swap HOME again mid-test — a module-load const could never do this.
    const home2 = path.join(base, 'home2');
    fs.mkdirSync(home2);
    vi.stubEnv('HOME', home2);
    expect(types.getTeamaiHomeDir()).toBe(path.join(home2, '.teamai'));
  });
});

describe('P3 dashboard events isolate by HOME (two projects do not mix)', () => {
  it('appendEvent writes under the current HOME, so two HOMEs get separate logs', async () => {
    const { appendEvent } = await import('../dashboard-collector.js');
    const ev = (sid: string) => ({
      type: 'session_start', sessionId: sid, tool: 'claude', cwd: '/p', timestamp: new Date().toISOString(),
    }) as never;

    const homeA = path.join(base, 'homeA');
    fs.mkdirSync(homeA);
    vi.stubEnv('HOME', homeA);
    await appendEvent(ev('A'));

    const homeB = path.join(base, 'homeB');
    fs.mkdirSync(homeB);
    vi.stubEnv('HOME', homeB);
    await appendEvent(ev('B'));

    const logA = fs.readFileSync(path.join(homeA, '.teamai', 'dashboard', 'events.jsonl'), 'utf-8');
    const logB = fs.readFileSync(path.join(homeB, '.teamai', 'dashboard', 'events.jsonl'), 'utf-8');
    expect(logA).toContain('"A"');
    expect(logA).not.toContain('"B"');   // project A's log has no project B event
    expect(logB).toContain('"B"');
    expect(logB).not.toContain('"A"');
  });
});

describe('P3 saveLocalConfigForScope writes an anchor into a partition', () => {
  it('a partitioned project config gets an anchor reverse-lookup file', async () => {
    const repo = path.join(base, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 't@e.com');
    git(repo, 'config', 'user.name', 'T');
    git(repo, 'commit', '--allow-empty', '-q', '-m', 'init');
    const realRepo = realpathSync(repo);

    const { saveLocalConfigForScope } = await import('../config.js');
    const { projectDataHome, readAnchorFile } = await import('../utils/partition.js');
    const cfg = {
      repo: { localPath: path.join(realRepo, '.teamai', 'team-repo'), remote: 'r', kind: 'git' },
      username: 'u', scope: 'project', projectRoot: realRepo,
      dataHome: projectDataHome(realRepo),
    } as never;

    await saveLocalConfigForScope(cfg, 'project', realRepo);

    const partition = projectDataHome(realRepo);
    expect(await fse.pathExists(path.join(partition, 'config.yaml'))).toBe(true);
    // The anchor file was written and points back at the project anchor (main checkout).
    expect(await readAnchorFile(partition)).toBe(realRepo);
  });

  it('a user-scope config does NOT get an anchor (only partitions do)', async () => {
    const { saveLocalConfigForScope } = await import('../config.js');
    const cfg = {
      repo: { localPath: path.join(home, '.teamai', 'team-repo'), remote: 'r', kind: 'git' },
      username: 'u', scope: 'user',
    } as never;
    await saveLocalConfigForScope(cfg, 'user');
    expect(await fse.pathExists(path.join(home, '.teamai', 'anchor'))).toBe(false);
  });
});
