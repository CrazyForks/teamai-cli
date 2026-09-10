import { afterEach, describe, expect, it, vi } from 'vitest';

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('codebase command registration', () => {
  it('lists the public reconcile option', async () => {
    let output = '';
    process.argv = ['node', 'teamai', 'codebase', '--help'];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    await expect(import('../index.js')).rejects.toThrow('process.exit(0)');
    expect(output).toContain('--reconcile');
  });
});
