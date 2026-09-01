import { spawn } from 'node:child_process';

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stream?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type CommandExecutor = (
  command: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

export const execCommand: CommandExecutor = (
  command,
  args,
  options = {},
) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  let settled = false;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const finish = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    callback();
  };

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    if (options.stream) process.stdout.write(text);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    if (options.stream) process.stderr.write(text);
  });

  const timer = setTimeout(() => {
    child.kill();
    finish(() => reject(new Error(
      `Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`,
    )));
  }, timeoutMs);

  child.on('error', (error) => finish(() => reject(error)));
  child.on('close', (code) => finish(() => resolve({
    stdout,
    stderr,
    code: code ?? 1,
  })));
});

export async function probeBinary(
  binary: string,
  args: string[] = ['--version'],
  executor: CommandExecutor = execCommand,
): Promise<string> {
  try {
    const result = await executor(binary, args, { timeoutMs: 5_000 });
    if (result.code !== 0) return '';
    return (result.stdout || result.stderr).trim();
  } catch {
    return '';
  }
}

export function formatCommand(command: string, args: string[]): string {
  const quote = (value: string): string => /^[a-zA-Z0-9_./:@=+-]+$/.test(value)
    ? value
    : JSON.stringify(value);
  return [command, ...args.map(quote)].join(' ');
}
