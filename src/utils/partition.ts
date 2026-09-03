import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { getUserHome } from './home.js';

/**
 * Per-project data partition identity (issue #374 P1).
 *
 * teamai keys a project's machine-local data by the SHARED `projectAnchor` (the
 * main checkout, so every linked worktree resolves to the same partition), NOT
 * the per-worktree workspace root. The partition lives at
 * `~/.teamai/projects/<slug>/`, entirely outside the business workspace.
 *
 * slug(anchor) = <safe-basename>-<sha256(normalized anchor) first 8 hex>
 *
 * The hash — not a raw path escape — is what guarantees uniqueness: escaping
 * separators is not injective (`/x/my-proj` and `/x/my/proj` would collide), and
 * the hash also avoids leaking the full home-directory structure into the
 * directory name. The human-readable basename is a convenience prefix only;
 * collisions between two projects with the same basename are broken by the hash.
 */

let caseInsensitiveCache: boolean | null = null;

/**
 * Detect at runtime whether the filesystem holding `~/.teamai` is
 * case-insensitive (macOS APFS/HFS+ default, Windows NTFS) vs case-sensitive
 * (Linux ext4). We must probe rather than assume: on a case-insensitive FS,
 * `CaseTest` and `casetest` are the same directory, so the two spellings must
 * hash to the SAME slug; on a case-sensitive FS they are genuinely distinct and
 * lowercasing would wrongly merge two different projects.
 *
 * `realpath` does NOT solve this — on macOS it returns the on-disk spelling
 * as-is for either input (verified in the issue), so normalization must be an
 * explicit lowercase gated on this probe.
 *
 * Result is cached for the process. On any probe error we fall back to
 * case-sensitive (no lowercasing) — the conservative choice: it never merges
 * two distinct anchors, at worst it keeps two spellings of one anchor separate.
 */
export function isCaseInsensitiveFs(probeDir?: string): boolean {
  if (caseInsensitiveCache !== null) return caseInsensitiveCache;
  const base = probeDir ?? path.join(getUserHome(), '.teamai');
  try {
    fs.mkdirSync(base, { recursive: true });
    const token = `.teamai-case-probe-${process.pid}-${Date.now()}`;
    const upper = path.join(base, token.toUpperCase());
    const lower = path.join(base, token.toLowerCase());
    fs.writeFileSync(upper, '');
    // If the lowercased path resolves to the file we wrote under the uppercased
    // name, the FS folds case → case-insensitive.
    const insensitive = fs.existsSync(lower);
    fs.rmSync(upper, { force: true });
    caseInsensitiveCache = insensitive;
  } catch {
    caseInsensitiveCache = false;
  }
  return caseInsensitiveCache;
}

/** Test-only: reset the cached case-sensitivity probe. */
export function resetCaseProbeCache(): void {
  caseInsensitiveCache = null;
}

/**
 * Normalize an anchor path for hashing. The anchor is already realpath-resolved
 * by `resolveAnchors` (symlinks + macOS /tmp→/private/tmp). Here we only apply
 * case-folding when the FS is case-insensitive, so different spellings of one
 * directory map to one partition.
 */
function normalizeAnchor(anchor: string): string {
  return isCaseInsensitiveFs() ? anchor.toLowerCase() : anchor;
}

/** Filesystem-safe, length-bounded basename for the human-readable slug prefix. */
function safeBasename(anchor: string): string {
  const raw = path.basename(anchor) || 'project';
  const cleaned = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  // Bound the prefix; the hash carries uniqueness so truncation is safe.
  const bounded = (cleaned || 'project').slice(0, 40);
  return bounded;
}

/** `<safe-basename>-<sha256(normalized anchor)[:8]>` — stable per projectAnchor. */
export function projectSlug(anchor: string): string {
  // Normalize once so BOTH the basename prefix and the hash are derived from the
  // same canonical spelling — on a case-insensitive FS this makes the whole slug
  // string identical for any spelling of one directory (the dir would fold to a
  // single partition anyway; folding the string keeps callers consistent too).
  const norm = normalizeAnchor(anchor);
  const hash = createHash('sha256').update(norm).digest('hex').slice(0, 8);
  return `${safeBasename(norm)}-${hash}`;
}

/**
 * Absolute path of a project's machine-data partition:
 * `~/.teamai/projects/<slug(anchor)>`. `anchor` MUST be the shared projectAnchor
 * (the main checkout), so all worktrees of one repo share the partition.
 */
export function projectDataHome(anchor: string): string {
  return path.join(getUserHome(), '.teamai', 'projects', projectSlug(anchor));
}
