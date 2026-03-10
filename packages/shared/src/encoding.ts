const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodePayload(
  sab: SharedArrayBuffer,
  offset: number,
  metadata: Record<string, unknown>,
  binaryData?: Uint8Array
): number {
  const view = new DataView(sab);
  const metaStr = JSON.stringify(metadata);
  const metaBytes = encoder.encode(metaStr);

  view.setUint32(offset, metaBytes.length, true);
  const arr = new Uint8Array(sab);
  arr.set(metaBytes, offset + 4);

  let totalLength = 4 + metaBytes.length;

  if (binaryData && binaryData.length > 0) {
    view.setUint32(offset + 4 + metaBytes.length, binaryData.length, true);
    arr.set(binaryData, offset + 4 + metaBytes.length + 4);
    totalLength += 4 + binaryData.length;
  }

  return totalLength;
}

export function decodePayload(
  sab: SharedArrayBuffer,
  offset: number
): { metadata: Record<string, unknown>; binaryData: Uint8Array | null } {
  const view = new DataView(sab);
  const arr = new Uint8Array(sab);

  const metaLength = view.getUint32(offset, true);
  const metaBytes = arr.slice(offset + 4, offset + 4 + metaLength);
  const metadata = JSON.parse(decoder.decode(metaBytes));

  let binaryData: Uint8Array | null = null;
  const binaryOffset = offset + 4 + metaLength;

  if (binaryOffset + 4 <= sab.byteLength) {
    const binLength = view.getUint32(binaryOffset, true);
    if (binLength > 0 && binLength < sab.byteLength - binaryOffset - 4) {
      binaryData = arr.slice(binaryOffset + 4, binaryOffset + 4 + binLength);
    }
  }

  return { metadata, binaryData };
}

export function encodeString(str: string): Uint8Array {
  return encoder.encode(str);
}

export function decodeString(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
