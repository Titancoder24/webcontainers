const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Module cache
const moduleCache = new Map<string, any>();

// Built-in module map
const builtinMap: Record<string, () => any> = {};

export function registerBuiltin(name: string, factory: () => any): void {
  builtinMap[name] = factory;
}

// Resolve a module specifier to an absolute path
function resolveFile(path: string, extensions: string[], readFileSync: (p: string) => Uint8Array | null): string | null {
  // Try exact path
  if (readFileSync(path) !== null) return path;

  // Try with extensions
  for (const ext of extensions) {
    if (readFileSync(path + ext) !== null) return path + ext;
  }

  // Try as directory (index files)
  for (const ext of extensions) {
    if (readFileSync(path + '/index' + ext) !== null) return path + '/index' + ext;
  }

  return null;
}

function resolvePackageExports(
  exports: any,
  conditions: string[]
): string | null {
  if (typeof exports === 'string') return exports;

  if (typeof exports === 'object' && exports !== null) {
    // Check '.' entry for main export
    if ('.' in exports) {
      return resolvePackageExports(exports['.'], conditions);
    }

    // Check conditions
    for (const condition of conditions) {
      if (condition in exports) {
        return resolvePackageExports(exports[condition], conditions);
      }
    }

    // Check 'default' last
    if ('default' in exports) {
      return resolvePackageExports(exports['default'], conditions);
    }
  }

  return null;
}

function resolvePackageMain(
  packageDir: string,
  readFileSync: (p: string) => Uint8Array | null
): string | null {
  const pkgJsonPath = packageDir + '/package.json';
  const pkgData = readFileSync(pkgJsonPath);
  if (!pkgData) return null;

  try {
    const pkg = JSON.parse(decoder.decode(pkgData));

    // Check exports field first
    if (pkg.exports) {
      const resolved = resolvePackageExports(pkg.exports, ['require', 'node', 'default']);
      if (resolved) {
        return packageDir + '/' + resolved.replace(/^\.\//, '');
      }
    }

    // Check main field
    if (pkg.main) {
      const mainPath = packageDir + '/' + pkg.main;
      const resolved = resolveFile(mainPath, ['.js', '.json', '.node'], readFileSync);
      if (resolved) return resolved;
    }

    // Fallback to index.js
    return resolveFile(packageDir + '/index', ['.js', '.json'], readFileSync);
  } catch {
    return null;
  }
}

function resolveNodeModules(
  specifier: string,
  fromDir: string,
  readFileSync: (p: string) => Uint8Array | null
): string | null {
  const parts = fromDir.split('/');

  for (let i = parts.length; i >= 1; i--) {
    const dir = parts.slice(0, i).join('/');
    if (dir.endsWith('/node_modules')) continue;

    const nodeModulesDir = dir + '/node_modules';
    const packageDir = nodeModulesDir + '/' + specifier;

    // Try as package
    const packageMain = resolvePackageMain(packageDir, readFileSync);
    if (packageMain) return packageMain;

    // Try as file
    const resolved = resolveFile(packageDir, ['.js', '.json', '.node'], readFileSync);
    if (resolved) return resolved;
  }

  return null;
}

export function createRequire(
  filename: string,
  readFileSync: (path: string) => Uint8Array | null,
  existsSync?: (path: string) => boolean
): (specifier: string) => any {
  const dirname = filename.substring(0, filename.lastIndexOf('/')) || '/';

  function require(specifier: string): any {
    // Check built-in modules
    if (builtinMap[specifier]) {
      return builtinMap[specifier]();
    }

    // Also check without 'node:' prefix
    const stripped = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    if (builtinMap[stripped]) {
      return builtinMap[stripped]();
    }

    // Resolve path
    let resolvedPath: string | null = null;

    if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
      // Relative or absolute path
      const basePath = specifier.startsWith('/')
        ? specifier
        : normalizePath(dirname + '/' + specifier);
      resolvedPath = resolveFile(basePath, ['.js', '.json', '.node'], readFileSync);
    } else {
      // node_modules resolution
      resolvedPath = resolveNodeModules(specifier, dirname, readFileSync);
    }

    if (!resolvedPath) {
      const err = new Error(`Cannot find module '${specifier}' from '${dirname}'`) as any;
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    // Check cache
    if (moduleCache.has(resolvedPath)) {
      return moduleCache.get(resolvedPath).exports;
    }

    // Read the file
    const fileData = readFileSync(resolvedPath);
    if (!fileData) {
      const err = new Error(`Cannot find module '${resolvedPath}'`) as any;
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    const source = decoder.decode(fileData);
    const fileDir = resolvedPath.substring(0, resolvedPath.lastIndexOf('/')) || '/';

    // Handle JSON files
    if (resolvedPath.endsWith('.json')) {
      const parsed = JSON.parse(source);
      moduleCache.set(resolvedPath, { exports: parsed });
      return parsed;
    }

    // Create module object
    const module = { exports: {} as any, id: resolvedPath, filename: resolvedPath, loaded: false };
    moduleCache.set(resolvedPath, module);

    // Create child require
    const childRequire = createRequire(resolvedPath, readFileSync, existsSync);

    // Wrap and execute
    const wrapper = `(function(exports, require, module, __filename, __dirname) {\n${source}\n});`;

    try {
      const fn = (0, eval)(wrapper);
      fn(module.exports, childRequire, module, resolvedPath, fileDir);
    } catch (e) {
      moduleCache.delete(resolvedPath);
      throw e;
    }

    module.loaded = true;
    return module.exports;
  }

  require.resolve = (specifier: string): string => {
    if (builtinMap[specifier]) return specifier;

    let resolvedPath: string | null = null;

    if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
      const basePath = specifier.startsWith('/')
        ? specifier
        : normalizePath(dirname + '/' + specifier);
      resolvedPath = resolveFile(basePath, ['.js', '.json', '.node'], readFileSync);
    } else {
      resolvedPath = resolveNodeModules(specifier, dirname, readFileSync);
    }

    if (!resolvedPath) {
      const err = new Error(`Cannot find module '${specifier}'`) as any;
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    return resolvedPath;
  };

  require.cache = Object.fromEntries(moduleCache);
  require.main = undefined;

  return require;
}

function normalizePath(path: string): string {
  const parts = path.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') { resolved.pop(); continue; }
    resolved.push(part);
  }
  return '/' + resolved.join('/');
}

export function clearModuleCache(): void {
  moduleCache.clear();
}

export default { createRequire, registerBuiltin, clearModuleCache };
