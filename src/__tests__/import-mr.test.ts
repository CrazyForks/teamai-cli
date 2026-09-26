import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

vi.mock('../utils/logger.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), dim: vi.fn() },
  setSilent: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })),
}));

const DRAFT_BODY = 'gateway retry budget exhausted under burst traffic backoff jitter';

/** The team repo `teamai import` runs against, set per test. */
let teamRepo = '';
vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  autoDetectInit: vi.fn(async () => ({
    localConfig: {
      repo: { localPath: teamRepo, remote: 'r', kind: 'git' as const },
      username: 'alice',
      scope: 'user' as const,
      additionalRoles: [],
      projects: ['alpha'],
    },
    teamConfig: { team: 't', repo: 'r' },
  })),
}));

vi.mock('../providers/github/mr-fetch.js', () => ({
  fetchGitHubPR: vi.fn(async (url: string) => ({ title: 'Retry budget', description: '', commits: [], diff: '', url })),
}));
vi.mock('../utils/ai-client.js', () => ({
  callClaude: vi.fn(async () => `---\ntitle: Retry budget\n---\n${DRAFT_BODY}\n`),
}));
const { question } = vi.hoisted(() => ({ question: vi.fn(async (_prompt: string) => 'n') }));
vi.mock('node:readline/promises', () => ({
  default: { createInterface: vi.fn(() => ({ question, close: vi.fn() })) },
}));

import { importFromMR, parseLearningDraft } from '../import-mr.js';
import { importCmd } from '../import.js';
import { log, setSilent } from '../utils/logger.js';

describe('parseLearningDraft', () => {
  it('parses well-formed frontmatter', () => {
    const raw = '---\ntitle: "Hello"\ntags: [a, b]\n---\n\n# Body\n';
    const { data, content } = parseLearningDraft(raw);
    expect(data['title']).toBe('Hello');
    expect(data['tags']).toEqual(['a', 'b']);
    expect(content).toContain('# Body');
  });

  it('does not throw on markdown that breaks YAML alias parsing (regression: CI exit 1)', () => {
    // A line starting with '*' is a YAML alias reference and makes js-yaml throw.
    const raw = '---\n\n*说明:本次 MR 是 8 个 GitHub PR 的 squash 同步*\n---\n';
    expect(() => parseLearningDraft(raw)).not.toThrow();
    const { data } = parseLearningDraft(raw);
    expect(data).toEqual({});
  });

  it('strips a wrapping markdown code fence', () => {
    const raw = '```markdown\n---\ntitle: "X"\n---\n\nbody\n```';
    const { data } = parseLearningDraft(raw);
    expect(data['title']).toBe('X');
  });

  it('drops conversational text before the frontmatter', () => {
    const raw = 'Sure, here is the learning:\n\n---\ntitle: "Y"\n---\n\nbody';
    const { data } = parseLearningDraft(raw);
    expect(data['title']).toBe('Y');
  });
});

/**
 * The possible-duplicate notice (#823 item 9): it compares the draft with the
 * learnings recall would find here, the shared root and the active project
 * namespaces, names them before the confirmation, and claims nothing is marked.
 */
describe('importFromMR possible-duplicate notice', () => {
  let root: string;
  const url = 'https://github.com/o/r/pull/1';
  const warnings = (): string[] => vi.mocked(log.warn).mock.calls.map(([message]) => String(message));
  const learning = (rel: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), `---\ntitle: note\n---\n${DRAFT_BODY}\n`);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-import-mr-overlap-'));
    vi.mocked(log.warn).mockClear();
    vi.mocked(setSilent).mockClear();
    vi.mocked(readline.createInterface).mockClear();
    question.mockClear();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('names an overlapping learning of an active namespace before asking, and none of an inactive one', async () => {
    learning('alpha/x.md');
    learning('beta/y.md');

    await importFromMR({ url, learningsDirs: [root], learningsNamespaces: ['alpha'], dryRun: true });

    const notices = warnings().filter((m) => m.includes('Possible duplicate'));
    expect(notices).toEqual([expect.stringContaining(path.join('alpha', 'x.md'))]);
    expect(notices[0]).not.toContain('y.md');
    const noticeOrder = vi.mocked(log.warn).mock.invocationCallOrder[warnings().indexOf(notices[0])];
    expect(noticeOrder).toBeLessThan(vi.mocked(readline.createInterface).mock.invocationCallOrder[0]);
    expect(warnings().join('\n')).not.toMatch(/supersed/i);
  });

  it('shows the notice with --all without asking', async () => {
    learning('shared.md');

    await importFromMR({ url, learningsDirs: [root], all: true, dryRun: true });

    expect(warnings()).toContainEqual(expect.stringMatching(/Possible duplicate.*shared\.md/));
    expect(readline.createInterface).not.toHaveBeenCalled();
  });

  /** A team repo declaring projects alpha and beta, each with an overlapping learning; `import` runs with alpha active. */
  const teamWithTwoProjects = (): void => {
    teamRepo = path.join(root, 'team-repo');
    fs.mkdirSync(path.join(teamRepo, 'manifest'), { recursive: true });
    fs.writeFileSync(
      path.join(teamRepo, 'manifest', 'projects.yaml'),
      'version: 1\nprojects:\n  - id: alpha\n    name: Alpha\n    resources:\n      learnings: [alpha]\n'
        + '  - id: beta\n    name: Beta\n    resources:\n      learnings: [beta]\n',
    );
    learning('team-repo/learnings/alpha/x.md');
    learning('team-repo/learnings/beta/y.md');
  };

  it.each([{ all: false }, { all: true }])('reaches the terminal from `teamai import --from-mr` before any prompt, with the active project namespace (all: $all)', async ({ all }) => {
    teamWithTwoProjects();
    const realHome = process.env.HOME;
    process.env.HOME = root;
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await importCmd({ fromMr: url, dryRun: true, all });
    } finally {
      write.mockRestore();
      process.env.HOME = realHome;
    }

    const notices = warnings().filter((m) => m.includes('Possible duplicate'));
    expect(notices).toEqual([`Possible duplicate: this learning overlaps 1 existing learning(s): ${path.join('alpha', 'x.md')}.`]);
    // Said while the logger is live: `import` silences it only for its tasks.
    const noticeOrder = vi.mocked(log.warn).mock.invocationCallOrder[warnings().indexOf(notices[0])];
    expect(noticeOrder).toBeLessThan(vi.mocked(setSilent).mock.invocationCallOrder[0]);
    if (all) expect(question).not.toHaveBeenCalled();
    else expect(noticeOrder).toBeLessThan(question.mock.invocationCallOrder[0]);
  });

  it('asks `Accept learning?` before its task list takes the terminal (#823 item 18)', async () => {
    // In a terminal, listr2 holds back what is written to stdout while a task
    // runs, so a prompt asked inside one never showed.
    teamWithTwoProjects();
    const realHome = process.env.HOME;
    process.env.HOME = root;
    const printed: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed.push(String(chunk));
      return true;
    });
    let atPrompt = { silenced: true, printed: 'not asked' };
    question.mockImplementationOnce(async () => {
      atPrompt = { silenced: vi.mocked(setSilent).mock.calls.at(-1)?.[0] === true, printed: printed.join('') };
      return 'n';
    });
    try {
      await importCmd({ fromMr: url, dryRun: true });
    } finally {
      write.mockRestore();
      process.env.HOME = realHome;
    }

    expect(atPrompt).toEqual({ silenced: false, printed: '' });
    // The task list still runs, after the answer.
    expect(printed.join('')).toContain('Publish learning');
  });

  it('still extracts with --dry-run when projects.yaml does not parse, comparing the shared root only', async () => {
    teamRepo = path.join(root, 'team-repo');
    const realHome = process.env.HOME;
    process.env.HOME = root;
    fs.mkdirSync(path.join(teamRepo, 'manifest'), { recursive: true });
    fs.writeFileSync(path.join(teamRepo, 'manifest', 'projects.yaml'), 'projects: [unclosed\n');
    learning('team-repo/learnings/shared.md');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await importCmd({ fromMr: url, dryRun: true, all: true });
    } finally {
      write.mockRestore();
      process.env.HOME = realHome;
    }

    expect(warnings()).toContainEqual(expect.stringMatching(/duplicate check reads the shared learnings only: Invalid projects manifest YAML/));
    expect(warnings()).toContainEqual(expect.stringMatching(/Possible duplicate.*shared\.md/));
  });
});
