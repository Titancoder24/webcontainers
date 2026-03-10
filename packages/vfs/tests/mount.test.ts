import { describe, it, expect, beforeEach } from 'vitest';
import { InodeTable } from '../src/inode-table.js';
import { mountTree } from '../src/mount.js';
import * as ops from '../src/operations.js';

describe('mountTree', () => {
  let table: InodeTable;

  beforeEach(() => {
    table = new InodeTable();
  });

  it('should mount a simple file tree', () => {
    mountTree(table, '/', {
      'hello.txt': { file: { contents: 'Hello, World!' } },
      'data.bin': { file: { contents: new Uint8Array([1, 2, 3]) } },
    });

    const content = ops.readFile(table, '/hello.txt', { encoding: 'utf-8' });
    expect(content).toBe('Hello, World!');
  });

  it('should mount nested directory trees', () => {
    mountTree(table, '/project', {
      src: {
        directory: {
          'index.ts': { file: { contents: 'export default {}' } },
          utils: {
            directory: {
              'helpers.ts': { file: { contents: 'export function help() {}' } },
            },
          },
        },
      },
      'package.json': { file: { contents: '{"name":"test"}' } },
    });

    const content = ops.readFile(table, '/project/src/index.ts', { encoding: 'utf-8' });
    expect(content).toBe('export default {}');

    const helper = ops.readFile(table, '/project/src/utils/helpers.ts', { encoding: 'utf-8' });
    expect(helper).toBe('export function help() {}');

    const pkg = ops.readFile(table, '/project/package.json', { encoding: 'utf-8' });
    expect(pkg).toBe('{"name":"test"}');
  });

  it('should create directories that do not exist', () => {
    mountTree(table, '/deep/nested/path', {
      'file.txt': { file: { contents: 'deep' } },
    });

    expect(ops.stat(table, '/deep').isDirectory()).toBe(true);
    expect(ops.stat(table, '/deep/nested').isDirectory()).toBe(true);
    expect(ops.stat(table, '/deep/nested/path').isDirectory()).toBe(true);
  });
});
