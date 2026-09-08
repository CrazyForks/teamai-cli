import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { registerPackagesCommand } from '../pkg/register-command.js';
import type { GlobalOptions } from '../types.js';

/**
 * Regression test for the P1 where install options declared on the `packages`
 * parent (--global, --registry, --npm, --claude) were silently dropped when
 * invoked via the `packages install` subcommand, because the action merged only
 * the root global options and the subcommand's own options — never the parent's.
 *
 * This drives the REAL command wiring (registerPackagesCommand) through
 * commander's parser and asserts exactly which options reach pkgInstall.
 */
function buildProgram() {
  const run = vi.fn(async (_target: string | undefined, _opts: GlobalOptions) => {});
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit on parse errors
  // Root global options, same as the real teamai program.
  program.option('--dry-run').option('-v, --verbose');
  registerPackagesCommand(program, run);
  return { program, run };
}

async function parse(program: Command, args: string[]) {
  await program.parseAsync(args, { from: 'user' });
}

describe('packages command option wiring', () => {
  it('passes --global and --registry through the install subcommand', async () => {
    const { program, run } = buildProgram();
    await parse(program, [
      'packages',
      'install',
      'private-tool',
      '--global',
      '--registry',
      'https://registry.example.test',
      '--dry-run',
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    const [target, opts] = run.mock.calls[0]!;
    expect(target).toBe('private-tool');
    expect(opts.global).toBe(true);
    expect(opts.registry).toBe('https://registry.example.test');
    expect(opts.dryRun).toBe(true);
  });

  it('passes --npm through the install subcommand', async () => {
    const { program, run } = buildProgram();
    await parse(program, ['packages', 'install', 'typescript@5.9.2', '--npm']);
    const [target, opts] = run.mock.calls[0]!;
    expect(target).toBe('typescript@5.9.2');
    expect(opts.npm).toBe(true);
  });

  it('passes install options through the bare default action too', async () => {
    const { program, run } = buildProgram();
    await parse(program, ['packages', 'private-tool', '--global']);
    const [target, opts] = run.mock.calls[0]!;
    expect(target).toBe('private-tool');
    expect(opts.global).toBe(true);
  });
});
