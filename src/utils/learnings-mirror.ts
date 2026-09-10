import path from 'node:path';
import fse from 'fs-extra';
import { ensureDir, listDirs, listFiles, listFilesRecursive, pathExists, remove } from './fs.js';

function visibleMarkdownFiles(files: string[]): string[] {
  return files.filter((file) =>
    file.endsWith('.md') && file.split('/').every((segment) => !segment.startsWith('.')),
  );
}

/**
 * Reconcile the machine-local learnings cache with the selected repo content.
 * Root-level Markdown files are shared; only active namespace directories are
 * mirrored. The destination is a generated cache, so upstream deletions must
 * remove the corresponding cached learning before the search index is rebuilt.
 */
export async function mirrorLearnings(
  sourceDir: string,
  destinationDir: string,
  activeNamespaces: string[],
): Promise<void> {
  const sourceIsDirectory = await pathExists(sourceDir)
    && (await fse.stat(sourceDir)).isDirectory();
  const sourceRootFiles = new Set(
    sourceIsDirectory
      ? (await listFiles(sourceDir)).filter((file) => file.endsWith('.md') && !file.startsWith('.'))
      : [],
  );
  const sourceNamespaces = new Set(sourceIsDirectory ? await listDirs(sourceDir) : []);
  const selectedNamespaces = new Set(
    activeNamespaces.filter((namespace) =>
      !namespace.startsWith('.') && sourceNamespaces.has(namespace),
    ),
  );

  await ensureDir(destinationDir);

  // Root Markdown files are owned by the mirror. Leave unrelated root files
  // alone, but remove shared learnings that no longer exist upstream.
  for (const file of await listFiles(destinationDir)) {
    if (file.endsWith('.md') && !file.startsWith('.') && !sourceRootFiles.has(file)) {
      await remove(path.join(destinationDir, file));
    }
  }

  // Namespace directories are also mirror-owned. This removes both namespaces
  // that became inactive and active namespaces deleted from the repo.
  for (const namespace of await listDirs(destinationDir)) {
    if (!selectedNamespaces.has(namespace)) {
      await remove(path.join(destinationDir, namespace));
    }
  }

  // An active namespace can remain selected while individual learnings are
  // deleted upstream. Reconcile those files before the overwrite copy.
  for (const namespace of selectedNamespaces) {
    const sourceNamespaceDir = path.join(sourceDir, namespace);
    const destinationNamespaceDir = path.join(destinationDir, namespace);
    if (!await pathExists(destinationNamespaceDir)) continue;

    const sourceFiles = new Set(visibleMarkdownFiles(await listFilesRecursive(sourceNamespaceDir)));
    for (const file of visibleMarkdownFiles(await listFilesRecursive(destinationNamespaceDir))) {
      if (!sourceFiles.has(file)) {
        await remove(path.join(destinationNamespaceDir, file));
      }
    }
  }

  if (!sourceIsDirectory) return;

  await fse.copy(sourceDir, destinationDir, {
    overwrite: true,
    filter: (src: string) => {
      if (path.basename(src).startsWith('.')) return false;
      const relative = path.relative(sourceDir, src);
      if (relative === '') return true;
      const topLevel = relative.split(path.sep)[0];
      return relative.includes(path.sep)
        ? selectedNamespaces.has(topLevel)
        : sourceRootFiles.has(topLevel) || selectedNamespaces.has(topLevel);
    },
  });
}
