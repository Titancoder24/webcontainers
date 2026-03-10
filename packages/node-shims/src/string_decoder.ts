/**
 * StringDecoder shim for browser environment.
 * Handles multi-byte character boundaries for utf8, base64, and hex.
 */

import { Buffer } from './buffer.js';

export class StringDecoder {
  readonly encoding: string;
  private _lastNeed: number = 0;
  private _lastTotal: number = 0;
  private _lastChar: Buffer;
  private _decoder: TextDecoder | null = null;

  constructor(encoding?: string) {
    this.encoding = normalizeEncoding(encoding || 'utf8');

    switch (this.encoding) {
      case 'utf8':
        this._lastChar = Buffer.alloc(4);
        this._decoder = new TextDecoder('utf-8');
        break;
      case 'base64':
        this._lastChar = Buffer.alloc(3);
        break;
      case 'hex':
        this._lastChar = Buffer.alloc(0);
        break;
      default:
        this._lastChar = Buffer.alloc(0);
        break;
    }
  }

  write(buf: Buffer | Uint8Array): string {
    if (!(buf instanceof Buffer)) {
      buf = Buffer.from(buf);
    }

    if (buf.length === 0) return '';

    switch (this.encoding) {
      case 'utf8':
        return this._writeUtf8(buf as Buffer);
      case 'base64':
        return this._writeBase64(buf as Buffer);
      case 'hex':
        return this._writeHex(buf as Buffer);
      case 'ascii':
        return (buf as Buffer).toString('ascii');
      case 'latin1':
        return (buf as Buffer).toString('latin1');
      default:
        return (buf as Buffer).toString(this.encoding);
    }
  }

  end(buf?: Buffer | Uint8Array): string {
    let result = '';
    if (buf && buf.length > 0) {
      result = this.write(buf);
    }

    if (this._lastNeed > 0) {
      // Incomplete character at the end - emit replacement
      switch (this.encoding) {
        case 'utf8':
          result += '\ufffd';
          break;
        case 'base64':
          result += Buffer.from(this._lastChar.subarray(0, this._lastTotal - this._lastNeed)).toString('base64');
          break;
      }
      this._lastNeed = 0;
      this._lastTotal = 0;
    }

    return result;
  }

  private _writeUtf8(buf: Buffer): string {
    let result = '';

    // If there's a pending incomplete character, try to complete it
    let offset = 0;
    if (this._lastNeed > 0) {
      const available = Math.min(this._lastNeed, buf.length);
      buf.copy(this._lastChar, this._lastTotal - this._lastNeed, 0, available);
      this._lastNeed -= available;
      offset = available;

      if (this._lastNeed > 0) {
        // Still not complete
        return '';
      }

      // Complete - decode the character
      result += this._lastChar.slice(0, this._lastTotal).toString('utf8');
    }

    if (offset >= buf.length) return result;

    // Find the last complete character boundary
    const remaining = buf.length - offset;
    let end = buf.length;

    // Check if the last bytes form an incomplete UTF-8 sequence
    const lastByte = buf[buf.length - 1];
    if (lastByte >= 0x80) {
      // Find the start of the last multi-byte sequence
      let seqStart = buf.length - 1;
      while (seqStart > offset && (buf[seqStart] & 0xC0) === 0x80) {
        seqStart--;
      }

      if (seqStart >= offset) {
        let expectedLen = 1;
        const lead = buf[seqStart];
        if ((lead & 0xE0) === 0xC0) expectedLen = 2;
        else if ((lead & 0xF0) === 0xE0) expectedLen = 3;
        else if ((lead & 0xF8) === 0xF0) expectedLen = 4;

        const actualLen = buf.length - seqStart;
        if (actualLen < expectedLen) {
          // Incomplete sequence at the end
          this._lastTotal = expectedLen;
          this._lastNeed = expectedLen - actualLen;
          buf.copy(this._lastChar, 0, seqStart, buf.length);
          end = seqStart;
        }
      }
    }

    if (end > offset) {
      result += buf.slice(offset, end).toString('utf8');
    }

    return result;
  }

  private _writeBase64(buf: Buffer): string {
    let result = '';
    let offset = 0;

    // If there's a pending incomplete group, try to complete it
    if (this._lastNeed > 0) {
      const available = Math.min(this._lastNeed, buf.length);
      buf.copy(this._lastChar, this._lastTotal - this._lastNeed, 0, available);
      this._lastNeed -= available;
      offset = available;

      if (this._lastNeed > 0) {
        return '';
      }

      result += this._lastChar.slice(0, this._lastTotal).toString('base64');
    }

    const remaining = buf.length - offset;
    const completeGroups = Math.floor(remaining / 3) * 3;

    if (completeGroups > 0) {
      result += buf.slice(offset, offset + completeGroups).toString('base64');
    }

    const leftover = remaining - completeGroups;
    if (leftover > 0) {
      this._lastTotal = 3;
      this._lastNeed = 3 - leftover;
      buf.copy(this._lastChar, 0, offset + completeGroups, buf.length);
    }

    return result;
  }

  private _writeHex(buf: Buffer): string {
    let result = '';
    let offset = 0;

    // If there's an odd byte from previous write
    if (this._lastNeed > 0) {
      if (buf.length > 0) {
        // We had half a hex pair; not applicable for hex encoding since each byte = 2 hex chars
        this._lastNeed = 0;
      }
    }

    result += buf.slice(offset).toString('hex');
    return result;
  }
}

function normalizeEncoding(encoding: string): string {
  const lower = encoding.toLowerCase();
  switch (lower) {
    case 'utf8':
    case 'utf-8':
      return 'utf8';
    case 'base64':
      return 'base64';
    case 'hex':
      return 'hex';
    case 'ascii':
      return 'ascii';
    case 'latin1':
    case 'binary':
      return 'latin1';
    default:
      return lower;
  }
}

export default { StringDecoder };
