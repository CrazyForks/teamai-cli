import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractKeywords, overlapRatio, findOverlappingLearnings } from '../utils/dedup.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-dedup-test-'));
}

function formatDatePrefix(daysAgo: number): string {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

// ─── extractKeywords ───────────────────────────────────────────────────────

describe('extractKeywords', () => {
  it('提取英文关键词，过滤停用词', () => {
    const keywords = extractKeywords('The quick brown fox');
    expect(keywords.has('quick')).toBe(true);
    expect(keywords.has('brown')).toBe(true);
    expect(keywords.has('fox')).toBe(true);
    expect(keywords.has('the')).toBe(false);
  });

  it('提取 CJK 关键词，过滤 CJK 停用词', () => {
    const keywords = extractKeywords('优化性能问题的解决方案');
    // '的' 是 CJK 停用词，不应出现
    expect(keywords.has('的')).toBe(false);
    // 其余非停用词单字应出现
    expect(keywords.has('优')).toBe(true);
    expect(keywords.has('化')).toBe(true);
    expect(keywords.has('性')).toBe(true);
    expect(keywords.has('能')).toBe(true);
  });

  it('过滤长度 < 2 的英文词（单字母）', () => {
    const keywords = extractKeywords('a b c do run');
    expect(keywords.has('a')).toBe(false);
    expect(keywords.has('b')).toBe(false);
    expect(keywords.has('c')).toBe(false);
    // 'do' 是停用词，'run' 应出现
    expect(keywords.has('run')).toBe(true);
  });
});

// ─── overlapRatio ──────────────────────────────────────────────────────────

describe('overlapRatio', () => {
  it('完全相同集合返回 1.0', () => {
    const setA = new Set(['a', 'b', 'c']);
    const setB = new Set(['a', 'b', 'c']);
    expect(overlapRatio(setA, setB)).toBe(1.0);
  });

  it('完全不同集合返回 0.0', () => {
    const setA = new Set(['a', 'b']);
    const setB = new Set(['c', 'd']);
    expect(overlapRatio(setA, setB)).toBe(0.0);
  });

  it('部分重叠：{a,b,c} 和 {b,c,d} 返回 0.5', () => {
    const setA = new Set(['a', 'b', 'c']);
    const setB = new Set(['b', 'c', 'd']);
    // 交集 {b,c}=2，并集 {a,b,c,d}=4，Jaccard=0.5
    expect(overlapRatio(setA, setB)).toBe(0.5);
  });

  it('空集合返回 0', () => {
    const empty = new Set<string>();
    const nonEmpty = new Set(['a', 'b']);
    expect(overlapRatio(empty, nonEmpty)).toBe(0);
    expect(overlapRatio(nonEmpty, empty)).toBe(0);
    expect(overlapRatio(empty, empty)).toBe(0);
  });
});

// ─── findOverlappingLearnings ───────────────────────────────────────────────

describe('findOverlappingLearnings', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('正常：14 天内文件关键词高度重叠，应返回该文件且 overlap ≥ 0.6', async () => {
    const prefix = formatDatePrefix(3); // 3 天前
    const filename = `${prefix}-optimize-performance.md`;
    const content = `---
title: "optimize performance solution"
---
optimize performance solution issue resolve method
`;
    fs.writeFileSync(path.join(tmpDir, filename), content, 'utf-8');

    const draftKeywords = new Set(['optimize', 'performance', 'solution', 'issue', 'resolve']);
    const results = await findOverlappingLearnings(draftKeywords, [tmpDir], { withinDays: 14 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filename).toBe(filename);
    expect(results[0].overlap).toBeGreaterThanOrEqual(0.6);
  });

  it('超出 14 天的文件不应返回', async () => {
    const prefix = formatDatePrefix(20); // 20 天前
    const filename = `${prefix}-old-learning.md`;
    const content = `---
title: "old learning"
---
optimize performance solution issue resolve method
`;
    fs.writeFileSync(path.join(tmpDir, filename), content, 'utf-8');

    const draftKeywords = new Set(['optimize', 'performance', 'solution', 'issue', 'resolve']);
    const results = await findOverlappingLearnings(draftKeywords, [tmpDir], { withinDays: 14 });

    expect(results).toHaveLength(0);
  });

  it('目录不存在时返回空数组', async () => {
    const nonExistentDir = path.join(tmpDir, 'not-exist');
    const draftKeywords = new Set(['optimize', 'performance']);
    const results = await findOverlappingLearnings(draftKeywords, [nonExistentDir], { withinDays: 14 });

    expect(results).toEqual([]);
  });

  it('低重叠（< 0.6）的文件不应返回', async () => {
    const prefix = formatDatePrefix(1); // 1 天前
    const filename = `${prefix}-unrelated.md`;
    const content = `---
title: "unrelated topic"
---
kubernetes docker container deployment cluster
`;
    fs.writeFileSync(path.join(tmpDir, filename), content, 'utf-8');

    const draftKeywords = new Set(['python', 'pandas', 'dataframe', 'numpy', 'csv']);
    const results = await findOverlappingLearnings(draftKeywords, [tmpDir], { withinDays: 14 });

    expect(results).toHaveLength(0);
  });
});

// ─── namespaces (#823) ─────────────────────────────────────────────────────

describe('findOverlappingLearnings across project namespaces (#823)', () => {
  let tmpDir: string;
  const draftKeywords = new Set(['optimize', 'performance', 'solution', 'issue', 'resolve']);
  const overlapping = '---\ntitle: note\n---\noptimize performance solution issue resolve method\n';
  const write = (root: string, rel: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content, 'utf-8');
  };

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('compares the root and the active namespaces, never an inactive one', async () => {
    const root = path.join(tmpDir, 'learnings');
    write(root, 'shared.md', overlapping);
    write(root, 'alpha/x.md', overlapping);
    write(root, 'beta/y.md', overlapping);

    const results = await findOverlappingLearnings(draftKeywords, [root], { namespaces: ['alpha'] });

    expect(results.map((r) => r.filename).sort()).toEqual([path.join('alpha', 'x.md'), 'shared.md']);
  });

  it('lets the first root win for one relative path', async () => {
    const first = path.join(tmpDir, 'first');
    const second = path.join(tmpDir, 'second');
    write(first, 'alpha/x.md', '---\ntitle: note\n---\nkubernetes docker container deployment cluster\n');
    write(second, 'alpha/x.md', overlapping);
    write(second, 'alpha/w.md', overlapping);

    const results = await findOverlappingLearnings(draftKeywords, [first, second], { namespaces: ['alpha'] });

    expect(results.map((r) => r.filename)).toEqual([path.join('alpha', 'w.md')]);
  });

  it('dates a namespaced learning by its file name, as a root one', async () => {
    const root = path.join(tmpDir, 'learnings');
    write(root, `alpha/${formatDatePrefix(20)}-old.md`, overlapping);

    const results = await findOverlappingLearnings(draftKeywords, [root], { namespaces: ['alpha'], withinDays: 14 });

    expect(results).toEqual([]);
  });

  it('skips a namespace that is not a single safe path segment', async () => {
    const root = path.join(tmpDir, 'learnings');
    write(tmpDir, 'outside.md', overlapping);
    fs.mkdirSync(root, { recursive: true });

    const results = await findOverlappingLearnings(draftKeywords, [root], { namespaces: ['..'] });

    expect(results).toEqual([]);
  });
});
