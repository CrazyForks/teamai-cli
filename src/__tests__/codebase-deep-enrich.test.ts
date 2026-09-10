import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock the AI client so deepEnrich's LLM calls fail instantly instead of
// waiting on real 600s timeouts. deepEnrich treats these as non-blocking skips.
vi.mock('../utils/ai-client.js', () => ({
  getAICliName: () => 'mock-cli',
  callClaude: vi.fn(async () => {
    throw new Error('mock: AI unavailable');
  }),
  callClaudeParallel: vi.fn(async () => {
    throw new Error('mock: AI batch unavailable');
  }),
}));

import { codebaseCmd } from '../codebase-cmd.js';

const temporaryDirectories: string[] = [];

function createEnrichFixture(project = 'faketest'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-deep-enrich-unit-'));
  temporaryDirectories.push(root);
  const evidenceDir = path.join(root, 'teamwiki', 'evidence', 'code', project);
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, '_manifest.json'),
    JSON.stringify({
      schemaVersion: 'team-wiki.codebase-output-manifest.v2',
      project,
      generatedAt: '2026-01-01T00:00:00Z',
      components: [
        {
          slug: 'Auth',
          docPath: `evidence/code/${project}/Auth.md`,
          title: 'Auth',
          category: 'component',
          confidence: 'INFERRED',
          responsibilities: ['Authenticate users'],
          entrypoints: [],
        },
      ],
      edges: [{ from: 'Auth', to: 'Store', relation: 'DEPENDS_ON' }],
    }, null, 2),
  );
  return root;
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('codebase deep-enrich', () => {
  it('sets a failing exit code when the requested output has no teamwiki', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-deep-enrich-missing-'));
    temporaryDirectories.push(root);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await codebaseCmd({ deepEnrich: true, project: 'faketest', output: root });

    expect(process.exitCode).toBe(1);
  });

  it('lists deep-enrich in the handler help', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await codebaseCmd({});

    expect(log.mock.calls.flat()).toContain(
      '  teamai codebase --deep-enrich           Generate deep knowledge from extracted evidence',
    );
  });

  it('writes deterministic graph docs from extracted evidence when AI is unavailable', async () => {
    const root = createEnrichFixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await codebaseCmd({ deepEnrich: true, project: 'faketest', output: root, json: true });

    expect(process.exitCode).toBeUndefined();
    const report = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(report).toMatchObject({ project: 'faketest', complete: true });

    const docsDir = path.join(root, 'teamwiki', 'evidence', 'code', 'faketest', 'docs');
    expect(fs.existsSync(path.join(docsDir, 'graph-g1-relations.md'))).toBe(true);
    expect(fs.existsSync(path.join(docsDir, 'graph-g2-dataflow.md'))).toBe(true);
    expect(fs.existsSync(path.join(docsDir, 'graph-g3-interfaces.md'))).toBe(true);
    expect(fs.readFileSync(path.join(docsDir, 'graph-g1-relations.md'), 'utf8').length).toBeGreaterThan(0);
  });

  it('does not report success when the evidence dir has no components', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-deep-enrich-empty-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'teamwiki', 'evidence', 'code', 'faketest'), { recursive: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await codebaseCmd({ deepEnrich: true, project: 'faketest', output: root, json: true });

    expect(process.exitCode).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('No components in evidence');
    expect(fs.existsSync(path.join(root, 'teamwiki', 'evidence', 'code', 'faketest', 'docs'))).toBe(false);
  });

  it('previews without writing when --dry-run is set', async () => {
    const root = createEnrichFixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await codebaseCmd({ deepEnrich: true, project: 'faketest', output: root, json: true, dryRun: true });

    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
      project: 'faketest',
      dryRun: true,
    });
    expect(fs.existsSync(path.join(root, 'teamwiki', 'evidence', 'code', 'faketest', 'docs'))).toBe(false);
  });

  it('rejects a project slug that escapes the evidence directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-deep-enrich-escape-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'teamwiki'), { recursive: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await codebaseCmd({ deepEnrich: true, project: '..', output: root });

    expect(process.exitCode).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toMatch(/outside|traversal/i);
  });
});
