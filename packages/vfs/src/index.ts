import { InodeTable } from './inode-table.js';
import { WatcherRegistry, type WatchEventType, type WatchCallback } from './watcher.js';
import * as ops from './operations.js';
import { normalizePath } from './path-resolver.js';
import { mountTree } from './mount.js';
import type { FileSystemTree, VFSStats, Dirent } from '@aspect/shared';

export class VFS {
  public table: InodeTable;
  public watchers: WatcherRegistry;

  constructor(table?: InodeTable) {
    this.table = table ?? new InodeTable();
    this.watchers = new WatcherRegistry();
  }

  readFile(path: string, encoding?: string): Uint8Array | string {
    return ops.readFile(this.table, path, encoding ? { encoding } : undefined);
  }

  writeFile(path: string, data: Uint8Array | string, options?: { flag?: string; mode?: number }): void {
    ops.writeFile(this.table, path, data, options);
    this.watchers.notify(path, 'change', normalizePath(path).split('/').pop() ?? null);
  }

  appendFile(path: string, data: Uint8Array | string): void {
    ops.appendFile(this.table, path, data);
    this.watchers.notify(path, 'change', normalizePath(path).split('/').pop() ?? null);
  }

  stat(path: string): VFSStats {
    return ops.stat(this.table, path);
  }

  lstat(path: string): VFSStats {
    return ops.lstat(this.table, path);
  }

  readdir(path: string, options?: { withFileTypes?: boolean }): string[] | Dirent[] {
    return ops.readdir(this.table, path, options);
  }

  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): void {
    ops.mkdir(this.table, path, options);
    this.watchers.notify(path, 'rename', normalizePath(path).split('/').pop() ?? null);
  }

  rmdir(path: string): void {
    ops.rmdir(this.table, path);
    this.watchers.notify(path, 'rename', normalizePath(path).split('/').pop() ?? null);
  }

  unlink(path: string): void {
    ops.unlink(this.table, path);
    this.watchers.notify(path, 'rename', normalizePath(path).split('/').pop() ?? null);
  }

  rename(oldPath: string, newPath: string): void {
    ops.rename(this.table, oldPath, newPath);
    this.watchers.notify(oldPath, 'rename', null);
    this.watchers.notify(newPath, 'rename', null);
  }

  symlink(target: string, linkPath: string): void {
    ops.symlink(this.table, target, linkPath);
    this.watchers.notify(linkPath, 'rename', normalizePath(linkPath).split('/').pop() ?? null);
  }

  readlink(path: string): string {
    return ops.readlink(this.table, path);
  }

  chmod(path: string, mode: number): void {
    ops.chmod(this.table, path, mode);
  }

  access(path: string, mode?: number): void {
    ops.access(this.table, path, mode);
  }

  copyFile(src: string, dest: string): void {
    ops.copyFile(this.table, src, dest);
    this.watchers.notify(dest, 'change', normalizePath(dest).split('/').pop() ?? null);
  }

  realpath(path: string): string {
    return ops.realpath(this.table, path);
  }

  mkdtemp(prefix: string): string {
    const result = ops.mkdtemp(this.table, prefix);
    this.watchers.notify(result, 'rename', null);
    return result;
  }

  exists(path: string): boolean {
    return ops.exists(this.table, path);
  }

  utimes(path: string, atime: number, mtime: number): void {
    ops.utimes(this.table, path, atime, mtime);
  }

  rm(path: string, options?: { recursive?: boolean; force?: boolean }): void {
    ops.rm(this.table, path, options);
    this.watchers.notify(path, 'rename', normalizePath(path).split('/').pop() ?? null);
  }

  mount(basePath: string, tree: FileSystemTree): void {
    mountTree(this.table, basePath, tree);
  }

  watch(path: string, options: { recursive?: boolean }, callback: WatchCallback): () => void {
    return this.watchers.watch(path, options, callback);
  }
}

export { InodeTable } from './inode-table.js';
export { WatcherRegistry } from './watcher.js';
export type { WatchEventType, WatchCallback } from './watcher.js';
export { normalizePath, resolvePath, resolveParent, joinPath } from './path-resolver.js';
export { mountTree } from './mount.js';
export { saveSnapshot, loadSnapshot } from './persistence.js';
export { OverlayInodeTable } from './overlay.js';
export * from './operations.js';
