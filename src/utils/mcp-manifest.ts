import path from 'node:path';
import {
  managedMcpManifestPath,
  legacyManagedMcpManifestPath,
  managedMcpWorkspaceId,
  type ManagedMcpManifest,
  type ManagedMcpRecord,
} from '../types.js';
import { readJson, writeJsonAtomic, expandHome } from './fs.js';

/**
 * Load a project worktree's own managed-MCP manifest, migrating this worktree's
 * ownership records out of any pre-#374 shared file on first read.
 *
 * Each worktree now has its OWN file at
 * `<dataHome>/workspaces/<workspaceId>/managed-mcp.json` (see
 * managedMcpManifestPath). This removes the two hazards of a single shared file
 * in the partition: cross-worktree ownership bleed and lost updates under
 * concurrent read-modify-write.
 *
 * Compatibility: older installs kept everything in the shared
 * `<dataHome>/managed-mcp.json`, keyed by `<tool>:project` (or the interim
 * `<tool>:project:<id>`). When this worktree has no per-worktree file yet, we lift
 * the records belonging to THIS worktree out of the shared file:
 *  - a bare `<tool>:project` key is claimed only when the data home is
 *    workspace-local (legacy `<workspaceRoot>/.teamai`), where it is unambiguous;
 *  - a `<tool>:project:<thisWorkspaceId>` key is always this worktree's.
 *
 * Migration is made DURABLE here, independent of the caller: we first atomically
 * write the per-worktree destination file, and only AFTER that succeeds do we
 * best-effort remove the claimed keys from the shared file. Persisting inside the
 * loader (rather than relying on the caller to save) is required because callers
 * may be read-only (report) or may skip their write when nothing changed
 * (`reconcile` with `wrote === false`) — removing the source first in those cases
 * would orphan the records. Ordering (destination first, source second) means a
 * crash between the two leaves the records readable in BOTH files, never neither.
 *
 * `dryRun` suppresses all writes (preview): the migrated records are returned in
 * memory but neither file is touched.
 *
 * Returns the per-worktree manifest path plus its loaded contents. Callers mutate
 * `manifest` and persist with `saveProjectMcpManifest`.
 */
export async function loadProjectMcpManifest(
  dataHome: string,
  workspaceRoot: string,
  options: { dryRun?: boolean } = {},
): Promise<{ manifestPath: string; manifest: ManagedMcpManifest }> {
  const manifestPath = managedMcpManifestPath(dataHome, workspaceRoot);
  const existing = (await readJson<ManagedMcpManifest>(expandHome(manifestPath))) ?? null;
  if (existing) return { manifestPath, manifest: existing };

  // No per-worktree file yet — attempt one-time migration from the shared file.
  const manifest: ManagedMcpManifest = {};
  const sharedPath = legacyManagedMcpManifestPath(dataHome);
  const workspaceLocal = dataHome === path.join(workspaceRoot, '.teamai');
  const shared = (await readJson<ManagedMcpManifest>(expandHome(sharedPath))) ?? null;
  if (shared) {
    const migratedFrom: string[] = [];
    for (const [key, records] of Object.entries(shared)) {
      if (!Array.isArray(records)) continue;
      if (claimsThisWorkspace(key, workspaceRoot, workspaceLocal)) {
        const tool = key.split(':')[0];
        manifest[`${tool}:project`] = records;
        migratedFrom.push(key);
      }
    }
    if (migratedFrom.length > 0 && !options.dryRun) {
      // Durable order: write the destination FIRST, then drop the claimed keys
      // from the shared file. A crash in between leaves the records in both files
      // (harmless — the per-worktree file wins), never in neither.
      await writeJsonAtomic(expandHome(manifestPath), manifest);
      for (const key of migratedFrom) delete shared[key];
      await writeJsonAtomic(expandHome(sharedPath), shared).catch(() => {});
    }
  }
  return { manifestPath, manifest };
}

/** True when a shared-file key belongs to this worktree (see loadProjectMcpManifest). */
function claimsThisWorkspace(key: string, workspaceRoot: string, workspaceLocal: boolean): boolean {
  const parts = key.split(':');
  if (parts.length === 2 && parts[1] === 'project') return workspaceLocal; // bare `<tool>:project`
  if (parts.length === 3 && parts[1] === 'project') {
    return parts[2] === managedMcpWorkspaceId(workspaceRoot); // interim `<tool>:project:<id>`
  }
  return false;
}

/** Persist a per-worktree project manifest (atomic), pruning empty ownership keys. */
export async function saveProjectMcpManifest(
  manifestPath: string,
  manifest: ManagedMcpManifest,
): Promise<void> {
  for (const [key, records] of Object.entries(manifest)) {
    if (!Array.isArray(records) || records.length === 0) delete manifest[key];
  }
  await writeJsonAtomic(expandHome(manifestPath), manifest);
}

export type { ManagedMcpRecord };
