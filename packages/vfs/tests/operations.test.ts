import { describe, it, expect, beforeEach } from 'vitest';
import { InodeTable } from '../src/inode-table.js';
import * as ops from '../src/operations.js';

describe('VFS operations', () => {
  let table: InodeTable;

  beforeEach(() => {
    table = new InodeTable();
  });

  describe('mkdir', () => {
    it('should create a directory', () => {
      ops.mkdir(table, '/test');
      const stat = ops.stat(table, '/test');
      expect(stat.isDirectory()).toBe(true);
    });

    it('should create nested directories recursively', () => {
      ops.mkdir(table, '/a/b/c', { recursive: true });
      expect(ops.stat(table, '/a').isDirectory()).toBe(true);
      expect(ops.stat(table, '/a/b').isDirectory()).toBe(true);
      expect(ops.stat(table, '/a/b/c').isDirectory()).toBe(true);
    });

    it('should throw EEXIST for duplicate directory', () => {
      ops.mkdir(table, '/test');
      expect(() => ops.mkdir(table, '/test')).toThrow();
    });

    it('should not throw for recursive mkdir on existing dir', () => {
      ops.mkdir(table, '/test');
      expect(() => ops.mkdir(table, '/test', { recursive: true })).not.toThrow();
    });
  });

  describe('writeFile / readFile', () => {
    it('should write and read a file', () => {
      ops.mkdir(table, '/home');
      ops.writeFile(table, '/home/test.txt', 'Hello, World!');
      const content = ops.readFile(table, '/home/test.txt', { encoding: 'utf-8' });
      expect(content).toBe('Hello, World!');
    });

    it('should write binary data', () => {
      ops.writeFile(table, '/data.bin', new Uint8Array([0, 1, 2, 3, 255]));
      const data = ops.readFile(table, '/data.bin') as Uint8Array;
      expect(Array.from(data)).toEqual([0, 1, 2, 3, 255]);
    });

    it('should overwrite existing file', () => {
      ops.writeFile(table, '/file.txt', 'first');
      ops.writeFile(table, '/file.txt', 'second');
      const content = ops.readFile(table, '/file.txt', { encoding: 'utf-8' });
      expect(content).toBe('second');
    });

    it('should throw ENOENT for nonexistent file', () => {
      expect(() => ops.readFile(table, '/nonexistent.txt')).toThrow();
    });

    it('should throw EISDIR for reading a directory', () => {
      ops.mkdir(table, '/dir');
      expect(() => ops.readFile(table, '/dir')).toThrow();
    });

    it('should fail with wx flag on existing file', () => {
      ops.writeFile(table, '/file.txt', 'data');
      expect(() => ops.writeFile(table, '/file.txt', 'new', { flag: 'wx' })).toThrow();
    });
  });

  describe('appendFile', () => {
    it('should append to existing file', () => {
      ops.writeFile(table, '/log.txt', 'line1\n');
      ops.appendFile(table, '/log.txt', 'line2\n');
      const content = ops.readFile(table, '/log.txt', { encoding: 'utf-8' });
      expect(content).toBe('line1\nline2\n');
    });

    it('should create file if it does not exist', () => {
      ops.appendFile(table, '/new.txt', 'content');
      const result = ops.readFile(table, '/new.txt', { encoding: 'utf-8' });
      expect(result).toBe('content');
    });
  });

  describe('stat / lstat', () => {
    it('should return stats for a file', () => {
      ops.writeFile(table, '/file.txt', 'hello');
      const s = ops.stat(table, '/file.txt');
      expect(s.isFile()).toBe(true);
      expect(s.isDirectory()).toBe(false);
      expect(s.size).toBe(5);
    });

    it('should return stats for a directory', () => {
      ops.mkdir(table, '/dir');
      const s = ops.stat(table, '/dir');
      expect(s.isDirectory()).toBe(true);
      expect(s.isFile()).toBe(false);
    });

    it('should throw ENOENT for nonexistent path', () => {
      expect(() => ops.stat(table, '/nope')).toThrow();
    });
  });

  describe('readdir', () => {
    it('should list directory entries', () => {
      ops.mkdir(table, '/dir');
      ops.writeFile(table, '/dir/a.txt', 'a');
      ops.writeFile(table, '/dir/b.txt', 'b');
      ops.mkdir(table, '/dir/sub');
      const entries = ops.readdir(table, '/dir') as string[];
      expect(entries).toContain('a.txt');
      expect(entries).toContain('b.txt');
      expect(entries).toContain('sub');
    });

    it('should return dirents with withFileTypes', () => {
      ops.mkdir(table, '/dir');
      ops.writeFile(table, '/dir/file.txt', 'data');
      ops.mkdir(table, '/dir/subdir');
      const entries = ops.readdir(table, '/dir', { withFileTypes: true }) as any[];
      const fileEntry = entries.find(e => e.name === 'file.txt');
      const dirEntry = entries.find(e => e.name === 'subdir');
      expect(fileEntry.isFile()).toBe(true);
      expect(dirEntry.isDirectory()).toBe(true);
    });

    it('should throw ENOTDIR for file path', () => {
      ops.writeFile(table, '/file.txt', 'data');
      expect(() => ops.readdir(table, '/file.txt')).toThrow();
    });
  });

  describe('unlink / rmdir', () => {
    it('should unlink a file', () => {
      ops.writeFile(table, '/file.txt', 'data');
      ops.unlink(table, '/file.txt');
      expect(() => ops.stat(table, '/file.txt')).toThrow();
    });

    it('should rmdir an empty directory', () => {
      ops.mkdir(table, '/dir');
      ops.rmdir(table, '/dir');
      expect(() => ops.stat(table, '/dir')).toThrow();
    });

    it('should throw ENOTEMPTY for non-empty directory', () => {
      ops.mkdir(table, '/dir');
      ops.writeFile(table, '/dir/file.txt', 'data');
      expect(() => ops.rmdir(table, '/dir')).toThrow();
    });

    it('should throw EISDIR when unlinking a directory', () => {
      ops.mkdir(table, '/dir');
      expect(() => ops.unlink(table, '/dir')).toThrow();
    });
  });

  describe('rename', () => {
    it('should rename a file', () => {
      ops.writeFile(table, '/old.txt', 'content');
      ops.rename(table, '/old.txt', '/new.txt');
      expect(() => ops.stat(table, '/old.txt')).toThrow();
      const content = ops.readFile(table, '/new.txt', { encoding: 'utf-8' });
      expect(content).toBe('content');
    });

    it('should move file to different directory', () => {
      ops.mkdir(table, '/src');
      ops.mkdir(table, '/dest');
      ops.writeFile(table, '/src/file.txt', 'data');
      ops.rename(table, '/src/file.txt', '/dest/file.txt');
      const content = ops.readFile(table, '/dest/file.txt', { encoding: 'utf-8' });
      expect(content).toBe('data');
    });
  });

  describe('symlink / readlink', () => {
    it('should create and read a symlink', () => {
      ops.writeFile(table, '/target.txt', 'data');
      ops.symlink(table, '/target.txt', '/link.txt');
      const target = ops.readlink(table, '/link.txt');
      expect(target).toBe('/target.txt');
    });

    it('should follow symlink for stat', () => {
      ops.writeFile(table, '/real.txt', 'hello');
      ops.symlink(table, '/real.txt', '/link.txt');
      const s = ops.stat(table, '/link.txt');
      expect(s.isFile()).toBe(true);
      expect(s.size).toBe(5);
    });

    it('should not follow symlink for lstat', () => {
      ops.writeFile(table, '/real.txt', 'hello');
      ops.symlink(table, '/real.txt', '/link.txt');
      const s = ops.lstat(table, '/link.txt');
      expect(s.isSymbolicLink()).toBe(true);
    });
  });

  describe('chmod', () => {
    it('should change file permissions', () => {
      ops.writeFile(table, '/file.txt', 'data');
      ops.chmod(table, '/file.txt', 0o755);
      const s = ops.stat(table, '/file.txt');
      expect(s.mode).toBe(0o755);
    });
  });

  describe('exists', () => {
    it('should return true for existing paths', () => {
      ops.writeFile(table, '/file.txt', 'data');
      expect(ops.exists(table, '/file.txt')).toBe(true);
      expect(ops.exists(table, '/')).toBe(true);
    });

    it('should return false for nonexistent paths', () => {
      expect(ops.exists(table, '/nope')).toBe(false);
    });
  });

  describe('copyFile', () => {
    it('should copy file contents', () => {
      ops.writeFile(table, '/src.txt', 'hello');
      ops.copyFile(table, '/src.txt', '/dest.txt');
      const content = ops.readFile(table, '/dest.txt', { encoding: 'utf-8' });
      expect(content).toBe('hello');
    });
  });

  describe('mkdtemp', () => {
    it('should create a uniquely named temp directory', () => {
      ops.mkdir(table, '/tmp', { recursive: true });
      const dir = ops.mkdtemp(table, '/tmp/test-');
      expect(dir).toMatch(/^\/tmp\/test-/);
      expect(ops.stat(table, dir).isDirectory()).toBe(true);
    });
  });

  describe('rm', () => {
    it('should remove a file', () => {
      ops.writeFile(table, '/file.txt', 'data');
      ops.rm(table, '/file.txt');
      expect(ops.exists(table, '/file.txt')).toBe(false);
    });

    it('should remove directory recursively', () => {
      ops.mkdir(table, '/dir/sub', { recursive: true });
      ops.writeFile(table, '/dir/file.txt', 'data');
      ops.writeFile(table, '/dir/sub/nested.txt', 'nested');
      ops.rm(table, '/dir', { recursive: true });
      expect(ops.exists(table, '/dir')).toBe(false);
    });

    it('should not throw with force flag on nonexistent path', () => {
      expect(() => ops.rm(table, '/nope', { force: true })).not.toThrow();
    });
  });
});
