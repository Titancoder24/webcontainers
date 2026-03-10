/**
 * npm CLI emulator.
 * Implements install, uninstall, run, start, test, init, list, and npx commands.
 */

import { RegistryClient } from './registry.js';
import { DependencyResolver } from './resolver.js';
import type { ResolvedPackage } from './resolver.js';
import { unpackTarball } from './unpacker.js';
import {
  parseLockfile,
  generateLockfile,
  lockfileToResolvedPackages,
  isLockfileValid,
} from './lockfile.js';
import { runScript, runInstallScripts, listScripts } from './scripts.js';
import type { PackageJson, SpawnFn } from './scripts.js';
import type { VFS, PackageManagerOptions, SpawnFunction } from './types.js';

/** Maximum concurrent tarball fetches */
const MAX_CONCURRENCY = 10;

interface Logger {
  log(msg: string): void;
  error(msg: string): void;
  warn(msg: string): void;
}

function createLogger(options: PackageManagerOptions): Logger {
  const write = (stream: PackageManagerOptions['stdout'], msg: string) => {
    if (!stream) return;
    if ('write' in stream && typeof stream.write === 'function') {
      stream.write(msg + '\n');
    }
  };
  return {
    log: (msg: string) => write(options.stdout, msg),
    error: (msg: string) => write(options.stderr ?? options.stdout, msg),
    warn: (msg: string) => write(options.stderr ?? options.stdout, `WARN: ${msg}`),
  };
}

/**
 * Main CLI entry point. Parses arguments and dispatches to the appropriate command.
 *
 * @returns Exit code (0 for success, non-zero for failure)
 */
export async function runCommand(
  args: string[],
  options: PackageManagerOptions,
): Promise<number> {
  const log = createLogger(options);

  if (args.length === 0) {
    log.error('Usage: npm <command> [options]');
    return 1;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  try {
    switch (command) {
      case 'install':
      case 'i':
      case 'add':
        return await commandInstall(restArgs, options, log);

      case 'uninstall':
      case 'remove':
      case 'rm':
        return await commandUninstall(restArgs, options, log);

      case 'run':
        return await commandRun(restArgs, options, log);

      case 'start':
        return await commandRun(['start'], options, log);

      case 'test':
      case 't':
        return await commandRun(['test'], options, log);

      case 'init':
        return await commandInit(restArgs, options, log);

      case 'list':
      case 'ls':
        return await commandList(restArgs, options, log);

      case 'npx':
      case 'exec':
        return await commandNpx(restArgs, options, log);

      case 'run-script':
        return await commandRun(restArgs, options, log);

      default:
        // Check if it could be a script name (npm <script>)
        try {
          const pkg = readPackageJson(options.vfs, options.cwd);
          if (pkg.scripts?.[command]) {
            return await commandRun([command], options, log);
          }
        } catch {
          // ignore
        }
        log.error(`Unknown command: ${command}`);
        return 1;
    }
  } catch (err) {
    log.error(`Error: ${(err as Error).message}`);
    return 1;
  }
}

/**
 * Install command: resolve, fetch, and unpack dependencies.
 */
async function commandInstall(
  args: string[],
  options: PackageManagerOptions,
  log: Logger,
): Promise<number> {
  const { vfs, cwd } = options;
  const flags = parseFlags(args);
  const packageNames = flags.positional;

  const pkg = readPackageJson(vfs, cwd);

  // If specific packages were given, add them to package.json
  if (packageNames.length > 0) {
    const registry = new RegistryClient({
      registryUrl: options.registryUrl,
      cdnUrl: options.cdnUrl,
    });

    for (const spec of packageNames) {
      const { name, range } = parsePackageSpec(spec);
      const metadata = await registry.fetchMetadata(name);

      // Determine the version to use
      let resolvedRange = range;
      if (!resolvedRange) {
        const latest = metadata['dist-tags']['latest'];
        resolvedRange = latest ? `^${latest}` : '*';
      }

      if (flags.saveDev) {
        pkg.devDependencies = pkg.devDependencies ?? {};
        pkg.devDependencies[name] = resolvedRange;
      } else {
        pkg.dependencies = pkg.dependencies ?? {};
        pkg.dependencies[name] = resolvedRange;
      }
    }

    // Write updated package.json
    writePackageJson(vfs, cwd, pkg);
  }

  const dependencies = pkg.dependencies ?? {};
  const devDependencies = pkg.devDependencies ?? {};
  const allDeps = { ...dependencies, ...devDependencies };

  if (Object.keys(allDeps).length === 0) {
    log.log('No dependencies to install.');
    return 0;
  }

  // Check for lockfile
  let resolvedPackages: ResolvedPackage[];
  const lockfilePath = `${cwd}/package-lock.json`;

  if (packageNames.length === 0 && vfs.exists(lockfilePath)) {
    try {
      const lockfileContent = vfs.readFile(lockfilePath, 'utf-8') as string;
      const lockfile = parseLockfile(lockfileContent);

      if (isLockfileValid(lockfile, allDeps)) {
        log.log('Using lockfile for installation...');
        resolvedPackages = lockfileToResolvedPackages(lockfile);
      } else {
        log.log('Lockfile is stale, resolving dependencies...');
        resolvedPackages = await resolveAll(allDeps, options, log);
      }
    } catch {
      log.warn('Failed to parse lockfile, resolving dependencies...');
      resolvedPackages = await resolveAll(allDeps, options, log);
    }
  } else {
    resolvedPackages = await resolveAll(allDeps, options, log);
  }

  log.log(`Installing ${resolvedPackages.length} packages...`);

  // Ensure node_modules directory
  const nodeModulesPath = `${cwd}/node_modules`;
  if (!vfs.exists(nodeModulesPath)) {
    vfs.mkdir(nodeModulesPath, { recursive: true });
  }

  // Fetch and unpack tarballs with concurrency limit
  const registry = new RegistryClient({
    registryUrl: options.registryUrl,
    cdnUrl: options.cdnUrl,
  });

  await parallelMap(resolvedPackages, MAX_CONCURRENCY, async (resolvedPkg) => {
    const targetPath = `${cwd}/${resolvedPkg.path}`;

    // Skip if already installed at the correct version
    const pkgJsonPath = `${targetPath}/package.json`;
    if (vfs.exists(pkgJsonPath)) {
      try {
        const existing = JSON.parse(
          vfs.readFile(pkgJsonPath, 'utf-8') as string,
        ) as PackageJson;
        if (existing.version === resolvedPkg.version) {
          return; // Already installed
        }
      } catch {
        // Re-install if we can't read existing package.json
      }
    }

    log.log(`  ${resolvedPkg.name}@${resolvedPkg.version}`);

    try {
      const tarball = await registry.fetchTarball(
        resolvedPkg.name,
        resolvedPkg.version,
        resolvedPkg.tarballUrl,
      );

      // Ensure parent directory exists
      if (!vfs.exists(targetPath)) {
        vfs.mkdir(targetPath, { recursive: true });
      }

      await unpackTarball(tarball, targetPath, vfs);
    } catch (err) {
      log.error(`  Failed to install ${resolvedPkg.name}@${resolvedPkg.version}: ${(err as Error).message}`);
    }
  });

  // Create .bin symlinks
  createBinLinks(vfs, cwd, resolvedPackages);

  // Generate lockfile
  const lockfileContent = generateLockfile(
    pkg.name ?? '',
    pkg.version ?? '0.0.0',
    resolvedPackages,
    pkg.dependencies,
    pkg.devDependencies,
  );
  vfs.writeFile(lockfilePath, lockfileContent);

  // Run install lifecycle scripts for packages that have them
  if (options.spawn) {
    const spawnFn = wrapSpawnFn(options.spawn);
    for (const resolvedPkg of resolvedPackages) {
      const pkgPath = `${cwd}/${resolvedPkg.path}`;
      const pkgJsonPath = `${pkgPath}/package.json`;
      if (!vfs.exists(pkgJsonPath)) continue;

      try {
        const pkgJson = JSON.parse(
          vfs.readFile(pkgJsonPath, 'utf-8') as string,
        ) as PackageJson;
        if (pkgJson.scripts?.postinstall || pkgJson.scripts?.install) {
          await runInstallScripts(pkgJson, pkgPath, spawnFn, {
            env: options.env,
          });
        }
      } catch {
        // Install script failures are non-fatal
      }
    }
  }

  log.log(`Done. Installed ${resolvedPackages.length} packages.`);
  return 0;
}

/**
 * Uninstall command: remove packages from node_modules and package.json.
 */
async function commandUninstall(
  args: string[],
  options: PackageManagerOptions,
  log: Logger,
): Promise<number> {
  const { vfs, cwd } = options;
  const flags = parseFlags(args);
  const packageNames = flags.positional;

  if (packageNames.length === 0) {
    log.error('Must specify at least one package to uninstall.');
    return 1;
  }

  const pkg = readPackageJson(vfs, cwd);

  for (const name of packageNames) {
    // Remove from dependencies and devDependencies
    if (pkg.dependencies) {
      delete pkg.dependencies[name];
    }
    if (pkg.devDependencies) {
      delete pkg.devDependencies[name];
    }

    // Remove from node_modules
    const pkgPath = `${cwd}/node_modules/${name}`;
    if (vfs.exists(pkgPath)) {
      if (vfs.rm) {
        vfs.rm(pkgPath, { recursive: true, force: true });
      } else {
        // Fallback: just unlink the directory (won't work for non-empty dirs)
        try {
          vfs.unlink(pkgPath);
        } catch {
          log.warn(`Could not remove ${pkgPath}`);
        }
      }
    }

    log.log(`Removed ${name}`);
  }

  // Write updated package.json
  writePackageJson(vfs, cwd, pkg);

  return 0;
}

/**
 * Run command: execute a script from package.json.
 */
async function commandRun(
  args: string[],
  options: PackageManagerOptions,
  log: Logger,
): Promise<number> {
  const { vfs, cwd } = options;

  if (args.length === 0) {
    // List available scripts
    const pkg = readPackageJson(vfs, cwd);
    const scripts = listScripts(pkg);
    if (scripts.length === 0) {
      log.log('No scripts defined.');
    } else {
      log.log('Available scripts:');
      for (const s of scripts) {
        log.log(`  ${s.name}: ${s.command}`);
      }
    }
    return 0;
  }

  const scriptName = args[0];

  if (!options.spawn) {
    log.error('Cannot run scripts: no spawn function provided.');
    return 1;
  }

  const pkg = readPackageJson(vfs, cwd);
  const spawnFn = wrapSpawnFn(options.spawn);

  // Build PATH that includes node_modules/.bin
  const binPath = `${cwd}/node_modules/.bin`;
  const env = {
    ...options.env,
    PATH: options.env?.PATH ? `${binPath}:${options.env.PATH}` : binPath,
  };

  const exitCode = await runScript(scriptName, pkg, cwd, spawnFn, {
    env,
  });

  return exitCode;
}

/**
 * Init command: create a new package.json.
 */
async function commandInit(
  _args: string[],
  options: PackageManagerOptions,
  log: Logger,
): Promise<number> {
  const { vfs, cwd } = options;
  const pkgJsonPath = `${cwd}/package.json`;

  if (vfs.exists(pkgJsonPath)) {
    log.warn('package.json already exists.');
    return 0;
  }

  // Extract directory name for package name
  const parts = cwd.split('/');
  const dirName = parts[parts.length - 1] || 'my-project';

  const newPkg: PackageJson = {
    name: dirName,
    version: '1.0.0',
    scripts: {
      test: 'echo "Error: no test specified" && exit 1',
    },
  };

  vfs.writeFile(pkgJsonPath, JSON.stringify(newPkg, null, 2) + '\n');
  log.log(`Created ${pkgJsonPath}`);

  return 0;
}

/**
 * List command: show installed packages.
 */
async function commandList(
  _args: string[],
  options: PackageManagerOptions,
  log: Logger,
): Promise<number> {
  const { vfs, cwd } = options;
  const nodeModulesPath = `${cwd}/node_modules`;

  if (!vfs.exists(nodeModulesPath)) {
    log.log('No packages installed.');
    return 0;
  }

  const entries = vfs.readdir(nodeModulesPath) as string[];
  const packages: Array<{ name: string; version: string }> = [];

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;

    if (entry.startsWith('@')) {
      // Scoped packages
      const scopePath = `${nodeModulesPath}/${entry}`;
      const scopeEntries = vfs.readdir(scopePath) as string[];
      for (const scopeEntry of scopeEntries) {
        const pkgJsonPath = `${scopePath}/${scopeEntry}/package.json`;
        if (vfs.exists(pkgJsonPath)) {
          try {
            const scopedPkg = JSON.parse(
              vfs.readFile(pkgJsonPath, 'utf-8') as string,
            ) as PackageJson;
            packages.push({
              name: `${entry}/${scopeEntry}`,
              version: scopedPkg.version ?? 'unknown',
            });
          } catch {
            packages.push({ name: `${entry}/${scopeEntry}`, version: 'unknown' });
          }
        }
      }
    } else {
      const pkgJsonPath = `${nodeModulesPath}/${entry}/package.json`;
      if (vfs.exists(pkgJsonPath)) {
        try {
          const entryPkg = JSON.parse(
            vfs.readFile(pkgJsonPath, 'utf-8') as string,
          ) as PackageJson;
          packages.push({ name: entry, version: entryPkg.version ?? 'unknown' });
        } catch {
          packages.push({ name: entry, version: 'unknown' });
        }
      }
    }
  }

  if (packages.length === 0) {
    log.log('No packages installed.');
  } else {
    for (const p of packages.sort((a, b) => a.name.localeCompare(b.name))) {
      log.log(`${p.name}@${p.version}`);
    }
  }

  return 0;
}

/**
 * npx/exec command: run a package binary, installing if necessary.
 */
async function commandNpx(
  args: string[],
  options: PackageManagerOptions,
  log: Logger,
): Promise<number> {
  if (args.length === 0) {
    log.error('Usage: npx <package> [args...]');
    return 1;
  }

  const { vfs, cwd } = options;
  const packageSpec = args[0];
  const commandArgs = args.slice(1);
  const { name } = parsePackageSpec(packageSpec);

  if (!options.spawn) {
    log.error('Cannot run npx: no spawn function provided.');
    return 1;
  }

  // Check if the package is already installed locally
  const binPath = `${cwd}/node_modules/.bin`;
  const shortName = name.includes('/') ? name.split('/')[1] : name;

  let binExists = false;
  if (vfs.exists(`${binPath}/${shortName}`)) {
    binExists = true;
  }

  // Install the package if not found
  if (!binExists) {
    log.log(`Installing ${name}...`);
    const installResult = await commandInstall(
      [packageSpec],
      options,
      log,
    );
    if (installResult !== 0) {
      return installResult;
    }
  }

  // Find the bin entry
  const pkgPath = `${cwd}/node_modules/${name}`;
  const pkgJsonPath = `${pkgPath}/package.json`;

  if (!vfs.exists(pkgJsonPath)) {
    log.error(`Package ${name} not found after installation.`);
    return 1;
  }

  const installedPkg = JSON.parse(
    vfs.readFile(pkgJsonPath, 'utf-8') as string,
  ) as PackageJson;

  let binFile: string | undefined;
  if (typeof installedPkg.bin === 'string') {
    binFile = `${pkgPath}/${installedPkg.bin}`;
  } else if (typeof installedPkg.bin === 'object' && installedPkg.bin !== null) {
    binFile = installedPkg.bin[shortName]
      ? `${pkgPath}/${installedPkg.bin[shortName]}`
      : Object.values(installedPkg.bin)[0]
        ? `${pkgPath}/${Object.values(installedPkg.bin)[0]}`
        : undefined;
  }

  if (!binFile) {
    // Fall back to main
    binFile = installedPkg.main ? `${pkgPath}/${installedPkg.main}` : `${pkgPath}/index.js`;
  }

  const spawnFn = options.spawn;
  const env = {
    ...options.env,
    PATH: options.env?.PATH ? `${binPath}:${options.env.PATH}` : binPath,
  };

  const result = spawnFn('node', [binFile, ...commandArgs], {
    cwd,
    env,
    stdio: 'inherit',
  });

  const exitCode = result.exitCode;
  return exitCode instanceof Promise ? await exitCode : exitCode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve all dependencies through the resolver.
 */
async function resolveAll(
  dependencies: Record<string, string>,
  options: PackageManagerOptions,
  log: Logger,
): Promise<ResolvedPackage[]> {
  log.log('Resolving dependencies...');
  const registry = new RegistryClient({
    registryUrl: options.registryUrl,
    cdnUrl: options.cdnUrl,
  });
  const resolver = new DependencyResolver(registry);
  return resolver.resolve(dependencies);
}

/**
 * Create .bin symlinks for packages that declare bin entries.
 */
function createBinLinks(
  vfs: VFS,
  cwd: string,
  packages: ResolvedPackage[],
): void {
  const binDir = `${cwd}/node_modules/.bin`;
  if (!vfs.exists(binDir)) {
    vfs.mkdir(binDir, { recursive: true });
  }

  for (const resolvedPkg of packages) {
    if (!resolvedPkg.bin) continue;

    const pkgPath = `${cwd}/${resolvedPkg.path}`;

    if (typeof resolvedPkg.bin === 'string') {
      const binName = resolvedPkg.name.includes('/')
        ? resolvedPkg.name.split('/')[1]
        : resolvedPkg.name;
      const target = `${pkgPath}/${resolvedPkg.bin}`;
      const linkPath = `${binDir}/${binName}`;
      try {
        if (vfs.exists(linkPath)) vfs.unlink(linkPath);
        vfs.symlink(target, linkPath);
      } catch {
        // Symlink creation may fail; non-fatal
      }
    } else if (typeof resolvedPkg.bin === 'object') {
      for (const [binName, binFilePath] of Object.entries(resolvedPkg.bin)) {
        const target = `${pkgPath}/${binFilePath}`;
        const linkPath = `${binDir}/${binName}`;
        try {
          if (vfs.exists(linkPath)) vfs.unlink(linkPath);
          vfs.symlink(target, linkPath);
        } catch {
          // Non-fatal
        }
      }
    }
  }
}

/**
 * Read package.json from the given directory.
 */
function readPackageJson(vfs: VFS, cwd: string): PackageJson {
  const pkgJsonPath = `${cwd}/package.json`;
  if (!vfs.exists(pkgJsonPath)) {
    throw new Error(`No package.json found in ${cwd}`);
  }
  const content = vfs.readFile(pkgJsonPath, 'utf-8') as string;
  return JSON.parse(content) as PackageJson;
}

/**
 * Write package.json to the given directory.
 */
function writePackageJson(vfs: VFS, cwd: string, pkg: PackageJson): void {
  const pkgJsonPath = `${cwd}/package.json`;
  vfs.writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * Parse a package specifier like "lodash", "lodash@^4.0.0", "@scope/pkg@1.0.0"
 */
function parsePackageSpec(spec: string): { name: string; range?: string } {
  // Handle scoped packages
  if (spec.startsWith('@')) {
    const atIndex = spec.indexOf('@', 1);
    if (atIndex > 0) {
      return {
        name: spec.slice(0, atIndex),
        range: spec.slice(atIndex + 1),
      };
    }
    return { name: spec };
  }

  const atIndex = spec.indexOf('@');
  if (atIndex > 0) {
    return {
      name: spec.slice(0, atIndex),
      range: spec.slice(atIndex + 1),
    };
  }

  return { name: spec };
}

interface ParsedFlags {
  positional: string[];
  save: boolean;
  saveDev: boolean;
  saveOptional: boolean;
  global: boolean;
  production: boolean;
}

/**
 * Parse CLI flags from argument list.
 */
function parseFlags(args: string[]): ParsedFlags {
  const result: ParsedFlags = {
    positional: [],
    save: true, // --save is the default in modern npm
    saveDev: false,
    saveOptional: false,
    global: false,
    production: false,
  };

  for (const arg of args) {
    if (arg === '--save' || arg === '-S') {
      result.save = true;
    } else if (arg === '--save-dev' || arg === '-D') {
      result.saveDev = true;
      result.save = false;
    } else if (arg === '--save-optional' || arg === '-O') {
      result.saveOptional = true;
    } else if (arg === '--global' || arg === '-g') {
      result.global = true;
    } else if (arg === '--production') {
      result.production = true;
    } else if (!arg.startsWith('-')) {
      result.positional.push(arg);
    }
  }

  return result;
}

/**
 * Wrap a SpawnFunction to match the SpawnFn interface expected by scripts.ts.
 */
function wrapSpawnFn(spawn: SpawnFunction): SpawnFn {
  return (command, args, options) => spawn(command, args, options);
}

/**
 * Execute async tasks in parallel with a concurrency limit.
 */
async function parallelMap<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const results: Promise<void>[] = [];

  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      await fn(items[currentIndex]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  for (let i = 0; i < workerCount; i++) {
    results.push(worker());
  }

  await Promise.all(results);
}
