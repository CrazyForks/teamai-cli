import { detectProjectConfig, loadLocalConfig } from '../config.js';
import { getTeamaiHome } from '../types.js';
import { log } from '../utils/logger.js';
import {
  hasPackageDeclarations,
  loadPackageLock,
  loadPackageManifest,
  packageDeclarationHash,
} from './manifest.js';

export function buildPackageHintMessage(npmCount: number, claudeCount: number): string {
  const summary = [
    npmCount > 0 ? `${npmCount} npm package${npmCount === 1 ? '' : 's'}` : '',
    claudeCount > 0 ? `${claudeCount} Claude plugin${claudeCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' and ');
  return [
    `[teamai:pkg-hint] Team package declarations changed (${summary}).`,
    'Review the packages section, then run `teamai install` to apply it.',
    'TeamAI never installs third-party package or plugin code automatically at SessionStart.',
  ].join('\n');
}

export async function computePackageHintOutput(cwd: string): Promise<string | null> {
  if (process.env.TEAMAI_PACKAGE_HINT_DISABLED === '1') return null;
  try {
    const localConfig = await detectProjectConfig(cwd) ?? await loadLocalConfig();
    if (!localConfig || localConfig.repo.kind === 'http') return null;
    const manifest = await loadPackageManifest(localConfig.repo.localPath);
    if (!hasPackageDeclarations(manifest)) return null;
    const lock = await loadPackageLock(
      getTeamaiHome(localConfig.scope, localConfig.projectRoot),
    );
    if (lock?.declarationHash === packageDeclarationHash(manifest)) return null;

    const message = buildPackageHintMessage(
      manifest.packages.npm?.length ?? 0,
      manifest.packages.claude?.plugins.length ?? 0,
    );
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: message,
      },
    });
  } catch (error) {
    log.debug(`pkg-hint: ${(error as Error).message}`);
    return null;
  }
}
