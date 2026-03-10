import { InodeTable } from './inode-table.js';
import type { Inode } from '@aspect/shared';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function saveSnapshot(table: InodeTable): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error('OPFS not available');
  }

  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle('vfs-snapshot.bin', { create: true });
  const writable = await (fileHandle as any).createWritable();

  const buffer = serializeTable(table);
  await writable.write(buffer);
  await writable.close();
}

export async function loadSnapshot(): Promise<InodeTable | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null;
  }

  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('vfs-snapshot.bin');
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    return deserializeTable(new Uint8Array(buffer));
  } catch {
    return null;
  }
}

function serializeTable(table: InodeTable): Uint8Array {
  const entries: Inode[] = [];
  for (const inode of table.values()) {
    entries.push(inode);
  }

  // Calculate total size
  let totalSize = 4; // inode count
  for (const inode of entries) {
    totalSize += 4; // id
    totalSize += 1; // type (0=file, 1=dir, 2=symlink)
    totalSize += 4; // mode
    totalSize += 8; // size (as two 32-bit ints)
    totalSize += 8; // mtime (as two 32-bit ints)
    totalSize += 4; // data length
    totalSize += inode.data?.length ?? 0; // data
    if (inode.type === 'symlink' && inode.target) {
      totalSize += 4; // target length
      totalSize += encoder.encode(inode.target).length;
    } else {
      totalSize += 4; // target length = 0
    }
    totalSize += 4; // children count
    for (const [name] of inode.children) {
      totalSize += 4; // name length
      totalSize += encoder.encode(name).length; // name
      totalSize += 4; // child inode id
    }
  }

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  view.setUint32(offset, entries.length, true);
  offset += 4;

  for (const inode of entries) {
    view.setUint32(offset, inode.id, true);
    offset += 4;

    const typeVal = inode.type === 'file' ? 0 : inode.type === 'directory' ? 1 : 2;
    buffer[offset] = typeVal;
    offset += 1;

    view.setUint32(offset, inode.mode, true);
    offset += 4;

    // Store size as two 32-bit ints
    view.setUint32(offset, inode.size & 0xFFFFFFFF, true);
    view.setUint32(offset + 4, (inode.size / 0x100000000) >>> 0, true);
    offset += 8;

    // Store mtime as two 32-bit ints
    view.setUint32(offset, inode.mtimeMs & 0xFFFFFFFF, true);
    view.setUint32(offset + 4, (inode.mtimeMs / 0x100000000) >>> 0, true);
    offset += 8;

    // Data
    const dataLen = inode.data?.length ?? 0;
    view.setUint32(offset, dataLen, true);
    offset += 4;
    if (inode.data && dataLen > 0) {
      buffer.set(inode.data, offset);
      offset += dataLen;
    }

    // Symlink target
    if (inode.type === 'symlink' && inode.target) {
      const targetBytes = encoder.encode(inode.target);
      view.setUint32(offset, targetBytes.length, true);
      offset += 4;
      buffer.set(targetBytes, offset);
      offset += targetBytes.length;
    } else {
      view.setUint32(offset, 0, true);
      offset += 4;
    }

    // Children
    view.setUint32(offset, inode.children.size, true);
    offset += 4;
    for (const [name, childId] of inode.children) {
      const nameBytes = encoder.encode(name);
      view.setUint32(offset, nameBytes.length, true);
      offset += 4;
      buffer.set(nameBytes, offset);
      offset += nameBytes.length;
      view.setUint32(offset, childId, true);
      offset += 4;
    }
  }

  return buffer.slice(0, offset);
}

function deserializeTable(data: Uint8Array): InodeTable {
  const table = new InodeTable();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const count = view.getUint32(offset, true);
  offset += 4;

  for (let i = 0; i < count; i++) {
    const id = view.getUint32(offset, true);
    offset += 4;

    const typeVal = data[offset];
    offset += 1;
    const type = typeVal === 0 ? 'file' : typeVal === 1 ? 'directory' : 'symlink';

    const mode = view.getUint32(offset, true);
    offset += 4;

    const sizeLo = view.getUint32(offset, true);
    const sizeHi = view.getUint32(offset + 4, true);
    const size = sizeLo + sizeHi * 0x100000000;
    offset += 8;

    const mtimeLo = view.getUint32(offset, true);
    const mtimeHi = view.getUint32(offset + 4, true);
    const mtimeMs = mtimeLo + mtimeHi * 0x100000000;
    offset += 8;

    const dataLen = view.getUint32(offset, true);
    offset += 4;
    let fileData: Uint8Array | null = null;
    if (dataLen > 0) {
      fileData = data.slice(offset, offset + dataLen);
      offset += dataLen;
    }

    const targetLen = view.getUint32(offset, true);
    offset += 4;
    let target: string | null = null;
    if (targetLen > 0) {
      target = decoder.decode(data.slice(offset, offset + targetLen));
      offset += targetLen;
    }

    const childCount = view.getUint32(offset, true);
    offset += 4;
    const children = new Map<string, number>();
    for (let j = 0; j < childCount; j++) {
      const nameLen = view.getUint32(offset, true);
      offset += 4;
      const name = decoder.decode(data.slice(offset, offset + nameLen));
      offset += nameLen;
      const childId = view.getUint32(offset, true);
      offset += 4;
      children.set(name, childId);
    }

    // Skip root inode (already created by constructor)
    if (id === 0) {
      const root = table.get(0)!;
      root.children = children;
      root.mode = mode;
      root.mtimeMs = mtimeMs;
      continue;
    }

    table.allocate({
      type: type as 'file' | 'directory' | 'symlink',
      data: fileData,
      children,
      target,
      mode,
      size,
      mtimeMs,
      atimeMs: mtimeMs,
      ctimeMs: mtimeMs,
      birthtimeMs: mtimeMs,
    });
  }

  return table;
}
