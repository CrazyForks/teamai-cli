import { pathExists } from '../utils/fs.js';
import { probeBinary } from '../utils/exec.js';
import { ClaudePluginAdapter } from './adapters/claude-plugin.js';
import { NpmAdapter } from './adapters/npm.js';

export interface DetectedEcosystems {
  npm: boolean;
  claude: boolean;
}

export function createPackageAdapters(): {
  npm: NpmAdapter;
  claude: ClaudePluginAdapter;
} {
  return {
    npm: new NpmAdapter(),
    claude: new ClaudePluginAdapter(),
  };
}

export async function detectEcosystems(cwd: string): Promise<DetectedEcosystems> {
  const [npm, claude] = await Promise.all([
    pathExists(`${cwd}/package.json`),
    probeBinary('claude', ['plugin', '--help']).then(Boolean),
  ]);
  return { npm, claude };
}
