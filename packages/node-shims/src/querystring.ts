/**
 * Querystring module shim for browser environment.
 */

export function parse(
  str: string,
  sep?: string,
  eq?: string,
  options?: { maxKeys?: number; decodeURIComponent?: (str: string) => string }
): Record<string, string | string[]> {
  const separator = sep || '&';
  const equals = eq || '=';
  const decode = options?.decodeURIComponent || _decodeURIComponent;
  const maxKeys = options?.maxKeys ?? 1000;

  const result: Record<string, string | string[]> = {};
  if (typeof str !== 'string' || str.length === 0) return result;

  const pairs = str.split(separator);
  const limit = maxKeys > 0 ? Math.min(pairs.length, maxKeys) : pairs.length;

  for (let i = 0; i < limit; i++) {
    const pair = pairs[i];
    const eqIdx = pair.indexOf(equals);

    let key: string;
    let value: string;

    if (eqIdx !== -1) {
      key = decode(pair.slice(0, eqIdx));
      value = decode(pair.slice(eqIdx + equals.length));
    } else {
      key = decode(pair);
      value = '';
    }

    if (key in result) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function stringify(
  obj: Record<string, unknown>,
  sep?: string,
  eq?: string,
  options?: { encodeURIComponent?: (str: string) => string }
): string {
  const separator = sep || '&';
  const equals = eq || '=';
  const encode = options?.encodeURIComponent || _encodeURIComponent;

  if (obj === null || typeof obj !== 'object') return '';

  const pairs: string[] = [];

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const encodedKey = encode(key);

    if (Array.isArray(value)) {
      for (const item of value) {
        pairs.push(encodedKey + equals + encode(String(item)));
      }
    } else if (value === undefined) {
      pairs.push(encodedKey + equals);
    } else {
      pairs.push(encodedKey + equals + encode(String(value)));
    }
  }

  return pairs.join(separator);
}

function _decodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str.replace(/\+/g, ' '));
  } catch {
    return str;
  }
}

function _encodeURIComponent(str: string): string {
  return encodeURIComponent(str)
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export const escape = _encodeURIComponent;
export const unescape = _decodeURIComponent;
export const decode = parse;
export const encode = stringify;

export default {
  parse,
  stringify,
  escape: _encodeURIComponent,
  unescape: _decodeURIComponent,
  decode: parse,
  encode: stringify,
};
