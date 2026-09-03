import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { projectSlug, projectDataHome, isCaseInsensitiveFs, resetCaseProbeCache } from '../utils/partition.js';

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  resetCaseProbeCache();
  vi.restoreAllMocks();
});

describe('projectSlug / projectDataHome (issue #374 partition identity)', () => {
  it('is deterministic for the same anchor', () => {
    resetCaseProbeCache();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false); // force case-sensitive
    const a = projectSlug('/Users/x/Project/teamai-cli');
    const b = projectSlug('/Users/x/Project/teamai-cli');
    expect(a).toBe(b);
    expect(a).toMatch(/^teamai-cli-[0-9a-f]{16}$/);
  });

  it('does NOT collide for escape-ambiguous paths (/x/my-proj vs /x/my/proj)', () => {
    resetCaseProbeCache();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    // A raw separator→'-' escape would map both to the same string; the hash
    // must keep them distinct.
    expect(projectSlug('/x/my-proj')).not.toBe(projectSlug('/x/my/proj'));
  });

  it('distinguishes two projects sharing a basename by hash', () => {
    resetCaseProbeCache();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const a = projectSlug('/work/a/teamai-cli');
    const b = projectSlug('/work/b/teamai-cli');
    expect(a).not.toBe(b);
    expect(a.startsWith('teamai-cli-')).toBe(true);
    expect(b.startsWith('teamai-cli-')).toBe(true);
  });

  it('case-insensitive FS: different spellings of one dir map to the SAME slug', () => {
    resetCaseProbeCache();
    // Simulate a case-insensitive FS: the lowercase probe path "exists".
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as unknown as string);
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'rmSync').mockReturnValue(undefined);
    expect(isCaseInsensitiveFs()).toBe(true);
    expect(projectSlug('/Users/X/Project/CaseTest')).toBe(projectSlug('/users/x/project/casetest'));
  });

  it('case-sensitive FS: different spellings map to DIFFERENT slugs', () => {
    resetCaseProbeCache();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false); // probe file not found → case-sensitive
    expect(isCaseInsensitiveFs()).toBe(false);
    expect(projectSlug('/work/CaseTest')).not.toBe(projectSlug('/work/casetest'));
  });

  it('uses a 64-bit (16 hex) digest suffix, not 32-bit', () => {
    resetCaseProbeCache();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const slug = projectSlug('/work/proj');
    const hex = slug.split('-').pop() ?? '';
    // 32-bit (8 hex) is cheaply collidable; require the widened suffix.
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
  });

  it('projectDataHome roots under ~/.teamai/projects/<slug>', () => {
    process.env.HOME = '/home/alice';
    resetCaseProbeCache();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const home = projectDataHome('/work/proj');
    expect(home).toBe(path.join('/home/alice', '.teamai', 'projects', projectSlug('/work/proj')));
  });

  it('real-FS probe runs without throwing and yields a stable boolean', () => {
    resetCaseProbeCache();
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-probe-'));
    const first = isCaseInsensitiveFs(probeDir);
    const second = isCaseInsensitiveFs(probeDir); // cached
    expect(typeof first).toBe('boolean');
    expect(second).toBe(first);
    fs.rmSync(probeDir, { recursive: true, force: true });
  });
});
