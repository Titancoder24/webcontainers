import { InodeTable } from './inode-table.js';
import type { Inode } from '@aspect/shared';

export class OverlayInodeTable {
  private base: InodeTable;
  private write: InodeTable;
  private copiedUp: Set<number> = new Set();

  constructor(base: InodeTable) {
    this.base = base;
    this.write = new InodeTable();
  }

  get(id: number): Inode | undefined {
    return this.write.get(id) ?? this.base.get(id);
  }

  allocate(partial: Partial<Inode> & Pick<Inode, 'type'>): Inode {
    return this.write.allocate(partial);
  }

  update(id: number, partial: Partial<Inode>): void {
    if (!this.copiedUp.has(id) && this.base.has(id) && !this.write.has(id)) {
      this.copyUp(id);
    }
    this.write.update(id, partial);
  }

  delete(id: number): boolean {
    this.copiedUp.add(id);
    return this.write.delete(id);
  }

  has(id: number): boolean {
    return this.write.has(id) || this.base.has(id);
  }

  copyUp(id: number): void {
    const baseInode = this.base.get(id);
    if (!baseInode) return;

    const copy: Inode = {
      ...baseInode,
      children: new Map(baseInode.children),
      data: baseInode.data ? new Uint8Array(baseInode.data) : null,
    };

    // Directly set on write layer with same ID
    this.write.allocate(copy);
    this.copiedUp.add(id);
  }

  reset(): void {
    this.write = new InodeTable();
    this.copiedUp.clear();
  }

  serialize(): Uint8Array {
    const entries: Array<{ id: number; inode: Inode }> = [];
    for (const [id, inode] of this.write.entries()) {
      entries.push({ id, inode });
    }

    const json = JSON.stringify(entries, (_key, value) => {
      if (value instanceof Map) {
        return Object.fromEntries(value);
      }
      if (value instanceof Uint8Array) {
        return Array.from(value);
      }
      return value;
    });

    return new TextEncoder().encode(json);
  }

  nextId(): number {
    return this.write.nextId();
  }

  size(): number {
    // Approximate: unique IDs across both layers
    const ids = new Set<number>();
    for (const [id] of this.base.entries()) ids.add(id);
    for (const [id] of this.write.entries()) ids.add(id);
    return ids.size;
  }
}
