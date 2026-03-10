import type { InodeTable } from './inode-table.js';
import type { FileSystemTree, FileNode, DirectoryNode } from '@aspect/shared';
import { mkdir, writeFile, exists } from './operations.js';
import { normalizePath } from './path-resolver.js';

const encoder = new TextEncoder();

function isFileNode(node: FileNode | DirectoryNode): node is FileNode {
  return 'file' in node;
}

function isDirectoryNode(node: FileNode | DirectoryNode): node is DirectoryNode {
  return 'directory' in node;
}

export function mountTree(
  table: InodeTable,
  basePath: string,
  tree: FileSystemTree
): void {
  const normalized = normalizePath(basePath);

  // Ensure base path exists
  if (!exists(table, normalized)) {
    mkdir(table, normalized, { recursive: true });
  }

  for (const [name, node] of Object.entries(tree)) {
    const fullPath = normalized === '/' ? '/' + name : normalized + '/' + name;

    if (isFileNode(node)) {
      const contents = node.file.contents;
      const data = typeof contents === 'string' ? encoder.encode(contents) : contents;
      writeFile(table, fullPath, data);
    } else if (isDirectoryNode(node)) {
      if (!exists(table, fullPath)) {
        mkdir(table, fullPath, { recursive: true });
      }
      mountTree(table, fullPath, node.directory);
    }
  }
}
