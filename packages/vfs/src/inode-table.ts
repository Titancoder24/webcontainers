import type { Inode } from '@aspect/shared';
import { ROOT_INODE_ID, DEFAULT_DIR_MODE } from '@aspect/shared';

export class InodeTable {
  private inodes: Map<number, Inode> = new Map();
  private counter: number = 1;

  constructor() {
    const now = Date.now();
    const root: Inode = {
      id: ROOT_INODE_ID,
      type: 'directory',
      data: null,
      children: new Map(),
      target: null,
      mode: DEFAULT_DIR_MODE,
      size: 0,
      mtimeMs: now,
      atimeMs: now,
      ctimeMs: now,
      birthtimeMs: now,
      uid: 0,
      gid: 0,
      nlink: 2,
    };
    this.inodes.set(ROOT_INODE_ID, root);
  }

  nextId(): number {
    return this.counter++;
  }

  allocate(partial: Partial<Inode> & Pick<Inode, 'type'>): Inode {
    const id = this.nextId();
    const now = Date.now();
    const inode: Inode = {
      id,
      type: partial.type,
      data: partial.data ?? null,
      children: partial.children ?? new Map(),
      target: partial.target ?? null,
      mode: partial.mode ?? (partial.type === 'directory' ? 0o755 : 0o644),
      size: partial.size ?? 0,
      mtimeMs: partial.mtimeMs ?? now,
      atimeMs: partial.atimeMs ?? now,
      ctimeMs: partial.ctimeMs ?? now,
      birthtimeMs: partial.birthtimeMs ?? now,
      uid: partial.uid ?? 1000,
      gid: partial.gid ?? 1000,
      nlink: partial.nlink ?? 1,
    };
    this.inodes.set(id, inode);
    return inode;
  }

  get(id: number): Inode | undefined {
    return this.inodes.get(id);
  }

  update(id: number, partial: Partial<Inode>): void {
    const inode = this.inodes.get(id);
    if (!inode) return;
    Object.assign(inode, partial);
    inode.ctimeMs = Date.now();
  }

  delete(id: number): boolean {
    return this.inodes.delete(id);
  }

  has(id: number): boolean {
    return this.inodes.has(id);
  }

  size(): number {
    return this.inodes.size;
  }

  entries(): IterableIterator<[number, Inode]> {
    return this.inodes.entries();
  }

  values(): IterableIterator<Inode> {
    return this.inodes.values();
  }
}
