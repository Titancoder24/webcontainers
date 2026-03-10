/**
 * Utility functions shim for browser environment.
 */

type AnyFunction = (...args: unknown[]) => unknown;

/**
 * Converts a callback-style function to return a Promise.
 */
export function promisify<T extends AnyFunction>(fn: T): (...args: unknown[]) => Promise<unknown> {
  if (typeof fn !== 'function') {
    throw new TypeError('The "original" argument must be of type Function');
  }

  return function (this: unknown, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err: unknown, ...results: unknown[]) => {
        if (err) {
          reject(err);
        } else if (results.length <= 1) {
          resolve(results[0]);
        } else {
          resolve(results);
        }
      });
    });
  };
}

/**
 * Inherits prototype methods from one constructor into another.
 */
export function inherits(ctor: AnyFunction, superCtor: AnyFunction): void {
  if (typeof ctor !== 'function') {
    throw new TypeError('The "ctor" argument must be of type Function');
  }
  if (typeof superCtor !== 'function') {
    throw new TypeError('The "superCtor" argument must be of type Function');
  }

  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  (ctor as unknown as { super_: AnyFunction }).super_ = superCtor;
}

/**
 * Printf-like string formatting.
 */
export function format(fmt: unknown, ...args: unknown[]): string {
  if (typeof fmt !== 'string') {
    const parts: string[] = [];
    parts.push(inspect(fmt));
    for (const arg of args) {
      parts.push(inspect(arg));
    }
    return parts.join(' ');
  }

  let i = 0;
  let result = fmt.replace(/%[sdifjoO%]/g, (match: string) => {
    if (match === '%%') return '%';
    if (i >= args.length) return match;
    const arg = args[i++];
    switch (match) {
      case '%s':
        return String(arg);
      case '%d':
        return String(Number(arg));
      case '%i':
        return String(parseInt(String(arg), 10));
      case '%f':
        return String(parseFloat(String(arg)));
      case '%j':
        try {
          return JSON.stringify(arg);
        } catch {
          return '[Circular]';
        }
      case '%o':
      case '%O':
        return inspect(arg);
      default:
        return match;
    }
  });

  // Append remaining arguments
  while (i < args.length) {
    result += ' ' + inspect(args[i++]);
  }

  return result;
}

/**
 * Basic inspect implementation for displaying values.
 */
export function inspect(obj: unknown, options?: { depth?: number; colors?: boolean; showHidden?: boolean }): string {
  const depth = options?.depth ?? 2;
  return _inspect(obj, depth, new Set());
}

function _inspect(obj: unknown, depth: number, seen: Set<unknown>): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';

  const t = typeof obj;
  if (t === 'string') return `'${obj}'`;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(obj);
  if (t === 'symbol') return obj.toString();
  if (t === 'function') {
    const name = (obj as { name?: string }).name || 'anonymous';
    return `[Function: ${name}]`;
  }

  if (seen.has(obj)) return '[Circular]';

  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof RegExp) return obj.toString();
  if (obj instanceof Error) return `${obj.constructor.name}: ${obj.message}`;

  if (Array.isArray(obj)) {
    if (depth < 0) return '[Array]';
    seen.add(obj);
    const items = obj.map((item) => _inspect(item, depth - 1, seen));
    seen.delete(obj);
    if (items.join(', ').length > 72) {
      return '[\n  ' + items.join(',\n  ') + '\n]';
    }
    return '[ ' + items.join(', ') + ' ]';
  }

  if (obj instanceof Map) {
    if (depth < 0) return '[Map]';
    seen.add(obj);
    const entries: string[] = [];
    obj.forEach((v, k) => {
      entries.push(`${_inspect(k, depth - 1, seen)} => ${_inspect(v, depth - 1, seen)}`);
    });
    seen.delete(obj);
    return `Map(${obj.size}) { ${entries.join(', ')} }`;
  }

  if (obj instanceof Set) {
    if (depth < 0) return '[Set]';
    seen.add(obj);
    const items: string[] = [];
    obj.forEach((v) => {
      items.push(_inspect(v, depth - 1, seen));
    });
    seen.delete(obj);
    return `Set(${obj.size}) { ${items.join(', ')} }`;
  }

  if (t === 'object') {
    if (depth < 0) return '[Object]';
    seen.add(obj);
    const keys = Object.keys(obj as Record<string, unknown>);
    const parts = keys.map((key) => {
      const val = (obj as Record<string, unknown>)[key];
      return `${key}: ${_inspect(val, depth - 1, seen)}`;
    });
    seen.delete(obj);
    if (parts.length === 0) return '{}';
    if (parts.join(', ').length > 72) {
      return '{\n  ' + parts.join(',\n  ') + '\n}';
    }
    return '{ ' + parts.join(', ') + ' }';
  }

  return String(obj);
}

/**
 * Deprecate a function with a warning message.
 */
export function deprecate<T extends AnyFunction>(fn: T, msg: string): T {
  let warned = false;
  const deprecated = function (this: unknown, ...args: unknown[]) {
    if (!warned) {
      warned = true;
      console.warn(`DeprecationWarning: ${msg}`);
    }
    return fn.apply(this, args);
  };
  return deprecated as unknown as T;
}

/**
 * Type checking utilities.
 */
export const types = {
  isDate(value: unknown): value is Date {
    return value instanceof Date;
  },
  isRegExp(value: unknown): value is RegExp {
    return value instanceof RegExp;
  },
  isNativeError(value: unknown): value is Error {
    return value instanceof Error;
  },
  isMap(value: unknown): value is Map<unknown, unknown> {
    return value instanceof Map;
  },
  isSet(value: unknown): value is Set<unknown> {
    return value instanceof Set;
  },
  isPromise(value: unknown): value is Promise<unknown> {
    return value instanceof Promise;
  },
  isArrayBuffer(value: unknown): value is ArrayBuffer {
    return value instanceof ArrayBuffer;
  },
  isTypedArray(value: unknown): boolean {
    return ArrayBuffer.isView(value) && !(value instanceof DataView);
  },
  isUint8Array(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array;
  },
  isInt8Array(value: unknown): value is Int8Array {
    return value instanceof Int8Array;
  },
  isUint16Array(value: unknown): value is Uint16Array {
    return value instanceof Uint16Array;
  },
  isInt16Array(value: unknown): value is Int16Array {
    return value instanceof Int16Array;
  },
  isUint32Array(value: unknown): value is Uint32Array {
    return value instanceof Uint32Array;
  },
  isInt32Array(value: unknown): value is Int32Array {
    return value instanceof Int32Array;
  },
  isFloat32Array(value: unknown): value is Float32Array {
    return value instanceof Float32Array;
  },
  isFloat64Array(value: unknown): value is Float64Array {
    return value instanceof Float64Array;
  },
  isBigInt64Array(value: unknown): boolean {
    return typeof BigInt64Array !== 'undefined' && value instanceof BigInt64Array;
  },
  isBigUint64Array(value: unknown): boolean {
    return typeof BigUint64Array !== 'undefined' && value instanceof BigUint64Array;
  },
  isDataView(value: unknown): value is DataView {
    return value instanceof DataView;
  },
  isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
    return typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
  },
  isWeakMap(value: unknown): value is WeakMap<WeakKey, unknown> {
    return value instanceof WeakMap;
  },
  isWeakSet(value: unknown): value is WeakSet<WeakKey> {
    return value instanceof WeakSet;
  },
  isGeneratorFunction(value: unknown): boolean {
    if (typeof value !== 'function') return false;
    return value.constructor.name === 'GeneratorFunction';
  },
  isAsyncFunction(value: unknown): boolean {
    if (typeof value !== 'function') return false;
    return value.constructor.name === 'AsyncFunction';
  },
  isGeneratorObject(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto && typeof proto.next === 'function' && typeof proto.throw === 'function';
  },
  isProxy(_value: unknown): boolean {
    // Cannot detect proxies from JavaScript
    return false;
  },
  isExternal(_value: unknown): boolean {
    return false;
  },
  isAnyArrayBuffer(value: unknown): boolean {
    return value instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer);
  },
  isBoxedPrimitive(value: unknown): boolean {
    return (
      value instanceof Number ||
      value instanceof String ||
      value instanceof Boolean ||
      value instanceof BigInt ||
      value instanceof Symbol
    );
  },
  isArgumentsObject(_value: unknown): boolean {
    return Object.prototype.toString.call(_value) === '[object Arguments]';
  },
  isMapIterator(value: unknown): boolean {
    return Object.prototype.toString.call(value) === '[object Map Iterator]';
  },
  isSetIterator(value: unknown): boolean {
    return Object.prototype.toString.call(value) === '[object Set Iterator]';
  },
  isStringObject(value: unknown): boolean {
    return value instanceof String;
  },
  isNumberObject(value: unknown): boolean {
    return value instanceof Number;
  },
  isBooleanObject(value: unknown): boolean {
    return value instanceof Boolean;
  },
};

const _TextEncoder = globalThis.TextEncoder;
const _TextDecoder = globalThis.TextDecoder;
export { _TextEncoder as TextEncoder, _TextDecoder as TextDecoder };

export function callbackify(fn: (...args: unknown[]) => Promise<unknown>): (...args: unknown[]) => void {
  return function (this: unknown, ...args: unknown[]) {
    const callback = args.pop() as (err: Error | null, result?: unknown) => void;
    if (typeof callback !== 'function') {
      throw new TypeError('The last argument must be of type Function');
    }
    fn.apply(this, args).then(
      (result) => queueMicrotask(() => callback(null, result)),
      (err) => queueMicrotask(() => callback(err instanceof Error ? err : new Error(String(err))))
    );
  };
}

export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepStrictEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags;
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!isDeepStrictEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }

  return true;
}

export default {
  promisify,
  inherits,
  format,
  inspect,
  deprecate,
  types,
  callbackify,
  isDeepStrictEqual,
  TextEncoder: _TextEncoder,
  TextDecoder: _TextDecoder,
};
