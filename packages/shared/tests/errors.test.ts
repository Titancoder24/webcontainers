import { describe, it, expect } from 'vitest';
import { createFSError } from '../src/errors.js';

describe('createFSError', () => {
  it('should create ENOENT error', () => {
    const err = createFSError('ENOENT', 'open', '/test/file.txt');
    expect(err.code).toBe('ENOENT');
    expect(err.errno).toBe(-2);
    expect(err.syscall).toBe('open');
    expect(err.path).toBe('/test/file.txt');
    expect(err.message).toContain('no such file or directory');
  });

  it('should create EEXIST error', () => {
    const err = createFSError('EEXIST', 'mkdir', '/test/dir');
    expect(err.code).toBe('EEXIST');
    expect(err.errno).toBe(-17);
    expect(err.syscall).toBe('mkdir');
  });

  it('should create error with custom message', () => {
    const err = createFSError('EACCES', 'chmod', '/test', 'Custom message');
    expect(err.message).toBe('Custom message');
    expect(err.code).toBe('EACCES');
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      throw createFSError('EISDIR', 'read', '/test');
    }).toThrow();
  });
});
