/**
 * Buffer class for browser environment, extending Uint8Array.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += BASE64_CHARS[(b0 >> 2) & 0x3f];
    result += BASE64_CHARS[((b0 << 4) | (b1 >> 4)) & 0x3f];
    result += i + 1 < len ? BASE64_CHARS[((b1 << 2) | (b2 >> 6)) & 0x3f] : '=';
    result += i + 2 < len ? BASE64_CHARS[b2 & 0x3f] : '=';
  }
  return result;
}

function base64Decode(str: string): Uint8Array {
  const cleaned = str.replace(/[^A-Za-z0-9+/=]/g, '');
  const padded = cleaned.replace(/=+$/, '');
  const byteLen = (padded.length * 3) / 4;
  const bytes = new Uint8Array(Math.floor(byteLen));

  const lookup = new Uint8Array(128);
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    lookup[BASE64_CHARS.charCodeAt(i)] = i;
  }

  let j = 0;
  for (let i = 0; i < padded.length; i += 4) {
    const a = lookup[padded.charCodeAt(i)] || 0;
    const b = lookup[padded.charCodeAt(i + 1)] || 0;
    const c = lookup[padded.charCodeAt(i + 2)] || 0;
    const d = lookup[padded.charCodeAt(i + 3)] || 0;

    bytes[j++] = (a << 2) | (b >> 4);
    if (i + 2 < padded.length) bytes[j++] = ((b << 4) | (c >> 2)) & 0xff;
    if (i + 3 < padded.length) bytes[j++] = ((c << 6) | d) & 0xff;
  }

  return bytes.slice(0, j);
}

function hexEncode(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += bytes[i].toString(16).padStart(2, '0');
  }
  return result;
}

function hexDecode(str: string): Uint8Array {
  const len = str.length >> 1;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(str.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function latin1Encode(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function latin1Decode(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

function asciiEncode(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0x7f;
  }
  return bytes;
}

function asciiDecode(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i] & 0x7f);
  }
  return result;
}

type BufferEncoding = 'utf8' | 'utf-8' | 'ascii' | 'hex' | 'base64' | 'latin1' | 'binary' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le';

function normalizeEncoding(enc?: string): BufferEncoding {
  if (!enc || enc === 'utf8' || enc === 'utf-8') return 'utf8';
  const lower = enc.toLowerCase();
  switch (lower) {
    case 'utf8':
    case 'utf-8':
      return 'utf8';
    case 'ascii':
      return 'ascii';
    case 'hex':
      return 'hex';
    case 'base64':
      return 'base64';
    case 'latin1':
    case 'binary':
      return 'latin1';
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return 'utf16le';
    default:
      throw new TypeError(`Unknown encoding: ${enc}`);
  }
}

function encodeString(str: string, encoding: BufferEncoding): Uint8Array {
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return textEncoder.encode(str);
    case 'ascii':
      return asciiEncode(str);
    case 'hex':
      return hexDecode(str);
    case 'base64':
      return base64Decode(str);
    case 'latin1':
    case 'binary':
      return latin1Encode(str);
    default:
      return textEncoder.encode(str);
  }
}

function decodeBytes(bytes: Uint8Array, encoding: BufferEncoding): string {
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return textDecoder.decode(bytes);
    case 'ascii':
      return asciiDecode(bytes);
    case 'hex':
      return hexEncode(bytes);
    case 'base64':
      return base64Encode(bytes);
    case 'latin1':
    case 'binary':
      return latin1Decode(bytes);
    default:
      return textDecoder.decode(bytes);
  }
}

export class Buffer extends Uint8Array {
  /**
   * Creates a Buffer from various inputs.
   */
  static from(
    value: string | ArrayBuffer | Uint8Array | ArrayLike<number> | Buffer,
    encodingOrOffset?: string | number,
    length?: number
  ): Buffer {
    if (typeof value === 'string') {
      const encoding = normalizeEncoding(encodingOrOffset as string | undefined);
      const bytes = encodeString(value, encoding);
      const buf = new Buffer(bytes.length);
      buf.set(bytes);
      return buf;
    }

    if (value instanceof ArrayBuffer) {
      const offset = (encodingOrOffset as number) || 0;
      const len = length !== undefined ? length : value.byteLength - offset;
      const view = new Uint8Array(value, offset, len);
      const buf = new Buffer(len);
      buf.set(view);
      return buf;
    }

    if (value instanceof Uint8Array || value instanceof Buffer) {
      const buf = new Buffer(value.length);
      buf.set(value);
      return buf;
    }

    if (Array.isArray(value) || (typeof value === 'object' && value !== null && 'length' in value)) {
      const arr = value as ArrayLike<number>;
      const buf = new Buffer(arr.length);
      for (let i = 0; i < arr.length; i++) {
        buf[i] = arr[i] & 0xff;
      }
      return buf;
    }

    throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object');
  }

  static alloc(size: number, fill?: number | string | Uint8Array, encoding?: string): Buffer {
    if (size < 0) throw new RangeError('Buffer size must not be negative');
    const buf = new Buffer(size);
    if (fill !== undefined) {
      buf.fill(fill as number, 0, size, encoding);
    }
    return buf;
  }

  static allocUnsafe(size: number): Buffer {
    if (size < 0) throw new RangeError('Buffer size must not be negative');
    return new Buffer(size);
  }

  static concat(list: (Uint8Array | Buffer)[], totalLength?: number): Buffer {
    if (list.length === 0) return Buffer.alloc(0);

    const total = totalLength ?? list.reduce((sum, buf) => sum + buf.length, 0);
    const result = Buffer.alloc(total);
    let offset = 0;

    for (const buf of list) {
      const toCopy = Math.min(buf.length, total - offset);
      if (toCopy <= 0) break;
      result.set(buf.subarray(0, toCopy), offset);
      offset += toCopy;
    }

    return result;
  }

  static isBuffer(obj: unknown): obj is Buffer {
    return obj instanceof Buffer;
  }

  static byteLength(str: string | Uint8Array, encoding?: string): number {
    if (typeof str !== 'string') return str.length;
    const enc = normalizeEncoding(encoding);
    return encodeString(str, enc).length;
  }

  static isEncoding(encoding: string): boolean {
    try {
      normalizeEncoding(encoding);
      return true;
    } catch {
      return false;
    }
  }

  static compare(a: Buffer, b: Buffer): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return 0;
  }

  toString(encoding?: string, start?: number, end?: number): string {
    const enc = normalizeEncoding(encoding);
    const s = start ?? 0;
    const e = end ?? this.length;
    const slice = this.subarray(s, e);
    return decodeBytes(slice, enc);
  }

  write(str: string, offset?: number, length?: number, encoding?: string): number {
    let off = offset ?? 0;
    let enc: BufferEncoding;

    if (typeof offset === 'string') {
      enc = normalizeEncoding(offset);
      off = 0;
    } else if (typeof length === 'string') {
      enc = normalizeEncoding(length);
      length = undefined;
    } else {
      enc = normalizeEncoding(encoding);
    }

    const bytes = encodeString(str, enc);
    const maxLen = Math.min(length ?? (this.length - off), this.length - off, bytes.length);
    this.set(bytes.subarray(0, maxLen), off);
    return maxLen;
  }

  slice(start?: number, end?: number): Buffer {
    const sliced = super.slice(start, end);
    const buf = new Buffer(sliced.length);
    buf.set(sliced);
    return buf;
  }

  copy(target: Buffer | Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number {
    const tStart = targetStart ?? 0;
    const sStart = sourceStart ?? 0;
    const sEnd = sourceEnd ?? this.length;

    const toCopy = Math.min(sEnd - sStart, target.length - tStart);
    if (toCopy <= 0) return 0;

    target.set(this.subarray(sStart, sStart + toCopy), tStart);
    return toCopy;
  }

  equals(other: Buffer | Uint8Array): boolean {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) {
      if (this[i] !== other[i]) return false;
    }
    return true;
  }

  compare(target: Buffer | Uint8Array, targetStart?: number, targetEnd?: number, sourceStart?: number, sourceEnd?: number): number {
    const tStart = targetStart ?? 0;
    const tEnd = targetEnd ?? target.length;
    const sStart = sourceStart ?? 0;
    const sEnd = sourceEnd ?? this.length;

    const source = this.subarray(sStart, sEnd);
    const tgt = target.subarray ? target.subarray(tStart, tEnd) : new Uint8Array(target).subarray(tStart, tEnd);

    const len = Math.min(source.length, tgt.length);
    for (let i = 0; i < len; i++) {
      if (source[i] !== tgt[i]) return source[i] < tgt[i] ? -1 : 1;
    }
    if (source.length !== tgt.length) return source.length < tgt.length ? -1 : 1;
    return 0;
  }

  indexOf(value: number | string | Uint8Array, byteOffset?: number, encoding?: string): number {
    const offset = byteOffset ?? 0;

    if (typeof value === 'number') {
      for (let i = offset; i < this.length; i++) {
        if (this[i] === (value & 0xff)) return i;
      }
      return -1;
    }

    let needle: Uint8Array;
    if (typeof value === 'string') {
      const enc = normalizeEncoding(encoding);
      needle = encodeString(value, enc);
    } else {
      needle = value;
    }

    if (needle.length === 0) return offset;
    if (needle.length > this.length - offset) return -1;

    outer: for (let i = offset; i <= this.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (this[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  fill(value: number | string | Uint8Array, offset?: number, end?: number, encoding?: string): this {
    let off = offset ?? 0;
    let e = end ?? this.length;

    if (typeof value === 'number') {
      for (let i = off; i < e; i++) {
        this[i] = value & 0xff;
      }
    } else if (typeof value === 'string') {
      const enc = normalizeEncoding(encoding);
      const bytes = encodeString(value, enc);
      if (bytes.length === 0) return this;
      for (let i = off; i < e; i++) {
        this[i] = bytes[(i - off) % bytes.length];
      }
    } else {
      if (value.length === 0) return this;
      for (let i = off; i < e; i++) {
        this[i] = value[(i - off) % value.length];
      }
    }
    return this;
  }

  toJSON(): { type: 'Buffer'; data: number[] } {
    return {
      type: 'Buffer',
      data: Array.from(this),
    };
  }

  get [Symbol.toStringTag](): string {
    return 'Buffer';
  }
}

export default { Buffer };
