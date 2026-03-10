import { describe, it, expect } from 'vitest';
import { normalizePath } from '../src/path-resolver.js';

describe('normalizePath', () => {
  it('should handle root path', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('should remove trailing slashes', () => {
    expect(normalizePath('/test/')).toBe('/test');
  });

  it('should resolve . and ..', () => {
    expect(normalizePath('/a/b/../c')).toBe('/a/c');
    expect(normalizePath('/a/./b/./c')).toBe('/a/b/c');
    expect(normalizePath('/a/b/../../c')).toBe('/c');
  });

  it('should remove redundant slashes', () => {
    expect(normalizePath('//a///b//c')).toBe('/a/b/c');
  });

  it('should ensure absolute path', () => {
    expect(normalizePath('relative/path')).toBe('/relative/path');
  });

  it('should handle empty string', () => {
    expect(normalizePath('')).toBe('/');
  });

  it('should handle complex paths', () => {
    expect(normalizePath('/a/b/../c/./d/../e')).toBe('/a/c/e');
  });

  it('should not go above root', () => {
    expect(normalizePath('/../../..')).toBe('/');
  });
});
