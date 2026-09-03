import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { readFileSafe, writeFile } from '../utils/fs.js';
import {
  PackageLockSchema,
  PackageManifestSchema,
  type PackageLock,
  type PackageManifest,
} from './types.js';

export const PACKAGE_MANIFEST_FILENAME = 'teamai.yaml';
export const PACKAGE_LOCK_FILENAME = 'teamai.lock';

export function packageManifestPath(repoPath: string): string {
  return path.join(repoPath, PACKAGE_MANIFEST_FILENAME);
}

export function packageLockPath(cwd: string): string {
  return path.join(cwd, PACKAGE_LOCK_FILENAME);
}

export async function ensurePackageLockIgnored(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, '.gitignore');
  const content = await readFileSafe(gitignorePath);
  if (content?.split('\n').some((line) => line.trim() === PACKAGE_LOCK_FILENAME)) return;
  const prefix = content && !content.endsWith('\n') ? `${content}\n` : (content ?? '');
  await writeFile(gitignorePath, `${prefix}${PACKAGE_LOCK_FILENAME}\n`);
}

function parseYamlObject(content: string, filePath: string): Record<string, unknown> {
  const raw = YAML.parse(content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${filePath} must contain a YAML object`);
  }
  return raw as Record<string, unknown>;
}

export async function loadPackageManifest(repoPath: string): Promise<PackageManifest> {
  const filePath = packageManifestPath(repoPath);
  const content = await readFileSafe(filePath);
  if (content === null) {
    throw new Error(`Package manifest not found: ${filePath}`);
  }
  const raw = parseYamlObject(content, filePath);
  return PackageManifestSchema.parse({
    name: typeof raw.name === 'string'
      ? raw.name
      : typeof raw.team === 'string'
        ? raw.team
        : '',
    packages: raw.packages ?? {},
  });
}

/**
 * Update only the packages key and preserve every existing team configuration
 * key. TeamaiConfigSchema and package declarations intentionally have separate
 * loaders so either side can evolve without stripping the other.
 */
export async function savePackageManifest(
  repoPath: string,
  manifest: PackageManifest,
): Promise<void> {
  const filePath = packageManifestPath(repoPath);
  const content = await readFileSafe(filePath);
  const raw = content === null ? {} : parseYamlObject(content, filePath);
  raw.packages = manifest.packages;
  if (!raw.name && !raw.team && manifest.name) raw.name = manifest.name;
  await writeFile(filePath, YAML.stringify(raw));
}

export async function loadPackageLock(cwd: string): Promise<PackageLock | null> {
  const content = await readFileSafe(packageLockPath(cwd));
  if (content === null) return null;
  try {
    return PackageLockSchema.parse(YAML.parse(content));
  } catch {
    return null;
  }
}

export async function savePackageLock(cwd: string, lock: PackageLock): Promise<void> {
  await writeFile(packageLockPath(cwd), YAML.stringify(PackageLockSchema.parse(lock)));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function packageDeclarationHash(manifest: PackageManifest): string {
  return packageSetHash(manifest.packages);
}

function packageSetHash(packages: PackageManifest['packages']): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(packages)))
    .digest('hex');
}

/** Hash declarations whose installation is shared across user-scope projects. */
export function sharedPackageDeclarationHash(manifest: PackageManifest): string {
  const npm = manifest.packages.npm?.filter((spec) => spec.global);
  return packageSetHash({
    ...(npm && npm.length > 0 ? { npm } : {}),
    ...(manifest.packages.claude ? { claude: manifest.packages.claude } : {}),
  });
}

/** Hash npm dependencies installed into the current project rather than the machine. */
export function projectNpmDeclarationHash(manifest: PackageManifest): string | null {
  const npm = manifest.packages.npm?.filter((spec) => !spec.global) ?? [];
  return npm.length > 0 ? packageSetHash({ npm }) : null;
}

/** Do not persist absolute project paths in the local lockfile. */
export function packageProjectKey(cwd: string): string {
  let normalized = path.resolve(cwd);
  try {
    normalized = fs.realpathSync.native(normalized);
  } catch {
    // The install path check will report a missing cwd/package.json separately.
  }
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

export function hasPackageDeclarations(manifest: PackageManifest): boolean {
  return (manifest.packages.npm?.length ?? 0) > 0
    || (manifest.packages.claude?.marketplaces.length ?? 0) > 0
    || (manifest.packages.claude?.plugins.length ?? 0) > 0;
}
