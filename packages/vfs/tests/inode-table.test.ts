import { describe, it, expect } from 'vitest';
import { InodeTable } from '../src/inode-table.js';

describe('InodeTable', () => {
  it('should initialize with root directory at id 0', () => {
    const table = new InodeTable();
    const root = table.get(0);
    expect(root).toBeDefined();
    expect(root!.type).toBe('directory');
    expect(root!.id).toBe(0);
    expect(root!.children.size).toBe(0);
  });

  it('should allocate new inodes with incrementing IDs', () => {
    const table = new InodeTable();
    const file1 = table.allocate({ type: 'file', data: new Uint8Array([1, 2, 3]) });
    const file2 = table.allocate({ type: 'file', data: new Uint8Array([4, 5]) });
    expect(file1.id).toBe(1);
    expect(file2.id).toBe(2);
    expect(table.size()).toBe(3); // root + 2 files
  });

  it('should update inode properties', () => {
    const table = new InodeTable();
    const file = table.allocate({ type: 'file', data: new Uint8Array([1]) });
    table.update(file.id, { mode: 0o755, size: 100 });
    const updated = table.get(file.id)!;
    expect(updated.mode).toBe(0o755);
    expect(updated.size).toBe(100);
  });

  it('should delete inodes', () => {
    const table = new InodeTable();
    const file = table.allocate({ type: 'file' });
    expect(table.has(file.id)).toBe(true);
    table.delete(file.id);
    expect(table.has(file.id)).toBe(false);
  });

  it('should allocate directory inodes with default permissions', () => {
    const table = new InodeTable();
    const dir = table.allocate({ type: 'directory' });
    expect(dir.mode).toBe(0o755);
    expect(dir.type).toBe('directory');
    expect(dir.children.size).toBe(0);
  });

  it('should allocate file inodes with default permissions', () => {
    const table = new InodeTable();
    const file = table.allocate({ type: 'file' });
    expect(file.mode).toBe(0o644);
  });
});
