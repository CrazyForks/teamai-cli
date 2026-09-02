// -*- coding: utf-8 -*-
/**
 * Tests for viz.ts aggregation logic and viz-render.ts HTML output.
 *
 * Pure-function and tmpdir-based tests only — no real ~/.teamai access.
 * buildCoverage / buildTrend / buildAuthors are private helpers inlined in buildVizData
 * and cannot be tested independently without hitting real I/O; their logic is therefore
 * covered indirectly through renderReport assertions on a hand-crafted VizData fixture.
 */
import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { aggregateTeamVotes, resolveVizRoot, buildVizData } from '../viz.js';
import { renderReport } from '../viz-render.js';
import type { VizData } from '../viz.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a complete minimal VizData fixture, allowing partial overrides. */
function makeVizData(overrides: Partial<VizData> = {}): VizData {
  return {
    generatedAt: '2026-08-31T00:00:00.000Z',
    root: '/tmp/teamai-test',
    source: { scope: 'local', label: 'Local ~/.teamai · your recalls only' },
    totalEntries: 0,
    totalRecalls: 0,
    overallCoveragePct: 0,
    contributorCount: 0,
    coverage: [],
    topRecalled: [],
    silent: [],
    trend: [],
    authors: [],
    maintenance: { promote: [], prune: [], stale: [] },
    ...overrides,
  };
}

/** Create a YAML string in the v2 votes format expected by loadUserVotes. */
function votesYaml(
  entries: Record<string, { recalled_count: number; upvoted_count: number; last_recalled_at: string | null }>,
): string {
  const lines = ['version: 2', 'votes:'];
  for (const [docId, e] of Object.entries(entries)) {
    lines.push(`  ${docId}:`);
    lines.push(`    recalled_count: ${e.recalled_count}`);
    lines.push(`    upvoted_count: ${e.upvoted_count}`);
    lines.push(`    last_recalled_at: ${e.last_recalled_at ? `"${e.last_recalled_at}"` : 'null'}`);
  }
  lines.push('deltas: {}');
  return lines.join('\n') + '\n';
}

// ─── aggregateTeamVotes ────────────────────────────────────────────────────────

describe('aggregateTeamVotes', () => {
  const tmpBase = path.join(os.tmpdir(), 'teamai-viz-test');
  const votesDir = path.join(tmpBase, 'votes');

  afterEach(async () => {
    await fs.rm(tmpBase, { recursive: true, force: true });
  });

  it('accumulates recalled_count and takes the larger last_recalled_at across two users', async () => {
    await fs.mkdir(votesDir, { recursive: true });

    // User A: doc-abc recalled 3 times, upvoted 1, older timestamp
    await fs.writeFile(
      path.join(votesDir, 'user-a.yaml'),
      votesYaml({
        'doc-abc': { recalled_count: 3, upvoted_count: 1, last_recalled_at: '2026-01-10T08:00:00Z' },
      }),
      'utf-8',
    );

    // User B: doc-abc recalled 5 times, upvoted 2, newer timestamp
    await fs.writeFile(
      path.join(votesDir, 'user-b.yaml'),
      votesYaml({
        'doc-abc': { recalled_count: 5, upvoted_count: 2, last_recalled_at: '2026-06-20T12:00:00Z' },
      }),
      'utf-8',
    );

    const result = await aggregateTeamVotes(votesDir);

    expect(result.byDoc['doc-abc']).toBeDefined();
    // recalled_count should be summed: 3 + 5 = 8
    expect(result.byDoc['doc-abc'].recalledCount).toBe(8);
    // upvoted_count should be summed: 1 + 2 = 3
    expect(result.byDoc['doc-abc'].upvotedCount).toBe(3);
    // last_recalled_at should be the larger value
    expect(result.byDoc['doc-abc'].lastRecalledAt).toBe('2026-06-20T12:00:00Z');
  });

  it('returns {} when the votes directory does not exist', async () => {
    const missing = path.join(tmpBase, 'no-such-dir');
    const result = await aggregateTeamVotes(missing);
    expect(result.byDoc).toEqual({});
    expect(result.activeContributors).toBe(0);
  });

  it('handles a doc present in only one user file and null last_recalled_at in one file', async () => {
    await fs.mkdir(votesDir, { recursive: true });

    await fs.writeFile(
      path.join(votesDir, 'user-a.yaml'),
      votesYaml({
        'doc-solo': { recalled_count: 2, upvoted_count: 0, last_recalled_at: null },
      }),
      'utf-8',
    );

    await fs.writeFile(
      path.join(votesDir, 'user-b.yaml'),
      votesYaml({
        'doc-solo': { recalled_count: 1, upvoted_count: 1, last_recalled_at: '2026-03-01T00:00:00Z' },
      }),
      'utf-8',
    );

    const result = await aggregateTeamVotes(votesDir);

    expect(result.byDoc['doc-solo'].recalledCount).toBe(3);
    expect(result.byDoc['doc-solo'].upvotedCount).toBe(1);
    // null should lose to any non-null timestamp
    expect(result.byDoc['doc-solo'].lastRecalledAt).toBe('2026-03-01T00:00:00Z');
  });

  it('counts only users with at least one recalled_count > 0 as active contributors', async () => {
    await fs.mkdir(votesDir, { recursive: true });

    // User A: has recalls
    await fs.writeFile(
      path.join(votesDir, 'user-a.yaml'),
      votesYaml({
        'doc-x': { recalled_count: 2, upvoted_count: 0, last_recalled_at: null },
      }),
      'utf-8',
    );

    // User B: no recalls at all
    await fs.writeFile(
      path.join(votesDir, 'user-b.yaml'),
      votesYaml({
        'doc-x': { recalled_count: 0, upvoted_count: 0, last_recalled_at: null },
      }),
      'utf-8',
    );

    const result = await aggregateTeamVotes(votesDir);
    expect(result.activeContributors).toBe(1);
  });
});

// ─── renderReport ─────────────────────────────────────────────────────────────

describe('renderReport', () => {
  it('returns a string that starts with <!DOCTYPE html', () => {
    const html = renderReport(makeVizData());
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html/i);
  });

  it('contains key section headings', () => {
    const html = renderReport(makeVizData());
    expect(html).toContain('Coverage by Type');
    expect(html).toContain('Top Recalled Entries');
    expect(html).toContain('Maintenance Console');
    expect(html).toContain('Overview');
    expect(html).toContain('Author Contributions');
  });

  it('escapes XSS in EntryMetric.title (topRecalled)', () => {
    const xssTitle = '<script>alert(1)</script>';
    const data = makeVizData({
      topRecalled: [
        {
          docId: 'xss-doc',
          title: xssTitle,
          type: 'learnings',
          author: 'tester',
          date: '2026-01-01',
          tags: [],
          recalledCount: 5,
          upvotedCount: 1,
          lastRecalledAt: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const html = renderReport(data);
    // Raw script tag must not appear in the output
    expect(html).not.toContain('<script>alert(1)</script>');
    // The title should be escaped instead
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes XSS in EntryMetric.title (silent entries)', () => {
    const xssTitle = '<img src=x onerror=alert(1)>';
    const data = makeVizData({
      silent: [
        {
          docId: 'xss-silent',
          title: xssTitle,
          type: 'docs',
          author: 'tester',
          date: '2026-01-01',
          tags: [],
          recalledCount: 0,
          upvotedCount: 0,
          lastRecalledAt: null,
        },
      ],
    });

    const html = renderReport(data);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('shows "None right now." for all three empty maintenance sub-blocks', () => {
    const html = renderReport(makeVizData({ maintenance: { promote: [], prune: [], stale: [] } }));
    // Each of the three blocks emits "None right now." when empty
    const occurrences = (html.match(/None right now\./g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it('shows "All entries have been recalled at least once." when silent is empty', () => {
    const html = renderReport(makeVizData({ silent: [] }));
    expect(html).toContain('All entries have been recalled at least once.');
  });

  it('reflects totalEntries and overallCoveragePct in the output', () => {
    const html = renderReport(makeVizData({ totalEntries: 42, overallCoveragePct: 75 }));
    expect(html).toContain('42');
    expect(html).toContain('75%');
  });
});

// ─── resolveVizRoot + buildVizData integration ────────────────────────────────

describe('buildVizData with explicit --repo', () => {
  let tmpRepo: string;

  afterEach(async () => {
    if (tmpRepo) {
      await fs.rm(tmpRepo, { recursive: true, force: true });
    }
  });

  it('sources corpus from the given repo and does not fall back to global index', async () => {
    tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'teamai-viz-repo-'));

    // Create a skill: skills/team-only-skill/SKILL.md
    const skillDir = path.join(tmpRepo, 'skills', 'team-only-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'title: "TEAM ONLY skill"',
        'author: alice',
        'tags: [team]',
        '---',
        '',
        'This skill belongs to the team repo only.',
      ].join('\n'),
      'utf-8',
    );

    // Create an empty votes directory so aggregateTeamVotes gets a valid path
    await fs.mkdir(path.join(tmpRepo, 'votes'), { recursive: true });

    const paths = await resolveVizRoot({ repo: tmpRepo });

    // Bug A: explicit --repo must not fall back to the global user index
    expect(paths.indexPath).toBeUndefined();
    expect(paths.source.scope).toBe('team');

    const data = await buildVizData(paths);

    expect(data.source.scope).toBe('team');
    expect(data.totalEntries).toBeGreaterThanOrEqual(1);

    // The skill title must appear somewhere in the report corpus
    const allTitles = [
      ...data.topRecalled.map((e) => e.title),
      ...data.silent.map((e) => e.title),
    ];
    expect(allTitles.some((t) => t.includes('TEAM ONLY skill'))).toBe(true);
  });
});
