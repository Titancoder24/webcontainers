import { describe, it, expect } from 'vitest';
import { encodePayload, decodePayload, encodeString, decodeString } from '../src/encoding.js';
import { SAB_PAYLOAD_OFFSET, SAB_SIZE } from '../src/constants.js';

describe('encoding', () => {
  it('should encode and decode a simple metadata payload', () => {
    const sab = new SharedArrayBuffer(SAB_SIZE);
    const metadata = { type: 1, path: '/test/file.txt' };

    const length = encodePayload(sab, SAB_PAYLOAD_OFFSET, metadata);
    expect(length).toBeGreaterThan(0);

    const decoded = decodePayload(sab, SAB_PAYLOAD_OFFSET);
    expect(decoded.metadata).toEqual(metadata);
    expect(decoded.binaryData).toBeNull();
  });

  it('should encode and decode payload with binary data', () => {
    const sab = new SharedArrayBuffer(SAB_SIZE);
    const metadata = { type: 2, path: '/test/data.bin' };
    const binaryData = new Uint8Array([1, 2, 3, 4, 5, 72, 101, 108, 108, 111]);

    const length = encodePayload(sab, SAB_PAYLOAD_OFFSET, metadata, binaryData);
    expect(length).toBeGreaterThan(0);

    const decoded = decodePayload(sab, SAB_PAYLOAD_OFFSET);
    expect(decoded.metadata).toEqual(metadata);
    expect(decoded.binaryData).not.toBeNull();
    expect(Array.from(decoded.binaryData!)).toEqual([1, 2, 3, 4, 5, 72, 101, 108, 108, 111]);
  });

  it('should handle empty metadata', () => {
    const sab = new SharedArrayBuffer(SAB_SIZE);
    const metadata = {};

    encodePayload(sab, SAB_PAYLOAD_OFFSET, metadata);
    const decoded = decodePayload(sab, SAB_PAYLOAD_OFFSET);
    expect(decoded.metadata).toEqual({});
  });

  it('should handle large metadata payloads', () => {
    const sab = new SharedArrayBuffer(SAB_SIZE);
    const metadata: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      metadata[`key_${i}`] = `value_${i}_${'x'.repeat(50)}`;
    }

    const length = encodePayload(sab, SAB_PAYLOAD_OFFSET, metadata);
    expect(length).toBeGreaterThan(0);

    const decoded = decodePayload(sab, SAB_PAYLOAD_OFFSET);
    expect(decoded.metadata).toEqual(metadata);
  });

  it('should encode and decode strings', () => {
    const original = 'Hello, World! 日本語テスト';
    const encoded = encodeString(original);
    const decoded = decodeString(encoded);
    expect(decoded).toBe(original);
  });

  it('should handle unicode in metadata', () => {
    const sab = new SharedArrayBuffer(SAB_SIZE);
    const metadata = { path: '/home/ユーザー/ファイル.txt', emoji: '🎉' };

    encodePayload(sab, SAB_PAYLOAD_OFFSET, metadata);
    const decoded = decodePayload(sab, SAB_PAYLOAD_OFFSET);
    expect(decoded.metadata).toEqual(metadata);
  });
});
