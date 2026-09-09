import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = path.join(ROOT, 'dist', 'index.js');

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

function runCLI(args: string[], cwd: string = ROOT): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI, ...args], {
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.stdin.end();
    child.on('close', (code) => {
      resolve({ code, stdout, stderr, output: stdout + stderr });
    });
  });
}

describe('teamai codebase extract CLI (issue #360 slice 1)', () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`CLI binary not found at ${CLI}. Run "npm run build" first.`);
    }
  });

  it('lists --extract on teamai codebase --help', async () => {
    const result = await runCLI(['codebase', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--extract');
  });

  it('extracts a tiny local repo into teamwiki graph output', async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-extract-360-'));
    try {
      const srcDir = path.join(fixture, 'src');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(
        path.join(srcDir, 'greet.ts'),
        'export function greet(name: string): string {\n  return `hello ${name}`;\n}\n',
      );

      const result = await runCLI(
        ['codebase', '--extract', fixture, '--project', 'slice360', '--json', '--max-files', '10'],
        fixture,
      );
      expect(result.code, result.output).toBe(0);

      const graphPath = path.join(fixture, 'teamwiki', '.indices', 'graph-index.json');
      expect(fs.existsSync(graphPath), result.output).toBe(true);
      const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as {
        nodes?: unknown[];
        edges?: unknown[];
      };
      const artifactCount = (graph.nodes?.length ?? 0) + (graph.edges?.length ?? 0);
      expect(artifactCount).toBeGreaterThan(0);

      const evidenceDir = path.join(fixture, 'teamwiki', 'evidence', 'code', 'slice360');
      expect(fs.existsSync(evidenceDir)).toBe(true);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
