import type { InodeTable } from './inode-table.js';
import { ROOT_INODE_ID } from '@aspect/shared';
import { createFSError } from '@aspect/shared';

const MAX_SYMLINK_DEPTH = 40;

export function normalizePath(path: string): string {
  if (!path || path === '') return '/';

  // Ensure absolute
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  const parts = path.split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return '/' + resolved.join('/');
}

export function resolvePath(
  table: InodeTable,
  absolutePath: string,
  followSymlink: boolean = true,
  depth: number = 0
): number {
  if (depth > MAX_SYMLINK_DEPTH) {
    throw createFSError('ENOENT', 'resolve', absolutePath, 'ENOENT: too many symbolic links');
  }

  const normalized = normalizePath(absolutePath);
  if (normalized === '/') return ROOT_INODE_ID;

  const segments = normalized.split('/').filter(s => s !== '');
  let currentId = ROOT_INODE_ID;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const current = table.get(currentId);

    if (!current) {
      throw createFSError('ENOENT', 'resolve', absolutePath);
    }

    if (current.type === 'symlink' && followSymlink) {
      const target = current.target!;
      const resolvedTarget = target.startsWith('/')
        ? target
        : normalizePath('/' + segments.slice(0, i).join('/') + '/' + target);
      currentId = resolvePath(table, resolvedTarget, true, depth + 1);
      const resolved = table.get(currentId);
      if (!resolved || resolved.type !== 'directory') {
        throw createFSError('ENOTDIR', 'resolve', absolutePath);
      }
    }

    if (current.type !== 'directory') {
      if (i < segments.length - 1) {
        throw createFSError('ENOTDIR', 'resolve', absolutePath);
      }
    }

    if (current.type === 'directory') {
      const childId = current.children.get(segment);
      if (childId === undefined) {
        throw createFSError('ENOENT', 'resolve', absolutePath);
      }
      currentId = childId;
    }
  }

  // Follow final symlink if needed
  if (followSymlink) {
    const final = table.get(currentId);
    if (final && final.type === 'symlink') {
      const target = final.target!;
      const parentPath = '/' + segments.slice(0, -1).join('/');
      const resolvedTarget = target.startsWith('/')
        ? target
        : normalizePath(parentPath + '/' + target);
      return resolvePath(table, resolvedTarget, true, depth + 1);
    }
  }

  return currentId;
}

export function resolveParent(
  table: InodeTable,
  absolutePath: string
): { parentInodeId: number; basename: string } {
  const normalized = normalizePath(absolutePath);
  if (normalized === '/') {
    return { parentInodeId: ROOT_INODE_ID, basename: '' };
  }

  const lastSlash = normalized.lastIndexOf('/');
  const parentPath = lastSlash === 0 ? '/' : normalized.substring(0, lastSlash);
  const basename = normalized.substring(lastSlash + 1);

  const parentId = resolvePath(table, parentPath, true);
  const parent = table.get(parentId);

  if (!parent || parent.type !== 'directory') {
    throw createFSError('ENOTDIR', 'resolve', parentPath);
  }

  return { parentInodeId: parentId, basename };
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join('/'));
}
