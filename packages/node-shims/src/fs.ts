/**
 * Filesystem shim delegating to syscall bridge.
 */

import { SyscallType } from '@aspect/shared';
import type { VFSStats, Dirent } from '@aspect/shared';
import { Buffer } from './buffer.js';

type SyscallFn = (type: SyscallType, args: Record<string, unknown>) => unknown;

function getSyscall(): SyscallFn {
  const g = globalThis as unknown as { __syscall?: SyscallFn };
  if (!g.__syscall) {
    throw new Error('No syscall bridge available. fs operations require a WebContainer runtime.');
  }
  return g.__syscall;
}

function makeFSError(code: string, syscall: string, path?: string): Error & { code: string; errno: number; syscall: string; path?: string } {
  const messages: Record<string, string> = {
    ENOENT: 'no such file or directory',
    EEXIST: 'file already exists',
    ENOTDIR: 'not a directory',
    EISDIR: 'illegal operation on a directory',
    EACCES: 'permission denied',
    ENOTEMPTY: 'directory not empty',
    EPERM: 'operation not permitted',
    EBADF: 'bad file descriptor',
  };
  const msg = `${code}: ${messages[code] || 'unknown error'}, ${syscall} '${path ?? ''}'`;
  const err = new Error(msg) as Error & { code: string; errno: number; syscall: string; path?: string };
  err.code = code;
  err.errno = -1;
  err.syscall = syscall;
  if (path) err.path = path;
  return err;
}

// --- Sync functions ---

export function readFileSync(filePath: string, options?: { encoding?: string; flag?: string } | string): Buffer | string {
  const syscall = getSyscall();
  const encoding = typeof options === 'string' ? options : options?.encoding;

  const result = syscall(SyscallType.FS_READFILE, { path: filePath }) as { data: Uint8Array } | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw makeFSError((result as { error: string }).error, 'read', filePath);
  }

  const data = (result as { data: Uint8Array }).data;
  const buf = Buffer.from(data);

  if (encoding) {
    return buf.toString(encoding);
  }
  return buf;
}

export function writeFileSync(filePath: string, data: string | Buffer | Uint8Array, options?: { encoding?: string; mode?: number; flag?: string } | string): void {
  const syscall = getSyscall();
  const encoding = typeof options === 'string' ? options : options?.encoding;

  let content: Uint8Array;
  if (typeof data === 'string') {
    content = Buffer.from(data, encoding || 'utf8');
  } else {
    content = data;
  }

  const result = syscall(SyscallType.FS_WRITEFILE, { path: filePath, data: content }) as { error?: string } | undefined;
  if (result && typeof result === 'object' && 'error' in result) {
    throw makeFSError(result.error!, 'write', filePath);
  }
}

export function appendFileSync(filePath: string, data: string | Buffer | Uint8Array, options?: { encoding?: string; mode?: number } | string): void {
  const syscall = getSyscall();
  const encoding = typeof options === 'string' ? options : options?.encoding;

  let content: Uint8Array;
  if (typeof data === 'string') {
    content = Buffer.from(data, encoding || 'utf8');
  } else {
    content = data;
  }

  const result = syscall(SyscallType.FS_APPENDFILE, { path: filePath, data: content }) as { error?: string } | undefined;
  if (result && typeof result === 'object' && 'error' in result) {
    throw makeFSError(result.error!, 'appendfile', filePath);
  }
}

export function statSync(filePath: string): VFSStats {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_STAT, { path: filePath }) as VFSStats | { error: string };

  if (result && typeof result === 'object' && 'error' in result && typeof (result as { error: string }).error === 'string') {
    throw makeFSError((result as { error: string }).error, 'stat', filePath);
  }

  return result as VFSStats;
}

export function lstatSync(filePath: string): VFSStats {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_LSTAT, { path: filePath }) as VFSStats | { error: string };

  if (result && typeof result === 'object' && 'error' in result && typeof (result as { error: string }).error === 'string') {
    throw makeFSError((result as { error: string }).error, 'lstat', filePath);
  }

  return result as VFSStats;
}

export function readdirSync(dirPath: string, options?: { encoding?: string; withFileTypes?: boolean }): string[] | Dirent[] {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_READDIR, { path: dirPath, withFileTypes: options?.withFileTypes }) as { entries: string[] | Dirent[] } | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw makeFSError((result as { error: string }).error, 'readdir', dirPath);
  }

  return (result as { entries: string[] | Dirent[] }).entries;
}

export function mkdirSync(dirPath: string, options?: { recursive?: boolean; mode?: number } | number): string | undefined {
  const syscall = getSyscall();
  const recursive = typeof options === 'object' ? options?.recursive : false;

  const result = syscall(SyscallType.FS_MKDIR, { path: dirPath, recursive }) as { error?: string; created?: string } | undefined;

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw makeFSError(result.error, 'mkdir', dirPath);
  }

  return recursive ? (result as { created?: string })?.created : undefined;
}

export function rmdirSync(dirPath: string, options?: { recursive?: boolean }): void {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_RMDIR, { path: dirPath, recursive: options?.recursive }) as { error?: string } | undefined;

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw makeFSError(result.error, 'rmdir', dirPath);
  }
}

export function unlinkSync(filePath: string): void {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_UNLINK, { path: filePath }) as { error?: string } | undefined;

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw makeFSError(result.error, 'unlink', filePath);
  }
}

export function renameSync(oldPath: string, newPath: string): void {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_RENAME, { oldPath, newPath }) as { error?: string } | undefined;

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw makeFSError(result.error, 'rename', oldPath);
  }
}

export function symlinkSync(target: string, linkPath: string, _type?: string): void {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_SYMLINK, { target, path: linkPath }) as { error?: string } | undefined;

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw makeFSError(result.error, 'symlink', linkPath);
  }
}

export function readlinkSync(filePath: string): string {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_READLINK, { path: filePath }) as { target: string } | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw makeFSError((result as { error: string }).error, 'readlink', filePath);
  }

  return (result as { target: string }).target;
}

export function chmodSync(filePath: string, mode: number): void {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_CHMOD, { path: filePath, mode }) as { error?: string } | undefined;

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw makeFSError(result.error, 'chmod', filePath);
  }
}

export function accessSync(filePath: string, mode?: number): void {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_ACCESS, { path: filePath, mode: mode ?? 0 }) as { error?: string } | undefined;

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw makeFSError(result.error, 'access', filePath);
  }
}

export function existsSync(filePath: string): boolean {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_EXISTS, { path: filePath }) as { exists: boolean };
  return result.exists;
}

export function realpathSync(filePath: string): string {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_REALPATH, { path: filePath }) as { resolved: string } | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw makeFSError((result as { error: string }).error, 'realpath', filePath);
  }

  return (result as { resolved: string }).resolved;
}

export function mkdtempSync(prefix: string): string {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_MKDTEMP, { prefix }) as { path: string } | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw makeFSError((result as { error: string }).error, 'mkdtemp', prefix);
  }

  return (result as { path: string }).path;
}

export function copyFileSync(src: string, dest: string, flags?: number): void {
  const syscall = getSyscall();
  const result = syscall(SyscallType.FS_COPYFILE, { src, dest, flags: flags ?? 0 }) as { error?: string } | undefined;

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw makeFSError(result.error, 'copyfile', src);
  }
}

// --- Async wrappers ---

export function readFile(filePath: string, options?: { encoding?: string; flag?: string } | string): Promise<Buffer | string>;
export function readFile(filePath: string, options: { encoding?: string; flag?: string } | string | undefined, callback: (err: Error | null, data?: Buffer | string) => void): void;
export function readFile(filePath: string, optionsOrCallback?: unknown, callback?: (err: Error | null, data?: Buffer | string) => void): void | Promise<Buffer | string> {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback as (err: Error | null, data?: Buffer | string) => void : callback;
  const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback as { encoding?: string } | string;

  if (cb) {
    try {
      const result = readFileSync(filePath, options as { encoding?: string });
      queueMicrotask(() => cb(null, result));
    } catch (err) {
      queueMicrotask(() => cb(err as Error));
    }
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      resolve(readFileSync(filePath, options as { encoding?: string }));
    } catch (err) {
      reject(err);
    }
  });
}

export function writeFile(filePath: string, data: string | Buffer | Uint8Array, options?: { encoding?: string } | string): Promise<void>;
export function writeFile(filePath: string, data: string | Buffer | Uint8Array, callback: (err: Error | null) => void): void;
export function writeFile(filePath: string, data: string | Buffer | Uint8Array, optionsOrCallback?: unknown, callback?: (err: Error | null) => void): void | Promise<void> {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback as (err: Error | null) => void : callback;
  const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback as { encoding?: string } | string;

  if (cb) {
    try {
      writeFileSync(filePath, data, options as { encoding?: string });
      queueMicrotask(() => cb(null));
    } catch (err) {
      queueMicrotask(() => cb(err as Error));
    }
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      writeFileSync(filePath, data, options as { encoding?: string });
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function wrapAsync<T>(fn: (...args: unknown[]) => T) {
  return (...args: unknown[]): Promise<T> => {
    return new Promise((resolve, reject) => {
      try {
        resolve(fn(...args));
      } catch (err) {
        reject(err);
      }
    });
  };
}

export const stat = wrapAsync(statSync);
export const lstat = wrapAsync(lstatSync);
export const readdir = wrapAsync(readdirSync);
export const mkdir = wrapAsync(mkdirSync);
export const rmdir = wrapAsync(rmdirSync);
export const unlink = wrapAsync(unlinkSync);
export const rename = (oldPath: string, newPath: string) =>
  new Promise<void>((resolve, reject) => {
    try { renameSync(oldPath, newPath); resolve(); } catch (err) { reject(err); }
  });
export const symlink = (target: string, linkPath: string, type?: string) =>
  new Promise<void>((resolve, reject) => {
    try { symlinkSync(target, linkPath, type); resolve(); } catch (err) { reject(err); }
  });
export const readlink = wrapAsync(readlinkSync);
export const chmod = (filePath: string, mode: number) =>
  new Promise<void>((resolve, reject) => {
    try { chmodSync(filePath, mode); resolve(); } catch (err) { reject(err); }
  });
export const access = (filePath: string, mode?: number) =>
  new Promise<void>((resolve, reject) => {
    try { accessSync(filePath, mode); resolve(); } catch (err) { reject(err); }
  });
export const realpath = wrapAsync(realpathSync);
export const mkdtemp = wrapAsync(mkdtempSync);
export const appendFile = (filePath: string, data: string | Buffer | Uint8Array, options?: { encoding?: string } | string) =>
  new Promise<void>((resolve, reject) => {
    try { appendFileSync(filePath, data, options); resolve(); } catch (err) { reject(err); }
  });
export const copyFile = (src: string, dest: string, flags?: number) =>
  new Promise<void>((resolve, reject) => {
    try { copyFileSync(src, dest, flags); resolve(); } catch (err) { reject(err); }
  });

// --- Constants ---
export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  COPYFILE_EXCL: 1,
  COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE_FORCE: 4,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_APPEND: 1024,
};

// --- fs.promises ---
export const promises = {
  readFile: (filePath: string, options?: { encoding?: string } | string) => readFile(filePath, options) as Promise<Buffer | string>,
  writeFile: (filePath: string, data: string | Buffer | Uint8Array, options?: { encoding?: string } | string) => writeFile(filePath, data, options) as Promise<void>,
  appendFile,
  stat: stat as (filePath: string) => Promise<VFSStats>,
  lstat: lstat as (filePath: string) => Promise<VFSStats>,
  readdir: readdir as (dirPath: string, options?: { encoding?: string; withFileTypes?: boolean }) => Promise<string[] | Dirent[]>,
  mkdir: mkdir as (dirPath: string, options?: { recursive?: boolean; mode?: number } | number) => Promise<string | undefined>,
  rmdir: rmdir as (dirPath: string, options?: { recursive?: boolean }) => Promise<void>,
  unlink: unlink as (filePath: string) => Promise<void>,
  rename,
  symlink,
  readlink: readlink as (filePath: string) => Promise<string>,
  chmod,
  access,
  realpath: realpath as (filePath: string) => Promise<string>,
  mkdtemp: mkdtemp as (prefix: string) => Promise<string>,
  copyFile,
  constants,
};

export default {
  readFileSync,
  writeFileSync,
  appendFileSync,
  statSync,
  lstatSync,
  readdirSync,
  mkdirSync,
  rmdirSync,
  unlinkSync,
  renameSync,
  symlinkSync,
  readlinkSync,
  chmodSync,
  accessSync,
  existsSync,
  realpathSync,
  mkdtempSync,
  copyFileSync,
  readFile,
  writeFile,
  appendFile,
  stat,
  lstat,
  readdir,
  mkdir,
  rmdir,
  unlink,
  rename,
  symlink,
  readlink,
  chmod,
  access,
  realpath,
  mkdtemp,
  copyFile,
  constants,
  promises,
};
