/**
 * Assert module shim for browser environment.
 */

export class AssertionError extends Error {
  actual: unknown;
  expected: unknown;
  operator: string;
  generatedMessage: boolean;
  code: string = 'ERR_ASSERTION';

  constructor(options: {
    message?: string;
    actual?: unknown;
    expected?: unknown;
    operator?: string;
  }) {
    const message = options.message || `${_inspect(options.actual)} ${options.operator || '=='} ${_inspect(options.expected)}`;
    super(message);
    this.name = 'AssertionError';
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = options.operator || '';
    this.generatedMessage = !options.message;
  }
}

function _inspect(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function _deepEqual(a: unknown, b: unknown, strict: boolean): boolean {
  if (strict ? Object.is(a, b) : a == b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return strict ? Object.is(a, b) : a == b;
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!_deepEqual(a[i], b[i], strict)) return false;
    }
    return true;
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [key, val] of a) {
      if (!b.has(key) || !_deepEqual(val, b.get(key), strict)) return false;
    }
    return true;
  }

  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const val of a) {
      if (!b.has(val)) return false;
    }
    return true;
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);

  if (strict && keysA.length !== keysB.length) return false;
  if (!strict && keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!_deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      strict
    )) return false;
  }

  return true;
}

export function ok(value: unknown, message?: string | Error): asserts value {
  if (!value) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message || `The expression evaluated to a falsy value`,
      actual: value,
      expected: true,
      operator: '==',
    });
  }
}

export function equal(actual: unknown, expected: unknown, message?: string | Error): void {
  if (actual != expected) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message as string,
      actual,
      expected,
      operator: '==',
    });
  }
}

export function notEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (actual == expected) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message as string,
      actual,
      expected,
      operator: '!=',
    });
  }
}

export function strictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (!Object.is(actual, expected)) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message as string,
      actual,
      expected,
      operator: '===',
    });
  }
}

export function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (Object.is(actual, expected)) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message as string,
      actual,
      expected,
      operator: '!==',
    });
  }
}

export function deepEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (!_deepEqual(actual, expected, false)) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message as string,
      actual,
      expected,
      operator: 'deepEqual',
    });
  }
}

export function notDeepEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (_deepEqual(actual, expected, false)) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message as string,
      actual,
      expected,
      operator: 'notDeepEqual',
    });
  }
}

export function deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (!_deepEqual(actual, expected, true)) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message as string,
      actual,
      expected,
      operator: 'deepStrictEqual',
    });
  }
}

export function notDeepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (_deepEqual(actual, expected, true)) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message as string,
      actual,
      expected,
      operator: 'notDeepStrictEqual',
    });
  }
}

export function throws(block: () => void, errorOrMessage?: RegExp | Function | Error | string, message?: string): void {
  let threw = false;
  let actual: unknown;

  try {
    block();
  } catch (e) {
    threw = true;
    actual = e;
  }

  if (!threw) {
    throw new AssertionError({
      message: (typeof errorOrMessage === 'string' ? errorOrMessage : message) || 'Missing expected exception',
      actual: undefined,
      expected: errorOrMessage,
      operator: 'throws',
    });
  }

  if (errorOrMessage) {
    if (typeof errorOrMessage === 'string') {
      // errorOrMessage is the message, no validation of error
      return;
    }
    if (errorOrMessage instanceof RegExp) {
      if (!errorOrMessage.test(String(actual))) {
        throw new AssertionError({
          message: message || `Error message did not match regex: ${errorOrMessage}`,
          actual,
          expected: errorOrMessage,
          operator: 'throws',
        });
      }
    } else if (typeof errorOrMessage === 'function') {
      if (actual instanceof (errorOrMessage as new (...args: unknown[]) => unknown)) {
        return;
      }
      // Try as validation function
      if ((errorOrMessage as (err: unknown) => boolean)(actual)) {
        return;
      }
      throw new AssertionError({
        message: message || 'Error did not match expected',
        actual,
        expected: errorOrMessage,
        operator: 'throws',
      });
    }
  }
}

export function doesNotThrow(block: () => void, errorOrMessage?: RegExp | Function | string, message?: string): void {
  try {
    block();
  } catch (e) {
    const msg = typeof errorOrMessage === 'string' ? errorOrMessage : message;

    if (typeof errorOrMessage === 'function' && e instanceof (errorOrMessage as new (...args: unknown[]) => unknown)) {
      throw new AssertionError({
        message: msg || `Got unwanted exception: ${e}`,
        actual: e,
        expected: undefined,
        operator: 'doesNotThrow',
      });
    }

    if (errorOrMessage instanceof RegExp && errorOrMessage.test(String(e))) {
      throw new AssertionError({
        message: msg || `Got unwanted exception: ${e}`,
        actual: e,
        expected: undefined,
        operator: 'doesNotThrow',
      });
    }

    if (!errorOrMessage || typeof errorOrMessage === 'string') {
      throw new AssertionError({
        message: msg || `Got unwanted exception: ${e}`,
        actual: e,
        expected: undefined,
        operator: 'doesNotThrow',
      });
    }
  }
}

export function fail(message?: string | Error): never {
  if (message instanceof Error) throw message;
  throw new AssertionError({
    message: message || 'Failed',
    operator: 'fail',
  });
}

export function ifError(value: unknown): void {
  if (value !== null && value !== undefined) {
    if (value instanceof Error) throw value;
    throw new AssertionError({
      message: `ifError got unwanted exception: ${value}`,
      actual: value,
      expected: null,
      operator: 'ifError',
    });
  }
}

// Make assert callable as a function (alias for ok)
const assert = Object.assign(ok, {
  ok,
  equal,
  notEqual,
  strictEqual,
  notStrictEqual,
  deepEqual,
  notDeepEqual,
  deepStrictEqual,
  notDeepStrictEqual,
  throws,
  doesNotThrow,
  fail,
  ifError,
  AssertionError,
});

export default assert;
