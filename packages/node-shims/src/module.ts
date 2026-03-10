/**
 * Module system shim - require() function and module resolution.
 * This is the CRITICAL piece that enables CommonJS compatibility in WebContainers.
 */

import { SyscallType } from '@aspect/shared';
import * as pathModule from './path.js';

type SyscallFn = (type: SyscallType, args: Record<string, unknown>) => unknown;

function getSyscall(): SyscallFn {
  const g = globalThis as unknown as { __syscall?: SyscallFn };
  if (!g.__syscall) {
    throw new Error('No syscall bridge available. Module loading requires a WebContainer runtime.');
  }
  return g.__syscall;
}

// --- Builtin modules list ---
export const builtinModules: string[] = [
  'assert', 'buffer', 'child_process', 'console', 'crypto', 'events',
  'fs', 'http', 'module', 'net', 'os', 'path', 'querystring',
  'readline', 'stream', 'string_decoder', 'timers', 'tty', 'url',
  'util', 'zlib',
];

// --- Module cache ---
const moduleCache = new Map<string, Module>();

// --- Module class ---
export class Module {
  id: string;
  filename: string;
  dirname: string;
  exports: unknown;
  parent: Module | null;
  loaded: boolean;
  children: Module[];
  paths: string[];

  static _cache = moduleCache;
  static _extensions: Record<string, (module: Module, filename: string) => void> = {};
  static builtinModules = builtinModules;

  constructor(id: string, parent?: Module | null) {
    this.id = id;
    this.filename = id;
    this.dirname = pathModule.dirname(id);
    this.exports = {};
    this.parent = parent || null;
    this.loaded = false;
    this.children = [];
    this.paths = Module._nodeModulePaths(this.dirname);
  }

  require(specifier: string): unknown {
    return Module._require(specifier, this);
  }

  static _nodeModulePaths(from: string): string[] {
    const parts = from.split('/').filter(Boolean);
    const paths: string[] = [];

    for (let i = parts.length; i >= 0; i--) {
      const dir = '/' + parts.slice(0, i).join('/');
      if (parts[i - 1] !== 'node_modules') {
        paths.push(pathModule.join(dir, 'node_modules'));
      }
    }

    return paths;
  }

  static _resolveFilename(request: string, parent?: Module | null): string {
    // Check builtins
    const cleanName = request.startsWith('node:') ? request.slice(5) : request;
    if (builtinModules.includes(cleanName)) {
      return cleanName;
    }

    const syscall = getSyscall();

    // Absolute paths
    if (request.startsWith('/')) {
      const resolved = _tryResolveFile(syscall, request);
      if (resolved) return resolved;
      throw _makeNotFoundError(request, parent);
    }

    // Relative paths
    if (request.startsWith('./') || request.startsWith('../')) {
      const base = parent ? pathModule.dirname(parent.filename) : '/';
      const absolute = pathModule.resolve(base, request);
      const resolved = _tryResolveFile(syscall, absolute);
      if (resolved) return resolved;
      throw _makeNotFoundError(request, parent);
    }

    // Node modules resolution
    const startDir = parent ? pathModule.dirname(parent.filename) : '/';
    const dirs = Module._nodeModulePaths(startDir);

    for (const dir of dirs) {
      const candidate = pathModule.join(dir, request);
      const resolved = _tryResolveFile(syscall, candidate);
      if (resolved) return resolved;
    }

    throw _makeNotFoundError(request, parent);
  }

  static _require(request: string, parent?: Module | null): unknown {
    const cleanName = request.startsWith('node:') ? request.slice(5) : request;

    // Check builtin cache
    if (builtinModules.includes(cleanName)) {
      return _loadBuiltin(cleanName);
    }

    const filename = Module._resolveFilename(request, parent);

    // Check builtin again (resolveFilename returns clean name for builtins)
    if (builtinModules.includes(filename)) {
      return _loadBuiltin(filename);
    }

    // Check module cache
    const cached = moduleCache.get(filename);
    if (cached) {
      return cached.exports;
    }

    // Create new module
    const module = new Module(filename, parent);
    moduleCache.set(filename, module);

    if (parent) {
      parent.children.push(module);
    }

    // Load the module
    try {
      Module._load(module, filename);
      module.loaded = true;
    } catch (err) {
      moduleCache.delete(filename);
      throw err;
    }

    return module.exports;
  }

  static _load(module: Module, filename: string): void {
    const ext = pathModule.extname(filename);
    const loader = Module._extensions[ext] || Module._extensions['.js'];

    if (loader) {
      loader(module, filename);
    } else {
      // Default: treat as JS
      Module._extensions['.js']!(module, filename);
    }
  }

  static _wrap(content: string): string {
    return `(function(exports, require, module, __filename, __dirname) { ${content}\n});`;
  }
}

// --- Extension handlers ---

Module._extensions['.js'] = function (module: Module, filename: string): void {
  const content = _readFileAsString(filename);
  _compileAndRun(module, content, filename);
};

Module._extensions['.json'] = function (module: Module, filename: string): void {
  const content = _readFileAsString(filename);
  try {
    module.exports = JSON.parse(content);
  } catch (e) {
    const err = e as Error;
    throw new SyntaxError(`Error parsing ${filename}: ${err.message}`);
  }
};

Module._extensions['.node'] = function (_module: Module, filename: string): void {
  throw new Error(`Native .node modules are not supported in WebContainers: ${filename}`);
};

// --- Internal helpers ---

function _readFileAsString(filename: string): string {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_READFILE, { path: filename }) as { data: Uint8Array } | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error(`Cannot find module '${filename}'`);
  }

  const data = (result as { data: Uint8Array }).data;
  return new TextDecoder().decode(data);
}

function _compileAndRun(module: Module, content: string, filename: string): void {
  // Strip BOM
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  // Strip hashbang
  if (content.startsWith('#!')) {
    const newlineIdx = content.indexOf('\n');
    if (newlineIdx !== -1) {
      content = content.slice(newlineIdx + 1);
    } else {
      content = '';
    }
  }

  const dirname = pathModule.dirname(filename);

  const requireFn = function require(specifier: string): unknown {
    return Module._require(specifier, module);
  };
  requireFn.resolve = function resolve(specifier: string): string {
    return Module._resolveFilename(specifier, module);
  };
  requireFn.cache = moduleCache;
  requireFn.main = _getMainModule();

  const wrappedContent = Module._wrap(content);

  // Use indirect eval to avoid strict mode issues
  const compiledFn = (0, eval)(wrappedContent);
  compiledFn.call(
    module.exports,
    module.exports,
    requireFn,
    module,
    filename,
    dirname
  );
}

function _tryResolveFile(syscall: SyscallFn, filepath: string): string | null {
  // Try exact path
  if (_fileExists(syscall, filepath)) {
    const stat = _statFile(syscall, filepath);
    if (stat === 'file') return filepath;
    if (stat === 'directory') {
      // Try package.json in directory
      const pkgResult = _tryPackageJson(syscall, filepath);
      if (pkgResult) return pkgResult;

      // Try index files
      return _tryIndexFiles(syscall, filepath);
    }
  }

  // Try with extensions
  const extensions = ['.js', '.json', '.node'];
  for (const ext of extensions) {
    if (_fileExists(syscall, filepath + ext)) {
      const stat = _statFile(syscall, filepath + ext);
      if (stat === 'file') return filepath + ext;
    }
  }

  // Try as directory (the path might not exist as-is but might with /index.js)
  const pkgResult = _tryPackageJson(syscall, filepath);
  if (pkgResult) return pkgResult;

  return _tryIndexFiles(syscall, filepath);
}

function _tryPackageJson(syscall: SyscallFn, dirpath: string): string | null {
  const pkgPath = pathModule.join(dirpath, 'package.json');
  if (!_fileExists(syscall, pkgPath)) return null;

  try {
    const content = new TextDecoder().decode(
      ((syscall(SyscallType.FS_READFILE, { path: pkgPath }) as { data: Uint8Array }).data)
    );
    const pkg = JSON.parse(content);

    // Try exports field first
    if (pkg.exports) {
      const resolved = _resolveExports(syscall, dirpath, pkg.exports, ['.', 'require', 'default']);
      if (resolved) return resolved;
    }

    // Try main field
    if (typeof pkg.main === 'string') {
      const mainPath = pathModule.resolve(dirpath, pkg.main);
      if (_fileExists(syscall, mainPath)) {
        const stat = _statFile(syscall, mainPath);
        if (stat === 'file') return mainPath;
      }
      // Try with extensions
      for (const ext of ['.js', '.json']) {
        if (_fileExists(syscall, mainPath + ext)) return mainPath + ext;
      }
      // Try as directory
      const indexResult = _tryIndexFiles(syscall, mainPath);
      if (indexResult) return indexResult;
    }
  } catch {
    // Invalid package.json, skip
  }

  return null;
}

function _resolveExports(
  syscall: SyscallFn,
  basePath: string,
  exports: unknown,
  conditions: string[]
): string | null {
  if (typeof exports === 'string') {
    const resolved = pathModule.resolve(basePath, exports);
    if (_fileExists(syscall, resolved)) return resolved;
    return null;
  }

  if (typeof exports === 'object' && exports !== null && !Array.isArray(exports)) {
    const exp = exports as Record<string, unknown>;

    // Check if this is a conditions object or a subpath map
    const keys = Object.keys(exp);

    // If it has a '.' key, it's a subpath map - resolve '.' entry
    if ('.' in exp) {
      return _resolveExports(syscall, basePath, exp['.'], conditions);
    }

    // Otherwise check conditions
    for (const condition of conditions) {
      if (condition in exp) {
        return _resolveExports(syscall, basePath, exp[condition], conditions);
      }
    }

    // Try 'default' condition as last resort
    if ('default' in exp) {
      return _resolveExports(syscall, basePath, exp['default'], conditions);
    }
  }

  if (Array.isArray(exports)) {
    for (const item of exports) {
      const result = _resolveExports(syscall, basePath, item, conditions);
      if (result) return result;
    }
  }

  return null;
}

function _tryIndexFiles(syscall: SyscallFn, dirpath: string): string | null {
  const indexFiles = ['index.js', 'index.json'];
  for (const name of indexFiles) {
    const candidate = pathModule.join(dirpath, name);
    if (_fileExists(syscall, candidate)) {
      return candidate;
    }
  }
  return null;
}

function _fileExists(syscall: SyscallFn, filepath: string): boolean {
  const result = syscall(SyscallType.FS_EXISTS, { path: filepath }) as { exists: boolean };
  return result.exists;
}

function _statFile(syscall: SyscallFn, filepath: string): 'file' | 'directory' | 'other' {
  try {
    const result = syscall(SyscallType.FS_STAT, { path: filepath }) as { isFile?: () => boolean; isDirectory?: () => boolean; type?: string };
    if (typeof result.isFile === 'function') {
      if (result.isFile()) return 'file';
      if (result.isDirectory?.()) return 'directory';
    }
    if (result.type === 'file') return 'file';
    if (result.type === 'directory') return 'directory';
    return 'other';
  } catch {
    return 'other';
  }
}

function _makeNotFoundError(request: string, parent?: Module | null): Error {
  const parentPath = parent ? parent.filename : '';
  const err = new Error(`Cannot find module '${request}'${parentPath ? ` from '${parentPath}'` : ''}`) as Error & { code: string };
  err.code = 'MODULE_NOT_FOUND';
  return err;
}

// Builtin module loading
let builtinCache: Map<string, unknown> | null = null;

function _loadBuiltin(name: string): unknown {
  if (!builtinCache) {
    builtinCache = new Map();
  }

  const cached = builtinCache.get(name);
  if (cached) return cached;

  // The builtin modules are provided by the index.ts builtinModules map
  const g = globalThis as unknown as { __builtinModules?: Record<string, unknown> };
  if (g.__builtinModules && g.__builtinModules[name]) {
    const mod = g.__builtinModules[name];
    builtinCache.set(name, mod);
    return mod;
  }

  throw new Error(`Cannot find builtin module '${name}'`);
}

function _getMainModule(): Module | undefined {
  const g = globalThis as unknown as { __mainModule?: Module };
  return g.__mainModule;
}

/**
 * createRequire - creates a require function from a given filename.
 */
export function createRequire(filename: string): RequireFunction {
  const parent = new Module(filename);

  const requireFn = function require(specifier: string): unknown {
    return Module._require(specifier, parent);
  } as RequireFunction;

  const resolveFn = function resolve(specifier: string): string {
    return Module._resolveFilename(specifier, parent);
  } as RequireFunction['resolve'];
  resolveFn.paths = function paths(specifier: string): string[] | null {
    if (builtinModules.includes(specifier)) return null;
    return Module._nodeModulePaths(pathModule.dirname(filename));
  };
  requireFn.resolve = resolveFn;

  requireFn.cache = Object.fromEntries(moduleCache);
  requireFn.main = _getMainModule();

  return requireFn;
}

interface RequireFunction {
  (specifier: string): unknown;
  resolve: {
    (specifier: string): string;
    paths: (specifier: string) => string[] | null;
  };
  cache: Record<string, Module>;
  main: Module | undefined;
}

export function isBuiltin(moduleName: string): boolean {
  const name = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
  return builtinModules.includes(name);
}

export default {
  Module,
  builtinModules,
  createRequire,
  isBuiltin,
};
