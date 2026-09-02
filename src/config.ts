import YAML from 'yaml';
import path from 'node:path';
import {
  TeamaiConfigSchema,
  LocalConfigSchema,
  StateSchema,
  TEAMAI_CONFIG_PATH,
  TEAMAI_STATE_PATH,
  type TeamaiConfig,
  type LocalConfig,
  type State,
  type Scope,
  getTeamaiHome,
  getConfigPath,
  getStatePath,
} from './types.js';
import { readFileSafe, readJson, writeFile, writeJson, expandHome, pathExists } from './utils/fs.js';
import { resolveAnchors } from './utils/git.js';
import { log } from './utils/logger.js';
import { loadRolesManifest } from './roles.js';

async function migrateLegacyRoleConfig(config: LocalConfig, configPath: string): Promise<LocalConfig> {
  if (config.primaryRole) {
    return config;
  }

  let manifest;
  try {
    manifest = await loadRolesManifest(config.repo.localPath);
  } catch {
    return config;
  }

  const haiRole = manifest.roles.find((role) => role.id === 'hai');
  if (!haiRole) {
    return config;
  }

  const migrated: LocalConfig = {
    ...config,
    primaryRole: 'hai',
    additionalRoles: config.additionalRoles ?? [],
    resourceProfileVersion: manifest.version,
  };

  await writeFile(expandHome(configPath), YAML.stringify(migrated));
  log.info('Migrated legacy teamai config to default role profile: hai');
  return migrated;
}

/**
 * Load the team config (teamai.yaml) from the team repo
 */
export async function loadTeamConfig(repoPath: string): Promise<TeamaiConfig | null> {
  const content = await readFileSafe(path.join(repoPath, 'teamai.yaml'));
  if (!content) {
    log.debug('teamai.yaml not found in repo');
    return null;
  }
  try {
    const raw = YAML.parse(content);
    return TeamaiConfigSchema.parse(raw);
  } catch (e) {
    log.error(`Invalid teamai.yaml: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Load the local config (~/.teamai/config.yaml)
 */
export async function loadLocalConfig(): Promise<LocalConfig | null> {
  const configPath = expandHome(TEAMAI_CONFIG_PATH);
  const content = await readFileSafe(configPath);
  if (!content) return null;
  try {
    const raw = YAML.parse(content);
    const parsed = LocalConfigSchema.parse(raw);
    return await migrateLegacyRoleConfig(parsed, configPath);
  } catch (e) {
    log.error(`Invalid local config: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Save the local config
 */
export async function saveLocalConfig(config: LocalConfig): Promise<void> {
  await writeFile(expandHome(TEAMAI_CONFIG_PATH), YAML.stringify(config));
}

/**
 * Load the local state (~/.teamai/state.json)
 */
export async function loadState(): Promise<State> {
  const raw = await readJson<Record<string, unknown>>(expandHome(TEAMAI_STATE_PATH));
  if (!raw) return StateSchema.parse({});
  return StateSchema.parse(raw);
}

/**
 * Save the local state
 */
export async function saveState(state: State): Promise<void> {
  await writeJson(expandHome(TEAMAI_STATE_PATH), state);
}

/**
 * Require that teamai is initialized (local config exists)
 */
export async function requireInit(): Promise<{ localConfig: LocalConfig; teamConfig: TeamaiConfig }> {
  const localConfig = await loadLocalConfig();
  if (!localConfig) {
    throw new Error('teamai is not initialized. Run `teamai init` first.');
  }
  const teamConfig = await loadTeamConfig(localConfig.repo.localPath);
  if (!teamConfig) {
    throw new Error('Team config (teamai.yaml) not found. Check your repo path.');
  }
  return { localConfig, teamConfig };
}

// ─── Scope-aware config loading ─────────────────────────

/**
 * Load a LocalConfig for a specific scope.
 * - 'user' → reads ~/.teamai/config.yaml (same as loadLocalConfig)
 * - 'project' → reads <projectRoot>/.teamai/config.yaml
 */
export async function loadLocalConfigForScope(
  scope: Scope,
  projectRoot?: string,
): Promise<LocalConfig | null> {
  const configPath = getConfigPath(scope, projectRoot);
  const content = await readFileSafe(expandHome(configPath));
  if (!content) return null;
  try {
    const raw = YAML.parse(content);
    const parsed = LocalConfigSchema.parse(raw);
    // Config files written before `projectRoot` was added to the schema (or
    // hand-edited) may be missing it. We already know the project root — it's
    // the directory this config was loaded for — so backfill it instead of
    // letting getTeamaiHome()/resolveBaseDir() silently fall back to the user
    // home directory later (#85).
    const withProjectRoot = scope === 'project' && projectRoot && !parsed.projectRoot
      ? { ...parsed, projectRoot }
      : parsed;
    return await migrateLegacyRoleConfig(withProjectRoot, configPath);
  } catch (e) {
    log.error(`Invalid ${scope} config at ${configPath}: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Save a LocalConfig for a specific scope.
 */
export async function saveLocalConfigForScope(
  config: LocalConfig,
  scope: Scope,
  projectRoot?: string,
): Promise<void> {
  const configPath = getConfigPath(scope, projectRoot);
  await writeFile(expandHome(configPath), YAML.stringify(config));
}

/**
 * Load state for a specific scope.
 */
export async function loadStateForScope(scope: Scope, projectRoot?: string): Promise<State> {
  const statePath = getStatePath(scope, projectRoot);
  const raw = await readJson<Record<string, unknown>>(expandHome(statePath));
  if (!raw) return StateSchema.parse({});
  return StateSchema.parse(raw);
}

/**
 * Save state for a specific scope.
 */
export async function saveStateForScope(state: State, scope: Scope, projectRoot?: string): Promise<void> {
  const statePath = getStatePath(scope, projectRoot);
  await writeJson(expandHome(statePath), state);
}

/**
 * Detect whether the given directory (default: cwd) has a project-scope teamai config.
 * Returns the parsed LocalConfig if scope === 'project', null otherwise.
 *
 * Subdirectory / worktree aware (issue #374): if `dir` itself has no
 * `.teamai/config.yaml` but sits inside a git repository, the lookup retries at
 * the repository's workspace root (`git rev-parse --show-toplevel`). This lets
 * `teamai` run from any subdirectory of a project, and resolves the config's
 * `projectRoot` to the CURRENT checkout — so in a git worktree, project-scope
 * resources land in that worktree rather than the main checkout.
 */
export async function detectProjectConfig(cwd?: string): Promise<LocalConfig | null> {
  const dir = cwd ?? process.cwd();
  const direct = await loadProjectConfigAt(dir);
  if (direct) return direct;

  // Not found at `dir`. If we are inside a git repo whose workspace root differs
  // from `dir` (i.e. `dir` is a subdirectory), retry there. resolveAnchors returns
  // null outside a git repo, so non-git dirs simply fall through to null.
  const anchors = await resolveAnchors(dir);
  if (anchors && anchors.workspaceRoot !== dir) {
    return loadProjectConfigAt(anchors.workspaceRoot);
  }
  return null;
}

/**
 * Load a project-scope config from `<dir>/.teamai/config.yaml`, with the
 * single-repo self-heal fallback. Returns null when there is no project-scope
 * config at `dir`.
 */
async function loadProjectConfigAt(dir: string): Promise<LocalConfig | null> {
  const configPath = path.join(dir, '.teamai', 'config.yaml');
  if (!(await pathExists(configPath))) {
    // Single-repo mode self-heal (issue #198): a teammate who cloned a repo
    // carrying `.teamai/teamai.yaml` with `mode: self` has the team knowledge on
    // disk but no local config (it is gitignored, not cloned). Auto-bootstrap the
    // machine side, then re-read. bootstrapSelfRepo is a no-op ('skip') for any
    // dir that is not a self-mode project, so this stays cheap on the hot path.
    try {
      const { bootstrapSelfRepo } = await import('./bootstrap.js');
      const result = await bootstrapSelfRepo(dir, { silent: true });
      if (result !== 'bootstrapped') return null;
    } catch {
      return null;
    }
    if (!(await pathExists(configPath))) return null;
  }
  const content = await readFileSafe(configPath);
  if (!content) return null;
  try {
    const raw = YAML.parse(content);
    const config = LocalConfigSchema.parse(raw);
    if (config.scope !== 'project') return null;
    // Always anchor projectRoot to the directory the config was actually found
    // in (the current checkout's workspace root). A persisted projectRoot can be
    // wrong — e.g. a `.teamai/` copied from the main checkout into a worktree
    // still names the main checkout, which would send project resources to the
    // wrong tree. Overriding here keeps resource landing tied to the real
    // workspace (and also backfills when projectRoot was simply absent, #85).
    return { ...config, projectRoot: dir };
  } catch {
    return null;
  }
}

/**
 * Require init for a specific scope.
 * For 'user' scope, behaves like original requireInit.
 * For 'project' scope, loads from projectRoot.
 */
export async function requireInitForScope(
  scope: Scope,
  projectRoot?: string,
): Promise<{ localConfig: LocalConfig; teamConfig: TeamaiConfig }> {
  const localConfig = await loadLocalConfigForScope(scope, projectRoot);
  if (!localConfig) {
    throw new Error(
      scope === 'project'
        ? `teamai is not initialized in project scope at ${projectRoot}. Run \`teamai init\` first.`
        : 'teamai is not initialized. Run `teamai init` first.',
    );
  }
  const teamConfig = await loadTeamConfig(localConfig.repo.localPath);
  if (!teamConfig) {
    throw new Error('Team config (teamai.yaml) not found. Check your repo path.');
  }
  return { localConfig, teamConfig };
}

/**
 * Auto-detect scope and return { localConfig, teamConfig }.
 * If cwd has a project-scope config, uses that; otherwise falls back to user scope.
 * This is the recommended entry point for commands that support both scopes.
 */
export async function autoDetectInit(): Promise<{ localConfig: LocalConfig; teamConfig: TeamaiConfig }> {
  const projectConfig = await detectProjectConfig();
  if (projectConfig) {
    const teamConfig = await loadTeamConfig(projectConfig.repo.localPath);
    if (!teamConfig) {
      throw new Error('Team config (teamai.yaml) not found. Check your repo path.');
    }
    return { localConfig: projectConfig, teamConfig };
  }
  return requireInit();
}
