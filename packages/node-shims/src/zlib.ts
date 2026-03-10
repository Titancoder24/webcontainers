/**
 * Zlib shim using CompressionStream/DecompressionStream APIs.
 */

import { Buffer } from './buffer.js';
import { Transform } from './stream.js';

async function compressData(data: Uint8Array, format: CompressionFormat): Promise<Buffer> {
  const stream = new CompressionStream(format);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  writer.write(data);
  writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return Buffer.from(result);
}

async function decompressData(data: Uint8Array, format: CompressionFormat): Promise<Buffer> {
  const stream = new DecompressionStream(format);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  writer.write(data);
  writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return Buffer.from(result);
}

// --- Callback-style APIs ---

export function gzip(data: string | Buffer | Uint8Array, callback: (error: Error | null, result: Buffer) => void): void;
export function gzip(data: string | Buffer | Uint8Array, options: Record<string, unknown>, callback: (error: Error | null, result: Buffer) => void): void;
export function gzip(
  data: string | Buffer | Uint8Array,
  optionsOrCallback: Record<string, unknown> | ((error: Error | null, result: Buffer) => void),
  callback?: (error: Error | null, result: Buffer) => void
): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  const input = typeof data === 'string' ? Buffer.from(data) : data;

  compressData(input, 'gzip')
    .then((result) => cb(null, result))
    .catch((err) => cb(err instanceof Error ? err : new Error(String(err)), Buffer.alloc(0)));
}

export function gunzip(data: Buffer | Uint8Array, callback: (error: Error | null, result: Buffer) => void): void;
export function gunzip(data: Buffer | Uint8Array, options: Record<string, unknown>, callback: (error: Error | null, result: Buffer) => void): void;
export function gunzip(
  data: Buffer | Uint8Array,
  optionsOrCallback: Record<string, unknown> | ((error: Error | null, result: Buffer) => void),
  callback?: (error: Error | null, result: Buffer) => void
): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;

  decompressData(data, 'gzip')
    .then((result) => cb(null, result))
    .catch((err) => cb(err instanceof Error ? err : new Error(String(err)), Buffer.alloc(0)));
}

export function deflate(data: string | Buffer | Uint8Array, callback: (error: Error | null, result: Buffer) => void): void;
export function deflate(data: string | Buffer | Uint8Array, options: Record<string, unknown>, callback: (error: Error | null, result: Buffer) => void): void;
export function deflate(
  data: string | Buffer | Uint8Array,
  optionsOrCallback: Record<string, unknown> | ((error: Error | null, result: Buffer) => void),
  callback?: (error: Error | null, result: Buffer) => void
): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  const input = typeof data === 'string' ? Buffer.from(data) : data;

  compressData(input, 'deflate')
    .then((result) => cb(null, result))
    .catch((err) => cb(err instanceof Error ? err : new Error(String(err)), Buffer.alloc(0)));
}

export function inflate(data: Buffer | Uint8Array, callback: (error: Error | null, result: Buffer) => void): void;
export function inflate(data: Buffer | Uint8Array, options: Record<string, unknown>, callback: (error: Error | null, result: Buffer) => void): void;
export function inflate(
  data: Buffer | Uint8Array,
  optionsOrCallback: Record<string, unknown> | ((error: Error | null, result: Buffer) => void),
  callback?: (error: Error | null, result: Buffer) => void
): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;

  decompressData(data, 'deflate')
    .then((result) => cb(null, result))
    .catch((err) => cb(err instanceof Error ? err : new Error(String(err)), Buffer.alloc(0)));
}

export function deflateRaw(data: string | Buffer | Uint8Array, callback: (error: Error | null, result: Buffer) => void): void;
export function deflateRaw(data: string | Buffer | Uint8Array, options: Record<string, unknown>, callback: (error: Error | null, result: Buffer) => void): void;
export function deflateRaw(
  data: string | Buffer | Uint8Array,
  optionsOrCallback: Record<string, unknown> | ((error: Error | null, result: Buffer) => void),
  callback?: (error: Error | null, result: Buffer) => void
): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  const input = typeof data === 'string' ? Buffer.from(data) : data;

  compressData(input, 'deflate-raw')
    .then((result) => cb(null, result))
    .catch((err) => cb(err instanceof Error ? err : new Error(String(err)), Buffer.alloc(0)));
}

export function inflateRaw(data: Buffer | Uint8Array, callback: (error: Error | null, result: Buffer) => void): void;
export function inflateRaw(data: Buffer | Uint8Array, options: Record<string, unknown>, callback: (error: Error | null, result: Buffer) => void): void;
export function inflateRaw(
  data: Buffer | Uint8Array,
  optionsOrCallback: Record<string, unknown> | ((error: Error | null, result: Buffer) => void),
  callback?: (error: Error | null, result: Buffer) => void
): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;

  decompressData(data, 'deflate-raw')
    .then((result) => cb(null, result))
    .catch((err) => cb(err instanceof Error ? err : new Error(String(err)), Buffer.alloc(0)));
}

// --- Sync APIs (not supported in browser, throw informative errors) ---

export function gzipSync(_data: string | Buffer | Uint8Array): Buffer {
  throw new Error('Synchronous compression is not supported in the browser environment. Use the async gzip() instead.');
}

export function gunzipSync(_data: Buffer | Uint8Array): Buffer {
  throw new Error('Synchronous decompression is not supported in the browser environment. Use the async gunzip() instead.');
}

export function deflateSync(_data: string | Buffer | Uint8Array): Buffer {
  throw new Error('Synchronous compression is not supported in the browser environment. Use the async deflate() instead.');
}

export function inflateSync(_data: Buffer | Uint8Array): Buffer {
  throw new Error('Synchronous decompression is not supported in the browser environment. Use the async inflate() instead.');
}

// --- Stream-style APIs ---

export class Gzip extends Transform {
  private _chunks: Uint8Array[] = [];

  constructor() {
    super({
      transform: (chunk: Buffer | string, _encoding: string, callback: (error?: Error | null, data?: Buffer | string) => void) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        this._chunks.push(buf instanceof Buffer ? buf : Buffer.from(buf));
        callback();
      },
      flush: (callback: (error?: Error | null, data?: Buffer | string) => void) => {
        const total = this._chunks.reduce((s, c) => s + c.length, 0);
        const combined = new Uint8Array(total);
        let off = 0;
        for (const c of this._chunks) {
          combined.set(c, off);
          off += c.length;
        }
        compressData(combined, 'gzip')
          .then((result) => callback(null, result))
          .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
      },
    });
  }
}

export class Gunzip extends Transform {
  private _chunks: Uint8Array[] = [];

  constructor() {
    super({
      transform: (chunk: Buffer | string, _encoding: string, callback: (error?: Error | null, data?: Buffer | string) => void) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        this._chunks.push(buf instanceof Buffer ? buf : Buffer.from(buf));
        callback();
      },
      flush: (callback: (error?: Error | null, data?: Buffer | string) => void) => {
        const total = this._chunks.reduce((s, c) => s + c.length, 0);
        const combined = new Uint8Array(total);
        let off = 0;
        for (const c of this._chunks) {
          combined.set(c, off);
          off += c.length;
        }
        decompressData(combined, 'gzip')
          .then((result) => callback(null, result))
          .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
      },
    });
  }
}

export class Deflate extends Transform {
  private _chunks: Uint8Array[] = [];

  constructor() {
    super({
      transform: (chunk: Buffer | string, _encoding: string, callback: (error?: Error | null, data?: Buffer | string) => void) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        this._chunks.push(buf instanceof Buffer ? buf : Buffer.from(buf));
        callback();
      },
      flush: (callback: (error?: Error | null, data?: Buffer | string) => void) => {
        const total = this._chunks.reduce((s, c) => s + c.length, 0);
        const combined = new Uint8Array(total);
        let off = 0;
        for (const c of this._chunks) {
          combined.set(c, off);
          off += c.length;
        }
        compressData(combined, 'deflate')
          .then((result) => callback(null, result))
          .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
      },
    });
  }
}

export class Inflate extends Transform {
  private _chunks: Uint8Array[] = [];

  constructor() {
    super({
      transform: (chunk: Buffer | string, _encoding: string, callback: (error?: Error | null, data?: Buffer | string) => void) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        this._chunks.push(buf instanceof Buffer ? buf : Buffer.from(buf));
        callback();
      },
      flush: (callback: (error?: Error | null, data?: Buffer | string) => void) => {
        const total = this._chunks.reduce((s, c) => s + c.length, 0);
        const combined = new Uint8Array(total);
        let off = 0;
        for (const c of this._chunks) {
          combined.set(c, off);
          off += c.length;
        }
        decompressData(combined, 'deflate')
          .then((result) => callback(null, result))
          .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
      },
    });
  }
}

export function createGzip(): Gzip {
  return new Gzip();
}

export function createGunzip(): Gunzip {
  return new Gunzip();
}

export function createDeflate(): Deflate {
  return new Deflate();
}

export function createInflate(): Inflate {
  return new Inflate();
}

// Constants
export const constants = {
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_DEFLATED: 8,
  Z_DEFAULT_STRATEGY: 0,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
};

export default {
  gzip,
  gunzip,
  deflate,
  inflate,
  deflateRaw,
  inflateRaw,
  gzipSync,
  gunzipSync,
  deflateSync,
  inflateSync,
  Gzip,
  Gunzip,
  Deflate,
  Inflate,
  createGzip,
  createGunzip,
  createDeflate,
  createInflate,
  constants,
};
