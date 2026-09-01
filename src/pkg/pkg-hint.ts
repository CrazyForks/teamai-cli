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
    npmCount > 0 ? `${npmCount} 个 npm 包` : '',
    claudeCount > 0 ? `${claudeCount} 个 Claude 插件` : '',
  ].filter(Boolean).join('、');
  return [
    `[teamai:pkg-hint] 团队开发环境声明有更新（${summary}）。`,
    '请先查看 teamai.yaml 的 packages 段，确认后运行 `teamai install` 安装。',
    '该命令会执行第三方包/插件代码，因此不会在 SessionStart 时静默安装。',
    '',
    `[teamai:pkg-hint] Team package declarations changed (${summary}).`,
    'Review the packages section, then run `teamai install` to apply it.',
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
