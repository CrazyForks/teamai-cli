import { formatCommand, type CommandExecutor } from '../../utils/exec.js';
import { log } from '../../utils/logger.js';
import type {
  ClaudeEcosystem,
  ClaudeMarketplace,
  ClaudeMarketplaceLock,
  ClaudePluginLock,
  PackageStatus,
} from '../types.js';
import {
  PackageAdapter,
  type PackageInstallContext,
} from './base.js';

export interface ClaudePluginListItem {
  id?: string;
  version?: string;
  scope?: string;
  enabled?: boolean;
  installPath?: string;
}

export interface ClaudeMarketplaceListItem {
  name?: string;
  source?: string;
  repo?: string;
  installLocation?: string;
}

export interface ClaudeLockSection {
  marketplaces: ClaudeMarketplaceLock[];
  plugins: ClaudePluginLock[];
}

function marketplaceSource(marketplace: ClaudeMarketplace): string {
  if (!marketplace.ref) return marketplace.repo;
  const separator = marketplace.repo.includes('://') || marketplace.repo.endsWith('.git')
    ? '#'
    : '@';
  return `${marketplace.repo}${separator}${marketplace.ref}`;
}

function parseJsonArray<T>(stdout: string): T[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
  return parsed as T[];
}

export class ClaudePluginAdapter extends PackageAdapter<ClaudeEcosystem, ClaudeLockSection> {
  readonly ecosystem = 'claude' as const;

  constructor(executor?: CommandExecutor) {
    super(executor);
  }

  async detect(_cwd: string): Promise<boolean> {
    try {
      const result = await this.execute('claude', ['plugin', '--help'], { timeoutMs: 5_000 });
      return result.code === 0;
    } catch {
      return false;
    }
  }

  private async queryPlugins(): Promise<ClaudePluginListItem[]> {
    try {
      const result = await this.execute(
        'claude',
        ['plugin', 'list', '--json'],
        { timeoutMs: 30_000 },
      );
      if (result.code !== 0) return [];
      return parseJsonArray<ClaudePluginListItem>(result.stdout);
    } catch {
      return [];
    }
  }

  private async queryMarketplaces(): Promise<ClaudeMarketplaceListItem[]> {
    try {
      const result = await this.execute(
        'claude',
        ['plugin', 'marketplace', 'list', '--json'],
        { timeoutMs: 30_000 },
      );
      if (result.code !== 0) return [];
      return parseJsonArray<ClaudeMarketplaceListItem>(result.stdout);
    } catch {
      return [];
    }
  }

  async registeredMarketplaces(): Promise<ClaudeMarketplaceListItem[]> {
    return this.queryMarketplaces();
  }

  async snapshot(declaration: ClaudeEcosystem): Promise<ClaudeLockSection> {
    const [marketplaces, plugins] = await Promise.all([
      this.queryMarketplaces(),
      this.queryPlugins(),
    ]);
    const declaredMarketplaces = new Set(declaration.marketplaces.map((item) => item.name));
    const declaredPlugins = new Set(declaration.plugins.map((item) => item.name));

    return {
      marketplaces: marketplaces
        .filter((item) => item.name && declaredMarketplaces.has(item.name))
        .map((item) => ({
          name: item.name!,
          ...(item.source ? { source: item.source } : {}),
          ...(item.repo ? { repo: item.repo } : {}),
          ...(item.installLocation ? { installLocation: item.installLocation } : {}),
        })),
      plugins: plugins
        .filter((item) => item.id && declaredPlugins.has(item.id))
        .map((item) => ({
          id: item.id!,
          version: item.version ?? 'unknown',
          scope: item.scope ?? 'user',
          enabled: item.enabled ?? true,
          ...(item.installPath ? { installPath: item.installPath } : {}),
        })),
    };
  }

  async install(
    declaration: ClaudeEcosystem,
    context: PackageInstallContext,
  ): Promise<ClaudeLockSection> {
    if (declaration.marketplaces.length === 0 && declaration.plugins.length === 0) {
      return { marketplaces: [], plugins: [] };
    }

    if (context.dryRun) {
      for (const marketplace of declaration.marketplaces) {
        const args = [
          'plugin', 'marketplace', 'add', marketplaceSource(marketplace),
          '--scope', context.scope,
        ];
        log.info(`[dry-run] Would run: ${formatCommand('claude', args)}`);
      }
      for (const plugin of declaration.plugins) {
        const args = [
          'plugin', 'install', plugin.name,
          '--scope', plugin.scope ?? context.scope,
          '--yes',
        ];
        log.info(`[dry-run] Would run: ${formatCommand('claude', args)}`);
      }
      return { marketplaces: [], plugins: [] };
    }

    if (!await this.detect(context.cwd)) {
      throw new Error(
        'Claude plugin CLI is unavailable. Install or upgrade Claude Code, then retry.',
      );
    }

    const installedMarketplaces = new Set(
      (await this.queryMarketplaces()).flatMap((item) => item.name ? [item.name] : []),
    );
    for (const marketplace of declaration.marketplaces) {
      if (installedMarketplaces.has(marketplace.name)) continue;
      const args = [
        'plugin', 'marketplace', 'add', marketplaceSource(marketplace),
        '--scope', context.scope,
      ];
      const result = await this.execute('claude', args, {
        cwd: context.cwd,
        timeoutMs: 120_000,
        stream: true,
      });
      if (result.code !== 0) {
        log.warn(
          `Could not add Claude marketplace "${marketplace.name}": ${result.stderr.trim()}`,
        );
      }
    }

    for (const plugin of declaration.plugins) {
      const args = [
        'plugin', 'install', plugin.name,
        '--scope', plugin.scope ?? context.scope,
        '--yes',
      ];
      const result = await this.execute('claude', args, {
        cwd: context.cwd,
        timeoutMs: 120_000,
        stream: true,
      });
      if (result.code !== 0) {
        throw new Error(
          `Claude plugin install failed for "${plugin.name}" (exit ${result.code}): `
          + result.stderr.trim(),
        );
      }
    }

    return this.snapshot(declaration);
  }

  async status(
    declaration: ClaudeEcosystem,
    _context: PackageInstallContext,
  ): Promise<PackageStatus[]> {
    const installed = new Map(
      (await this.queryPlugins()).flatMap((item) => item.id ? [[item.id, item] as const] : []),
    );
    return declaration.plugins.map((plugin) => {
      const actual = installed.get(plugin.name);
      const versionMismatch = plugin.version
        && actual?.version
        && actual.version !== 'unknown'
        && plugin.version !== actual.version;
      return {
        name: plugin.name,
        installed: !!actual,
        ...(actual?.version ? { version: actual.version } : {}),
        ...(actual ? { enabled: actual.enabled ?? true } : {}),
        ...(!actual
          ? { detail: 'declared but not installed' }
          : versionMismatch
            ? { detail: `declared ${plugin.version}, installed ${actual.version}` }
            : {}),
      };
    });
  }
}
