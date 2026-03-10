/**
 * Console class shim that routes to process.stdout/stderr.
 */

import { format, inspect } from './util.js';

interface WritableStream {
  write(data: string): boolean;
}

export class Console {
  private _stdout: WritableStream;
  private _stderr: WritableStream;
  private _timers: Map<string, number> = new Map();
  private _counts: Map<string, number> = new Map();
  private _groupDepth: number = 0;

  constructor(stdout?: WritableStream, stderr?: WritableStream) {
    this._stdout = stdout || _getProcessStdout();
    this._stderr = stderr || _getProcessStderr();
  }

  private _prefix(): string {
    return '  '.repeat(this._groupDepth);
  }

  private _write(stream: WritableStream, message: string): void {
    stream.write(this._prefix() + message + '\n');
  }

  log(...args: unknown[]): void {
    this._write(this._stdout, format(args[0], ...args.slice(1)));
  }

  info(...args: unknown[]): void {
    this.log(...args);
  }

  warn(...args: unknown[]): void {
    this._write(this._stderr, format(args[0], ...args.slice(1)));
  }

  error(...args: unknown[]): void {
    this._write(this._stderr, format(args[0], ...args.slice(1)));
  }

  debug(...args: unknown[]): void {
    this.log(...args);
  }

  trace(...args: unknown[]): void {
    const msg = format(args[0], ...args.slice(1));
    const err = new Error();
    const stack = err.stack || '';
    const traceLines = stack
      .split('\n')
      .slice(2)
      .map((line) => line.trim())
      .join('\n');
    this._write(this._stderr, `Trace: ${msg}\n${traceLines}`);
  }

  dir(obj: unknown, options?: { colors?: boolean; depth?: number; showHidden?: boolean }): void {
    this._write(this._stdout, inspect(obj, options));
  }

  dirxml(...args: unknown[]): void {
    this.log(...args);
  }

  assert(value: unknown, ...args: unknown[]): void {
    if (!value) {
      const msg = args.length > 0 ? format(args[0], ...args.slice(1)) : 'Assertion failed';
      this._write(this._stderr, `Assertion failed: ${msg}`);
    }
  }

  count(label?: string): void {
    const l = label || 'default';
    const count = (this._counts.get(l) || 0) + 1;
    this._counts.set(l, count);
    this._write(this._stdout, `${l}: ${count}`);
  }

  countReset(label?: string): void {
    const l = label || 'default';
    this._counts.delete(l);
  }

  time(label?: string): void {
    const l = label || 'default';
    this._timers.set(l, performance.now());
  }

  timeEnd(label?: string): void {
    const l = label || 'default';
    const start = this._timers.get(l);
    if (start === undefined) {
      this._write(this._stderr, `Warning: No such label '${l}' for console.timeEnd()`);
      return;
    }
    const duration = performance.now() - start;
    this._timers.delete(l);
    this._write(this._stdout, `${l}: ${duration.toFixed(3)}ms`);
  }

  timeLog(label?: string, ...args: unknown[]): void {
    const l = label || 'default';
    const start = this._timers.get(l);
    if (start === undefined) {
      this._write(this._stderr, `Warning: No such label '${l}' for console.timeLog()`);
      return;
    }
    const duration = performance.now() - start;
    const msg = args.length > 0 ? ' ' + format(args[0], ...args.slice(1)) : '';
    this._write(this._stdout, `${l}: ${duration.toFixed(3)}ms${msg}`);
  }

  table(data: unknown, _columns?: string[]): void {
    // Simplified table - just log the data
    if (Array.isArray(data) || (typeof data === 'object' && data !== null)) {
      this._write(this._stdout, inspect(data, { depth: 3 }));
    } else {
      this.log(data);
    }
  }

  clear(): void {
    this._write(this._stdout, '\x1B[2J\x1B[H');
  }

  group(...args: unknown[]): void {
    if (args.length > 0) {
      this.log(...args);
    }
    this._groupDepth++;
  }

  groupCollapsed(...args: unknown[]): void {
    this.group(...args);
  }

  groupEnd(): void {
    if (this._groupDepth > 0) {
      this._groupDepth--;
    }
  }
}

function _getProcessStdout(): WritableStream {
  const g = globalThis as unknown as { process?: { stdout?: WritableStream } };
  if (g.process?.stdout) return g.process.stdout;
  return {
    write(data: string): boolean {
      if (typeof globalThis.console !== 'undefined') {
        globalThis.console.log(data.replace(/\n$/, ''));
      }
      return true;
    },
  };
}

function _getProcessStderr(): WritableStream {
  const g = globalThis as unknown as { process?: { stderr?: WritableStream } };
  if (g.process?.stderr) return g.process.stderr;
  return {
    write(data: string): boolean {
      if (typeof globalThis.console !== 'undefined') {
        globalThis.console.error(data.replace(/\n$/, ''));
      }
      return true;
    },
  };
}

export default Console;
