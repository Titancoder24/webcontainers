/**
 * Lockfile handling for package-lock.json (v2/v3 format).
 * Provides deterministic, reproducible installations by caching the exact
 * resolved version and tarball URL for every dependency.
 */

import type { ResolvedPackage } from './resolver.js';

/** Package-lock.json v3 top-level structure */
export interface Lockfile {
  name: string;
  version: string;
  lockfileVersion: 3;
  requires: boolean;
  packages: Record<string, LockfileEntry>;
}

export interface LockfileEntry {
  version: string;
  resolved: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
  engines?: Record<string, string>;
  optional?: boolean;
  dev?: boolean;
}

/**
 * Parse a package-lock.json content string.
 * Supports lockfileVersion 2 and 3.
 */
export function parseLockfile(content: string): Lockfile {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    throw new LockfileError(`Failed to parse lockfile: ${(err as Error).message}`);
  }

  const lockfileVersion = data.lockfileVersion as number;
  if (lockfileVersion !== 2 && lockfileVersion !== 3) {
    throw new LockfileError(
      `Unsupported lockfile version: ${lockfileVersion}. Only v2 and v3 are supported.`,
    );
  }

  const packages = (data.packages ?? {}) as Record<string, LockfileEntry>;

  // Normalize v2 format: v2 stores packages with "node_modules/" prefix and
  // also has a top-level "dependencies" field. We only use the "packages" field.
  // v3 is the same but without the legacy "dependencies" field.

  return {
    name: (data.name as string) ?? '',
    version: (data.version as string) ?? '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages,
  };
}

/**
 * Generate a package-lock.json (v3) from a list of resolved packages.
 */
export function generateLockfile(
  projectName: string,
  projectVersion: string,
  resolvedPackages: ResolvedPackage[],
  projectDependencies?: Record<string, string>,
  projectDevDependencies?: Record<string, string>,
): string {
  const packages: Record<string, LockfileEntry> = {};

  // Root package entry (empty string key)
  const rootEntry: LockfileEntry = {
    version: projectVersion,
    resolved: '',
  };
  if (projectDependencies && Object.keys(projectDependencies).length > 0) {
    rootEntry.dependencies = projectDependencies;
  }
  if (projectDevDependencies && Object.keys(projectDevDependencies).length > 0) {
    rootEntry.devDependencies = projectDevDependencies;
  }
  packages[''] = rootEntry;

  // Add each resolved package
  for (const pkg of resolvedPackages) {
    const entry: LockfileEntry = {
      version: pkg.version,
      resolved: pkg.tarballUrl,
    };

    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      entry.dependencies = pkg.dependencies;
    }

    if (pkg.bin) {
      entry.bin = pkg.bin;
    }

    packages[pkg.path] = entry;
  }

  // Sort packages by key for deterministic output
  const sortedPackages: Record<string, LockfileEntry> = {};
  const sortedKeys = Object.keys(packages).sort();
  for (const key of sortedKeys) {
    sortedPackages[key] = packages[key];
  }

  const lockfile: Lockfile = {
    name: projectName,
    version: projectVersion,
    lockfileVersion: 3,
    requires: true,
    packages: sortedPackages,
  };

  return JSON.stringify(lockfile, null, 2) + '\n';
}

/**
 * Extract resolved packages from a lockfile for use in installation.
 * This allows skipping resolution when a lockfile is present.
 */
export function lockfileToResolvedPackages(lockfile: Lockfile): ResolvedPackage[] {
  const result: ResolvedPackage[] = [];

  for (const [path, entry] of Object.entries(lockfile.packages)) {
    // Skip root entry
    if (path === '') continue;

    // Extract package name from path
    // "node_modules/@scope/pkg" -> "@scope/pkg"
    // "node_modules/foo/node_modules/bar" -> "bar"
    const name = extractPackageName(path);
    if (!name) continue;

    result.push({
      name,
      version: entry.version,
      tarballUrl: entry.resolved,
      path,
      dependencies: entry.dependencies ?? {},
      bin: entry.bin,
    });
  }

  return result;
}

/**
 * Check if a lockfile is still valid for a given set of dependencies.
 * Returns true if every dependency in the map has a matching entry in the lockfile.
 */
export function isLockfileValid(
  lockfile: Lockfile,
  dependencies: Record<string, string>,
): boolean {
  for (const [name, _range] of Object.entries(dependencies)) {
    const lockPath = `node_modules/${name}`;
    const entry = lockfile.packages[lockPath];
    if (!entry) return false;
    // We could check semver satisfaction here, but for simplicity
    // we trust the lockfile if the entry exists
  }
  return true;
}

/**
 * Extract package name from a node_modules path.
 */
function extractPackageName(path: string): string | null {
  // Find the last "node_modules/" segment
  const nmIndex = path.lastIndexOf('node_modules/');
  if (nmIndex < 0) return null;

  const afterNm = path.slice(nmIndex + 'node_modules/'.length);

  // Handle scoped packages (@scope/name)
  if (afterNm.startsWith('@')) {
    const slashIndex = afterNm.indexOf('/', 1);
    if (slashIndex < 0) return afterNm;
    const secondSlash = afterNm.indexOf('/', slashIndex + 1);
    if (secondSlash < 0) return afterNm;
    return afterNm.slice(0, secondSlash);
  }

  // Regular package
  const slashIndex = afterNm.indexOf('/');
  if (slashIndex < 0) return afterNm;
  return afterNm.slice(0, slashIndex);
}

export class LockfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockfileError';
  }
}
