/**
 * @aspect/package-manager
 *
 * Browser-based npm/pnpm emulator for WebContainers.
 * Provides dependency resolution, tarball fetching/unpacking, lockfile management,
 * lifecycle scripts, and a full CLI interface.
 */

// Core types
export type { VFS, PackageManagerOptions, SpawnFunction } from './types.js';

// Semver utilities
export {
  parse as semverParse,
  satisfies as semverSatisfies,
  compare as semverCompare,
  maxSatisfying as semverMaxSatisfying,
} from './semver.js';
export type { SemVer } from './semver.js';

// Registry client
export { RegistryClient, PackageNotFoundError, RegistryError } from './registry.js';
export type { PackageMetadata, PackageVersionMetadata } from './registry.js';

// Dependency resolver
export { DependencyResolver, ResolverError } from './resolver.js';
export type { ResolvedPackage } from './resolver.js';

// Tarball unpacker
export { unpackTarball, unpackTarballStream } from './unpacker.js';

// Lockfile handling
export {
  parseLockfile,
  generateLockfile,
  lockfileToResolvedPackages,
  isLockfileValid,
  LockfileError,
} from './lockfile.js';
export type { Lockfile, LockfileEntry } from './lockfile.js';

// Script runner
export {
  runScript,
  runInstallScripts,
  listScripts,
  ScriptError,
  ScriptTimeoutError,
} from './scripts.js';
export type { PackageJson, SpawnFn, SpawnResult } from './scripts.js';

// CLI
export { runCommand } from './cli.js';
