export { runCommand } from './cli.js';
export type { CliOptions } from './cli.js';
export { resolveDependencies } from './resolver.js';
export { fetchMetadata, fetchTarball } from './registry.js';
export { unpackTarball } from './unpacker.js';
export { parseLockfile, generateLockfile } from './lockfile.js';
export { runScript } from './scripts.js';
export { parse as parseSemver, satisfies, maxSatisfying, compare } from './semver.js';
export type { VFSInterface } from './types.js';
