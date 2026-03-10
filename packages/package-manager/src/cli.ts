import type { VFSInterface } from './types.js';
import { resolveDependencies } from './resolver.js';
import { fetchTarball } from './registry.js';
import { unpackTarball } from './unpacker.js';
import { generateLockfile, parseLockfile } from './lockfile.js';
import { runScript } from './scripts.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface CliOptions {
  vfs: VFSInterface;
  cwd: string;
  stdout: (data: string) => void;
  stderr: (data: string) => void;
  spawnFn?: (cmd: string, args: string[], opts: { cwd: string }) => Promise<number>;
}

export async function runCommand(
  args: string[],
  options: CliOptions
): Promise<number> {
  const command = args[0] ?? 'help';
  const restArgs = args.slice(1);

  switch (command) {
    case 'install':
    case 'i':
    case 'add':
      return npmInstall(restArgs, options);
    case 'uninstall':
    case 'remove':
    case 'rm':
      return npmUninstall(restArgs, options);
    case 'run':
    case 'run-script':
      return npmRun(restArgs, options);
    case 'start':
      return npmRun(['start'], options);
    case 'test':
      return npmRun(['test'], options);
    case 'init':
      return npmInit(options);
    case 'list':
    case 'ls':
      return npmList(options);
    default:
      // Check if it's a script name from package.json
      return npmRun([command, ...restArgs], options);
  }
}

async function npmInstall(args: string[], options: CliOptions): Promise<number> {
  const { vfs, cwd, stdout, stderr } = options;

  try {
    // Read package.json
    const pkgJsonPath = cwd + '/package.json';
    let pkgJson: any;

    try {
      const data = vfs.readFile(pkgJsonPath);
      pkgJson = JSON.parse(decoder.decode(data));
    } catch {
      stderr('npm ERR! No package.json found\n');
      return 1;
    }

    const saveDev = args.includes('--save-dev') || args.includes('-D');
    const save = args.includes('--save') || args.includes('-S') || (!saveDev && args.length === 0);

    // Filter out flags
    const packages = args.filter(a => !a.startsWith('-'));

    if (packages.length > 0) {
      // Install specific packages
      for (const pkg of packages) {
        const [name, version] = pkg.includes('@') && !pkg.startsWith('@')
          ? pkg.split('@')
          : [pkg, 'latest'];

        if (saveDev) {
          pkgJson.devDependencies = pkgJson.devDependencies ?? {};
          pkgJson.devDependencies[name] = version === 'latest' ? '^1.0.0' : `^${version}`;
        } else {
          pkgJson.dependencies = pkgJson.dependencies ?? {};
          pkgJson.dependencies[name] = version === 'latest' ? '^1.0.0' : `^${version}`;
        }
      }

      // Write updated package.json
      vfs.writeFile(pkgJsonPath, encoder.encode(JSON.stringify(pkgJson, null, 2)));
    }

    // Resolve all dependencies
    const allDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
    };

    if (Object.keys(allDeps).length === 0) {
      stdout('up to date, audited 0 packages\n');
      return 0;
    }

    stdout('Resolving dependencies...\n');

    // Check for lockfile
    let resolved: any[];
    const lockfilePath = cwd + '/package-lock.json';
    let hasLockfile = false;

    try {
      const lockData = vfs.readFile(lockfilePath);
      const lockfile = parseLockfile(decoder.decode(lockData));
      if (lockfile) {
        resolved = lockfile;
        hasLockfile = true;
        stdout('Installing from lockfile...\n');
      } else {
        resolved = await resolveDependencies(allDeps);
      }
    } catch {
      resolved = await resolveDependencies(allDeps);
    }

    // Create node_modules
    const nodeModulesPath = cwd + '/node_modules';
    if (!vfs.exists(nodeModulesPath)) {
      vfs.mkdir(nodeModulesPath);
    }

    // Install packages with concurrency limit
    const concurrency = 10;
    let installed = 0;

    for (let i = 0; i < resolved.length; i += concurrency) {
      const batch = resolved.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (pkg: any) => {
          try {
            const targetDir = nodeModulesPath + '/' + pkg.name;
            if (!vfs.exists(targetDir)) {
              vfs.mkdir(targetDir);
            }

            if (pkg.tarballUrl) {
              const tarballData = await fetchTarball(pkg.tarballUrl);
              if (tarballData) {
                await unpackTarball(tarballData, targetDir, vfs);
              }
            }

            installed++;
            stdout(`\rInstalled ${installed}/${resolved.length} packages`);
          } catch (e: any) {
            stderr(`npm WARN Failed to install ${pkg.name}: ${e.message}\n`);
          }
        })
      );
    }

    stdout('\n');

    // Generate lockfile
    if (!hasLockfile) {
      const lockfileContent = generateLockfile(pkgJson.name ?? '', pkgJson.version ?? '1.0.0', resolved);
      vfs.writeFile(lockfilePath, encoder.encode(lockfileContent));
    }

    // Create .bin directory with symlinks
    const binDir = nodeModulesPath + '/.bin';
    if (!vfs.exists(binDir)) {
      vfs.mkdir(binDir);
    }

    stdout(`added ${resolved.length} packages\n`);
    return 0;
  } catch (e: any) {
    stderr(`npm ERR! ${e.message}\n`);
    return 1;
  }
}

async function npmUninstall(args: string[], options: CliOptions): Promise<number> {
  const { vfs, cwd, stdout, stderr } = options;

  try {
    const pkgJsonPath = cwd + '/package.json';
    const data = vfs.readFile(pkgJsonPath);
    const pkgJson = JSON.parse(decoder.decode(data));

    for (const name of args.filter(a => !a.startsWith('-'))) {
      if (pkgJson.dependencies?.[name]) delete pkgJson.dependencies[name];
      if (pkgJson.devDependencies?.[name]) delete pkgJson.devDependencies[name];

      // Remove from node_modules
      const pkgDir = cwd + '/node_modules/' + name;
      if (vfs.exists(pkgDir)) {
        // Simple recursive delete
        vfs.rm(pkgDir);
      }

      stdout(`removed ${name}\n`);
    }

    vfs.writeFile(pkgJsonPath, encoder.encode(JSON.stringify(pkgJson, null, 2)));
    return 0;
  } catch (e: any) {
    stderr(`npm ERR! ${e.message}\n`);
    return 1;
  }
}

async function npmRun(args: string[], options: CliOptions): Promise<number> {
  const { vfs, cwd, stdout, stderr, spawnFn } = options;
  const scriptName = args[0];

  if (!scriptName) {
    // List available scripts
    try {
      const pkgJsonPath = cwd + '/package.json';
      const data = vfs.readFile(pkgJsonPath);
      const pkgJson = JSON.parse(decoder.decode(data));
      const scripts = pkgJson.scripts ?? {};

      stdout('Available scripts:\n');
      for (const [name, cmd] of Object.entries(scripts)) {
        stdout(`  ${name}: ${cmd}\n`);
      }
      return 0;
    } catch {
      stderr('npm ERR! No package.json found\n');
      return 1;
    }
  }

  try {
    const pkgJsonPath = cwd + '/package.json';
    const data = vfs.readFile(pkgJsonPath);
    const pkgJson = JSON.parse(decoder.decode(data));
    const scripts = pkgJson.scripts ?? {};

    const script = scripts[scriptName];
    if (!script) {
      stderr(`npm ERR! Missing script: "${scriptName}"\n`);
      return 1;
    }

    stdout(`> ${pkgJson.name}@${pkgJson.version} ${scriptName}\n`);
    stdout(`> ${script}\n\n`);

    if (spawnFn) {
      return await runScript(scriptName, script, cwd, spawnFn);
    }

    return 0;
  } catch (e: any) {
    stderr(`npm ERR! ${e.message}\n`);
    return 1;
  }
}

async function npmInit(options: CliOptions): Promise<number> {
  const { vfs, cwd, stdout } = options;

  const pkgJson = {
    name: 'my-project',
    version: '1.0.0',
    description: '',
    main: 'index.js',
    scripts: {
      test: 'echo "Error: no test specified" && exit 1',
    },
    keywords: [],
    author: '',
    license: 'ISC',
  };

  vfs.writeFile(cwd + '/package.json', encoder.encode(JSON.stringify(pkgJson, null, 2)));
  stdout('Wrote to package.json\n');
  return 0;
}

async function npmList(options: CliOptions): Promise<number> {
  const { vfs, cwd, stdout, stderr } = options;

  try {
    const pkgJsonPath = cwd + '/package.json';
    const data = vfs.readFile(pkgJsonPath);
    const pkgJson = JSON.parse(decoder.decode(data));

    stdout(`${pkgJson.name}@${pkgJson.version}\n`);

    const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      stdout(`├── ${name}@${version}\n`);
    }

    return 0;
  } catch (e: any) {
    stderr(`npm ERR! ${e.message}\n`);
    return 1;
  }
}
