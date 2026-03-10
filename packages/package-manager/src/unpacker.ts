/**
 * Streaming tarball (.tgz) unpacker.
 * Decompresses gzip and parses tar headers to extract files into a VFS.
 */

import type { VFS } from './types.js';

/**
 * Tar header field offsets and lengths (POSIX ustar format).
 */
const TAR = {
  NAME_OFFSET: 0,
  NAME_LENGTH: 100,
  MODE_OFFSET: 100,
  MODE_LENGTH: 8,
  SIZE_OFFSET: 124,
  SIZE_LENGTH: 12,
  TYPE_OFFSET: 156,
  TYPE_LENGTH: 1,
  PREFIX_OFFSET: 345,
  PREFIX_LENGTH: 155,
  BLOCK_SIZE: 512,
} as const;

/** Tar entry types */
const TYPE_FILE = '0';
const TYPE_FILE_ALT = '\0'; // Old-style tar uses null byte for regular files
const TYPE_DIRECTORY = '5';
const TYPE_SYMLINK = '2';

interface TarEntry {
  name: string;
  mode: number;
  size: number;
  type: string;
  linkTarget?: string;
}

/**
 * Unpack a .tgz (gzipped tar) buffer into a virtual filesystem.
 *
 * @param data - The raw .tgz ArrayBuffer or Uint8Array
 * @param targetPath - Base directory in the VFS to extract into
 * @param vfs - Virtual filesystem implementation
 */
export async function unpackTarball(
  data: ArrayBuffer | Uint8Array,
  targetPath: string,
  vfs: VFS,
): Promise<void> {
  const compressed = data instanceof Uint8Array ? data : new Uint8Array(data);
  const decompressed = await decompress(compressed);
  await extractTar(decompressed, targetPath, vfs);
}

/**
 * Unpack a tarball from a ReadableStream into the VFS.
 * Uses streaming decompression if DecompressionStream is available.
 */
export async function unpackTarballStream(
  stream: ReadableStream<Uint8Array>,
  targetPath: string,
  vfs: VFS,
): Promise<void> {
  if (typeof DecompressionStream !== 'undefined') {
    const decompressedStream = stream.pipeThrough(
      new DecompressionStream('gzip'),
    );
    const tarData = await streamToUint8Array(decompressedStream);
    await extractTar(tarData, targetPath, vfs);
  } else {
    // Fallback: collect the whole stream first, then decompress
    const compressed = await streamToUint8Array(stream);
    const decompressed = await decompress(compressed);
    await extractTar(decompressed, targetPath, vfs);
  }
}

/**
 * Decompress gzip data using DecompressionStream (if available)
 * or manual inflate fallback.
 */
async function decompress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    const writePromise = writer.write(data).then(() => writer.close());

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalSize += value.length;
    }

    await writePromise;

    return concatUint8Arrays(chunks, totalSize);
  }

  // Manual gzip decompression fallback using Response + Blob
  // This works in browsers that have Response but not DecompressionStream
  try {
    const blob = new Blob([data]);
    const ds = new Response(blob.stream().pipeThrough(new DecompressionStream('gzip')));
    const ab = await ds.arrayBuffer();
    return new Uint8Array(ab);
  } catch {
    throw new Error(
      'Gzip decompression is not supported in this environment. ' +
      'DecompressionStream API is required.',
    );
  }
}

/**
 * Extract files from a tar archive buffer into the VFS.
 */
async function extractTar(
  tarData: Uint8Array,
  targetPath: string,
  vfs: VFS,
): Promise<void> {
  // Ensure target directory exists
  await ensureDir(vfs, targetPath);

  let offset = 0;

  while (offset + TAR.BLOCK_SIZE <= tarData.length) {
    // Check for end-of-archive (two consecutive zero blocks)
    if (isZeroBlock(tarData, offset)) {
      if (
        offset + TAR.BLOCK_SIZE * 2 <= tarData.length &&
        isZeroBlock(tarData, offset + TAR.BLOCK_SIZE)
      ) {
        break; // End of archive
      }
      offset += TAR.BLOCK_SIZE;
      continue;
    }

    const entry = parseHeader(tarData, offset);
    if (!entry) {
      offset += TAR.BLOCK_SIZE;
      continue;
    }

    offset += TAR.BLOCK_SIZE;

    // Strip the "package/" prefix that npm tarballs use
    let entryName = stripPackagePrefix(entry.name);
    if (!entryName) {
      // Skip if the entry is just the "package/" directory itself
      offset += alignToBlock(entry.size);
      continue;
    }

    const fullPath = joinPath(targetPath, entryName);

    switch (entry.type) {
      case TYPE_FILE:
      case TYPE_FILE_ALT: {
        // Ensure parent directory exists
        const parentDir = getParentPath(fullPath);
        if (parentDir) {
          await ensureDir(vfs, parentDir);
        }

        // Extract file data
        const fileData = tarData.slice(offset, offset + entry.size);
        vfs.writeFile(fullPath, fileData);
        break;
      }

      case TYPE_DIRECTORY: {
        await ensureDir(vfs, fullPath);
        break;
      }

      case TYPE_SYMLINK: {
        if (entry.linkTarget) {
          const parentDir = getParentPath(fullPath);
          if (parentDir) {
            await ensureDir(vfs, parentDir);
          }
          try {
            vfs.symlink(entry.linkTarget, fullPath);
          } catch {
            // Symlink creation may fail if the target does not exist yet;
            // this is acceptable for npm packages
          }
        }
        break;
      }

      default:
        // Skip other entry types (hard links, etc.)
        break;
    }

    offset += alignToBlock(entry.size);
  }
}

/**
 * Parse a tar header block.
 */
function parseHeader(data: Uint8Array, offset: number): TarEntry | null {
  // Read name (may be extended by prefix field)
  const prefix = readString(data, offset + TAR.PREFIX_OFFSET, TAR.PREFIX_LENGTH);
  let name = readString(data, offset + TAR.NAME_OFFSET, TAR.NAME_LENGTH);

  if (prefix) {
    name = `${prefix}/${name}`;
  }

  if (!name) return null;

  const mode = readOctal(data, offset + TAR.MODE_OFFSET, TAR.MODE_LENGTH);
  const size = readOctal(data, offset + TAR.SIZE_OFFSET, TAR.SIZE_LENGTH);
  const typeChar = String.fromCharCode(data[offset + TAR.TYPE_OFFSET]);

  // Read link target for symlinks (offset 157, length 100)
  const linkTarget =
    typeChar === TYPE_SYMLINK
      ? readString(data, offset + 157, 100)
      : undefined;

  return {
    name,
    mode,
    size,
    type: typeChar,
    linkTarget,
  };
}

/**
 * Read a null-terminated ASCII string from a buffer.
 */
function readString(data: Uint8Array, offset: number, length: number): string {
  let end = offset + length;
  // Find null terminator
  for (let i = offset; i < end; i++) {
    if (data[i] === 0) {
      end = i;
      break;
    }
  }
  const bytes = data.slice(offset, end);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

/**
 * Read an octal number from a tar header field.
 */
function readOctal(data: Uint8Array, offset: number, length: number): number {
  const str = readString(data, offset, length).trim();
  if (!str) return 0;
  return parseInt(str, 8) || 0;
}

/**
 * Check if a 512-byte block is all zeros (end-of-archive marker).
 */
function isZeroBlock(data: Uint8Array, offset: number): boolean {
  for (let i = 0; i < TAR.BLOCK_SIZE; i++) {
    if (data[offset + i] !== 0) return false;
  }
  return true;
}

/**
 * Align a byte size to the next 512-byte block boundary.
 */
function alignToBlock(size: number): number {
  const remainder = size % TAR.BLOCK_SIZE;
  return remainder === 0 ? size : size + (TAR.BLOCK_SIZE - remainder);
}

/**
 * Strip the "package/" prefix from tar entry names.
 * npm tarballs always have entries prefixed with "package/".
 */
function stripPackagePrefix(name: string): string {
  // Handle "package/..." prefix
  if (name.startsWith('package/')) {
    return name.slice(8);
  }
  // Some packages use the package name as prefix
  const firstSlash = name.indexOf('/');
  if (firstSlash >= 0) {
    return name.slice(firstSlash + 1);
  }
  return name;
}

/**
 * Join two path segments.
 */
function joinPath(base: string, relative: string): string {
  if (base.endsWith('/')) {
    return base + relative;
  }
  return `${base}/${relative}`;
}

/**
 * Get the parent directory of a path.
 */
function getParentPath(path: string): string | null {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  return path.slice(0, lastSlash);
}

/**
 * Ensure a directory exists, creating parent directories as needed.
 */
async function ensureDir(vfs: VFS, path: string): Promise<void> {
  if (vfs.exists(path)) return;
  vfs.mkdir(path, { recursive: true });
}

/**
 * Collect a ReadableStream into a single Uint8Array.
 */
async function streamToUint8Array(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalSize += value.length;
  }

  return concatUint8Arrays(chunks, totalSize);
}

/**
 * Concatenate multiple Uint8Arrays into one.
 */
function concatUint8Arrays(arrays: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
