import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkspacePackage {
  readonly name: string;
  /** Repository-relative directory; '.' for the repository root. */
  readonly directory: string;
  readonly manifestPath: string;
}

/**
 * Discovers workspace packages from tracked `package.json` manifests, using
 * the repository's real manifest content rather than treating files
 * independently.
 */
export function discoverWorkspacePackages(
  rootDirectory: string,
  trackedPaths: readonly string[],
): readonly WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const path of trackedPaths) {
    if (path !== 'package.json' && !path.endsWith('/package.json')) continue;
    let name: unknown;
    try {
      name = (
        JSON.parse(readFileSync(join(rootDirectory, path), 'utf8')) as {
          name?: unknown;
        }
      ).name;
    } catch {
      continue;
    }
    if (typeof name !== 'string' || name.length === 0) continue;
    packages.push({
      name,
      directory: path === 'package.json' ? '.' : path.slice(0, -13),
      manifestPath: path,
    });
  }
  return packages.sort((left, right) =>
    left.directory.localeCompare(right.directory),
  );
}

/** The owning package directory for a path: the longest matching prefix. */
export function packageDirectoryOf(
  path: string,
  directories: readonly string[],
): string | undefined {
  let owner: string | undefined;
  for (const directory of directories) {
    if (directory === '.') {
      owner ??= '.';
      continue;
    }
    if (
      path.startsWith(`${directory}/`) &&
      (owner === undefined || owner === '.' || directory.length > owner.length)
    ) {
      owner = directory;
    }
  }
  return owner;
}
