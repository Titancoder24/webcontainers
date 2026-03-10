import type { InodeTable } from './inode-table.js';
import type { VFSStats, Dirent } from '@aspect/shared';
import { DEFAULT_FILE_MODE, DEFAULT_DIR_MODE, DEFAULT_SYMLINK_MODE } from '@aspect/shared';
import { createFSError } from '@aspect/shared';
import { resolvePath, resolveParent, normalizePath } from './path-resolver.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeStats(inode: { id: number; mode: number; nlink: number; uid: number; gid: number; size: number; atimeMs: number; mtimeMs: number; ctimeMs: number; birthtimeMs: number; type: string }): VFSStats {
  return {
    dev: 1,
    ino: inode.id,
    mode: inode.mode,
    nlink: inode.nlink,
    uid: inode.uid,
    gid: inode.gid,
    rdev: 0,
    size: inode.size,
    blksize: 4096,
    blocks: Math.ceil(inode.size / 512),
    atimeMs: inode.atimeMs,
    mtimeMs: inode.mtimeMs,
    ctimeMs: inode.ctimeMs,
    birthtimeMs: inode.birthtimeMs,
    atime: new Date(inode.atimeMs),
    mtime: new Date(inode.mtimeMs),
    ctime: new Date(inode.ctimeMs),
    birthtime: new Date(inode.birthtimeMs),
    isFile: () => inode.type === 'file',
    isDirectory: () => inode.type === 'directory',
    isSymbolicLink: () => inode.type === 'symlink',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

export function readFile(
  table: InodeTable,
  path: string,
  options?: { encoding?: string }
): Uint8Array | string {
  const id = resolvePath(table, path);
  const inode = table.get(id)!;

  if (inode.type === 'directory') {
    throw createFSError('EISDIR', 'read', path);
  }
  if (inode.type === 'symlink') {
    throw createFSError('ENOENT', 'read', path);
  }

  const data = inode.data ?? new Uint8Array(0);
  table.update(id, { atimeMs: Date.now() });

  if (options?.encoding) {
    return decoder.decode(data);
  }
  return data;
}

export function writeFile(
  table: InodeTable,
  path: string,
  data: Uint8Array | string,
  options?: { flag?: string; mode?: number }
): void {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const flag = options?.flag ?? 'w';
  const mode = options?.mode ?? DEFAULT_FILE_MODE;

  const { parentInodeId, basename } = resolveParent(table, path);
  const parent = table.get(parentInodeId)!;

  const existingId = parent.children.get(basename);

  if (existingId !== undefined) {
    if (flag === 'wx') {
      throw createFSError('EEXIST', 'open', path);
    }
    const existing = table.get(existingId)!;
    if (existing.type === 'directory') {
      throw createFSError('EISDIR', 'open', path);
    }

    if (flag === 'a') {
      const oldData = existing.data ?? new Uint8Array(0);
      const newData = new Uint8Array(oldData.length + bytes.length);
      newData.set(oldData);
      newData.set(bytes, oldData.length);
      table.update(existingId, {
        data: newData,
        size: newData.length,
        mtimeMs: Date.now(),
      });
    } else {
      table.update(existingId, {
        data: new Uint8Array(bytes),
        size: bytes.length,
        mtimeMs: Date.now(),
      });
    }
  } else {
    const newInode = table.allocate({
      type: 'file',
      data: new Uint8Array(bytes),
      mode,
      size: bytes.length,
    });
    parent.children.set(basename, newInode.id);
    table.update(parentInodeId, { mtimeMs: Date.now() });
  }
}

export function appendFile(
  table: InodeTable,
  path: string,
  data: Uint8Array | string
): void {
  writeFile(table, path, data, { flag: 'a' });
}

export function stat(table: InodeTable, path: string): VFSStats {
  const id = resolvePath(table, path, true);
  const inode = table.get(id)!;
  return makeStats(inode);
}

export function lstat(table: InodeTable, path: string): VFSStats {
  const id = resolvePath(table, path, false);
  const inode = table.get(id)!;
  return makeStats(inode);
}

export function readdir(
  table: InodeTable,
  path: string,
  options?: { withFileTypes?: boolean }
): string[] | Dirent[] {
  const id = resolvePath(table, path);
  const inode = table.get(id)!;

  if (inode.type !== 'directory') {
    throw createFSError('ENOTDIR', 'scandir', path);
  }

  table.update(id, { atimeMs: Date.now() });

  if (options?.withFileTypes) {
    const entries: Dirent[] = [];
    for (const [name, childId] of inode.children) {
      const child = table.get(childId)!;
      entries.push({
        name,
        isFile: () => child.type === 'file',
        isDirectory: () => child.type === 'directory',
        isSymbolicLink: () => child.type === 'symlink',
      });
    }
    return entries;
  }

  return Array.from(inode.children.keys());
}

export function mkdir(
  table: InodeTable,
  path: string,
  options?: { recursive?: boolean; mode?: number }
): void {
  const normalized = normalizePath(path);
  const mode = options?.mode ?? DEFAULT_DIR_MODE;

  if (options?.recursive) {
    const segments = normalized.split('/').filter(s => s !== '');
    let currentPath = '';
    for (const segment of segments) {
      currentPath += '/' + segment;
      try {
        const id = resolvePath(table, currentPath);
        const inode = table.get(id)!;
        if (inode.type !== 'directory') {
          throw createFSError('ENOTDIR', 'mkdir', currentPath);
        }
      } catch (e: any) {
        if (e.code === 'ENOENT') {
          const { parentInodeId, basename } = resolveParent(table, currentPath);
          const parent = table.get(parentInodeId)!;
          const newDir = table.allocate({
            type: 'directory',
            mode,
            nlink: 2,
          });
          parent.children.set(basename, newDir.id);
          table.update(parentInodeId, { mtimeMs: Date.now() });
        } else {
          throw e;
        }
      }
    }
    return;
  }

  const { parentInodeId, basename } = resolveParent(table, normalized);
  const parent = table.get(parentInodeId)!;

  if (parent.children.has(basename)) {
    throw createFSError('EEXIST', 'mkdir', path);
  }

  const newDir = table.allocate({
    type: 'directory',
    mode,
    nlink: 2,
  });
  parent.children.set(basename, newDir.id);
  table.update(parentInodeId, { mtimeMs: Date.now() });
}

export function rmdir(table: InodeTable, path: string): void {
  const id = resolvePath(table, path);
  const inode = table.get(id)!;

  if (inode.type !== 'directory') {
    throw createFSError('ENOTDIR', 'rmdir', path);
  }
  if (inode.children.size > 0) {
    throw createFSError('ENOTEMPTY', 'rmdir', path);
  }

  const { parentInodeId, basename } = resolveParent(table, path);
  const parent = table.get(parentInodeId)!;
  parent.children.delete(basename);
  table.delete(id);
  table.update(parentInodeId, { mtimeMs: Date.now() });
}

export function unlink(table: InodeTable, path: string): void {
  const id = resolvePath(table, path, false);
  const inode = table.get(id)!;

  if (inode.type === 'directory') {
    throw createFSError('EISDIR', 'unlink', path);
  }

  const { parentInodeId, basename } = resolveParent(table, path);
  const parent = table.get(parentInodeId)!;
  parent.children.delete(basename);
  table.delete(id);
  table.update(parentInodeId, { mtimeMs: Date.now() });
}

export function rename(table: InodeTable, oldPath: string, newPath: string): void {
  const oldId = resolvePath(table, oldPath, false);
  const { parentInodeId: oldParentId, basename: oldName } = resolveParent(table, oldPath);
  const { parentInodeId: newParentId, basename: newName } = resolveParent(table, newPath);

  const newParent = table.get(newParentId)!;
  const existingNewId = newParent.children.get(newName);
  if (existingNewId !== undefined) {
    const existingNew = table.get(existingNewId)!;
    const oldInode = table.get(oldId)!;
    if (existingNew.type === 'directory' && oldInode.type !== 'directory') {
      throw createFSError('EISDIR', 'rename', newPath);
    }
    if (existingNew.type !== 'directory' && oldInode.type === 'directory') {
      throw createFSError('ENOTDIR', 'rename', newPath);
    }
    if (existingNew.type === 'directory' && existingNew.children.size > 0) {
      throw createFSError('ENOTEMPTY', 'rename', newPath);
    }
    table.delete(existingNewId);
  }

  const oldParent = table.get(oldParentId)!;
  oldParent.children.delete(oldName);
  newParent.children.set(newName, oldId);

  const now = Date.now();
  table.update(oldParentId, { mtimeMs: now });
  table.update(newParentId, { mtimeMs: now });
}

export function symlink(table: InodeTable, target: string, linkPath: string): void {
  const { parentInodeId, basename } = resolveParent(table, linkPath);
  const parent = table.get(parentInodeId)!;

  if (parent.children.has(basename)) {
    throw createFSError('EEXIST', 'symlink', linkPath);
  }

  const link = table.allocate({
    type: 'symlink',
    target,
    mode: DEFAULT_SYMLINK_MODE,
  });
  parent.children.set(basename, link.id);
  table.update(parentInodeId, { mtimeMs: Date.now() });
}

export function readlink(table: InodeTable, path: string): string {
  const id = resolvePath(table, path, false);
  const inode = table.get(id)!;

  if (inode.type !== 'symlink') {
    throw createFSError('ENOENT', 'readlink', path);
  }

  return inode.target!;
}

export function chmod(table: InodeTable, path: string, mode: number): void {
  const id = resolvePath(table, path);
  table.update(id, { mode });
}

export function access(table: InodeTable, path: string, _mode?: number): void {
  resolvePath(table, path);
}

export function copyFile(table: InodeTable, src: string, dest: string): void {
  const data = readFile(table, src) as Uint8Array;
  writeFile(table, dest, data);
}

export function realpath(table: InodeTable, path: string): string {
  const normalized = normalizePath(path);
  // Resolve by walking each segment and following symlinks
  const segments = normalized.split('/').filter(s => s !== '');
  let resolvedPath = '/';
  let currentId = 0; // ROOT_INODE_ID

  for (const segment of segments) {
    const current = table.get(currentId)!;
    if (current.type !== 'directory') {
      throw createFSError('ENOTDIR', 'realpath', path);
    }

    const childId = current.children.get(segment);
    if (childId === undefined) {
      throw createFSError('ENOENT', 'realpath', path);
    }

    const child = table.get(childId)!;
    if (child.type === 'symlink') {
      const target = child.target!;
      const targetPath = target.startsWith('/')
        ? target
        : normalizePath(resolvedPath + '/' + target);
      const resolvedTarget = realpath(table, targetPath);
      resolvedPath = resolvedTarget;
      currentId = resolvePath(table, resolvedTarget);
    } else {
      resolvedPath = resolvedPath === '/' ? '/' + segment : resolvedPath + '/' + segment;
      currentId = childId;
    }
  }

  return resolvedPath;
}

export function mkdtemp(table: InodeTable, prefix: string): string {
  const suffix = Math.random().toString(36).substring(2, 8);
  const dirPath = prefix + suffix;
  mkdir(table, dirPath);
  return dirPath;
}

export function exists(table: InodeTable, path: string): boolean {
  try {
    resolvePath(table, path);
    return true;
  } catch {
    return false;
  }
}

export function utimes(table: InodeTable, path: string, atime: number, mtime: number): void {
  const id = resolvePath(table, path);
  table.update(id, { atimeMs: atime, mtimeMs: mtime });
}

export function rm(
  table: InodeTable,
  path: string,
  options?: { recursive?: boolean; force?: boolean }
): void {
  try {
    const id = resolvePath(table, path, false);
    const inode = table.get(id)!;

    if (inode.type === 'directory') {
      if (options?.recursive) {
        // Remove all children recursively
        for (const [, childId] of inode.children) {
          const child = table.get(childId)!;
          const childPath = normalizePath(path + '/' + getNameForId(table, id, childId));
          if (child.type === 'directory') {
            rm(table, childPath, { recursive: true });
          } else {
            unlink(table, childPath);
          }
        }
        rmdir(table, path);
      } else {
        throw createFSError('EISDIR', 'rm', path);
      }
    } else {
      unlink(table, path);
    }
  } catch (e: any) {
    if (options?.force && e.code === 'ENOENT') return;
    throw e;
  }
}

function getNameForId(table: InodeTable, parentId: number, childId: number): string {
  const parent = table.get(parentId)!;
  for (const [name, id] of parent.children) {
    if (id === childId) return name;
  }
  return '';
}
