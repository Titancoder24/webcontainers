import { describe, it, expect, beforeEach } from 'vitest';
import { SyscallDispatcher } from '../src/syscall-dispatcher.js';
import { VFS } from '@aspect/vfs';
import { SyscallType } from '@aspect/shared';

describe('SyscallDispatcher', () => {
  let vfs: VFS;
  let dispatcher: SyscallDispatcher;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home/project', { recursive: true });
    dispatcher = new SyscallDispatcher(vfs);
  });

  it('should handle FS_WRITEFILE and FS_READFILE', () => {
    const writeResult = dispatcher.handleSyscall(
      SyscallType.FS_WRITEFILE,
      { path: '/home/project/test.txt', content: 'Hello World' }
    );
    expect(writeResult.error).toBeUndefined();

    const readResult = dispatcher.handleSyscall(
      SyscallType.FS_READFILE,
      { path: '/home/project/test.txt', encoding: 'utf-8' }
    );
    expect(readResult.error).toBeUndefined();
    expect(readResult.data?.content).toBe('Hello World');
  });

  it('should handle FS_STAT', () => {
    vfs.writeFile('/home/project/file.txt', 'data');
    const result = dispatcher.handleSyscall(
      SyscallType.FS_STAT,
      { path: '/home/project/file.txt' }
    );
    expect(result.error).toBeUndefined();
    expect(result.data?.isFile).toBe(true);
    expect(result.data?.size).toBe(4);
  });

  it('should handle FS_MKDIR', () => {
    const result = dispatcher.handleSyscall(
      SyscallType.FS_MKDIR,
      { path: '/home/project/newdir', recursive: true }
    );
    expect(result.error).toBeUndefined();
    expect(vfs.stat('/home/project/newdir').isDirectory()).toBe(true);
  });

  it('should handle FS_READDIR', () => {
    vfs.writeFile('/home/project/a.txt', 'a');
    vfs.writeFile('/home/project/b.txt', 'b');
    const result = dispatcher.handleSyscall(
      SyscallType.FS_READDIR,
      { path: '/home/project' }
    );
    expect(result.error).toBeUndefined();
    expect((result.data?.entries as string[])).toContain('a.txt');
    expect((result.data?.entries as string[])).toContain('b.txt');
  });

  it('should return errors for invalid paths', () => {
    const result = dispatcher.handleSyscall(
      SyscallType.FS_READFILE,
      { path: '/nonexistent/file.txt' }
    );
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENOENT');
  });

  it('should handle FS_EXISTS', () => {
    vfs.writeFile('/file.txt', 'x');
    const exists = dispatcher.handleSyscall(SyscallType.FS_EXISTS, { path: '/file.txt' });
    expect(exists.data?.exists).toBe(true);

    const notExists = dispatcher.handleSyscall(SyscallType.FS_EXISTS, { path: '/nope.txt' });
    expect(notExists.data?.exists).toBe(false);
  });

  it('should handle FS_UNLINK', () => {
    vfs.writeFile('/file.txt', 'data');
    const result = dispatcher.handleSyscall(SyscallType.FS_UNLINK, { path: '/file.txt' });
    expect(result.error).toBeUndefined();
    expect(vfs.exists('/file.txt')).toBe(false);
  });

  it('should handle unknown syscalls', () => {
    const result = dispatcher.handleSyscall(999 as SyscallType, {});
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENOSYS');
  });
});
