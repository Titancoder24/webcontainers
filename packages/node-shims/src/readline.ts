/**
 * Readline shim for browser environment.
 */

import { EventEmitter } from './events.js';
import { Buffer } from './buffer.js';
import type { Readable, Writable } from './stream.js';

export interface InterfaceOptions {
  input: Readable;
  output?: Writable;
  completer?: (line: string) => [string[], string] | Promise<[string[], string]>;
  terminal?: boolean;
  historySize?: number;
  prompt?: string;
  crlfDelay?: number;
  removeHistoryDuplicates?: boolean;
  escapeCodeTimeout?: number;
}

export class Interface extends EventEmitter {
  private _input: Readable;
  private _output: Writable | undefined;
  private _prompt: string;
  private _line: string = '';
  private _closed: boolean = false;
  private _history: string[] = [];
  private _historySize: number;
  private _buffer: string = '';
  terminal: boolean;

  constructor(inputOrOptions: Readable | InterfaceOptions, output?: Writable) {
    super();

    let options: InterfaceOptions;
    if ('input' in (inputOrOptions as InterfaceOptions)) {
      options = inputOrOptions as InterfaceOptions;
    } else {
      options = {
        input: inputOrOptions as Readable,
        output,
      };
    }

    this._input = options.input;
    this._output = options.output;
    this._prompt = options.prompt || '> ';
    this._historySize = options.historySize ?? 30;
    this.terminal = options.terminal ?? false;

    this._setupInput();
  }

  private _setupInput(): void {
    this._input.on('data', (data: unknown) => {
      if (this._closed) return;

      const str = typeof data === 'string' ? data : data!.toString();
      this._buffer += str;

      let newlineIdx: number;
      while ((newlineIdx = this._buffer.indexOf('\n')) !== -1) {
        let line = this._buffer.slice(0, newlineIdx);
        this._buffer = this._buffer.slice(newlineIdx + 1);

        // Strip \r if present
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }

        this._line = line;

        if (this._historySize > 0 && line.length > 0) {
          this._history.unshift(line);
          if (this._history.length > this._historySize) {
            this._history.pop();
          }
        }

        this.emit('line', line);
      }
    });

    this._input.on('end', () => {
      if (this._closed) return;

      // Emit remaining buffer as final line
      if (this._buffer.length > 0) {
        const line = this._buffer.replace(/\r$/, '');
        this._buffer = '';
        this.emit('line', line);
      }

      this.close();
    });

    this._input.on('error', (err: unknown) => {
      this.emit('error', err);
    });

    // Start reading
    this._input.resume();
  }

  prompt(_preserveCursor?: boolean): void {
    if (this._closed) return;
    if (this._output) {
      this._output.write(this._prompt);
    }
  }

  setPrompt(prompt: string): void {
    this._prompt = prompt;
  }

  getPrompt(): string {
    return this._prompt;
  }

  question(query: string, callback: (answer: string) => void): void;
  question(query: string, options: { signal?: AbortSignal }, callback: (answer: string) => void): void;
  question(query: string, optionsOrCallback: { signal?: AbortSignal } | ((answer: string) => void), callback?: (answer: string) => void): void {
    let cb: (answer: string) => void;
    let signal: AbortSignal | undefined;

    if (typeof optionsOrCallback === 'function') {
      cb = optionsOrCallback;
    } else {
      signal = optionsOrCallback.signal;
      cb = callback!;
    }

    if (this._closed) return;

    if (this._output) {
      this._output.write(query);
    }

    const onLine = (line: string) => {
      cleanup();
      cb(line);
    };

    const onClose = () => {
      cleanup();
      cb('');
    };

    const onAbort = () => {
      cleanup();
      this.emit('error', new Error('The operation was aborted'));
    };

    const cleanup = () => {
      this.removeListener('line', onLine);
      this.removeListener('close', onClose);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    this.once('line', onLine);
    this.once('close', onClose);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  write(data: string | Buffer | null, key?: { ctrl?: boolean; name?: string; shift?: boolean; meta?: boolean }): void {
    if (this._closed) return;

    if (key?.ctrl && key.name === 'c') {
      this.emit('SIGINT');
      return;
    }

    if (key?.ctrl && key.name === 'd') {
      this.close();
      return;
    }

    if (data !== null && data !== undefined) {
      const str = typeof data === 'string' ? data : data.toString();
      this._buffer += str;
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.emit('close');
  }

  pause(): this {
    this._input.pause();
    this.emit('pause');
    return this;
  }

  resume(): this {
    this._input.resume();
    this.emit('resume');
    return this;
  }

  get line(): string {
    return this._line;
  }

  get cursor(): number {
    return this._line.length;
  }

  getCursorPos(): { rows: number; cols: number } {
    return { rows: 0, cols: this._line.length };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<string> {
    const lines: string[] = [];
    let resolve: ((result: IteratorResult<string>) => void) | null = null;
    let closed = false;

    this.on('line', (line: string) => {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: line, done: false });
      } else {
        lines.push(line);
      }
    });

    this.on('close', () => {
      closed = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as unknown as string, done: true });
      }
    });

    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next(): Promise<IteratorResult<string>> {
        if (lines.length > 0) {
          return Promise.resolve({ value: lines.shift()!, done: false });
        }
        if (closed) {
          return Promise.resolve({ value: undefined as unknown as string, done: true });
        }
        return new Promise((r) => {
          resolve = r;
        });
      },
    };
  }
}

export function createInterface(inputOrOptions: Readable | InterfaceOptions, output?: Writable): Interface {
  return new Interface(inputOrOptions, output);
}

export function clearLine(stream: Writable, dir: number, callback?: () => void): boolean {
  const code = dir < 0 ? '\x1b[1K' : dir > 0 ? '\x1b[0K' : '\x1b[2K';
  stream.write(code);
  if (callback) queueMicrotask(callback);
  return true;
}

export function clearScreenDown(stream: Writable, callback?: () => void): boolean {
  stream.write('\x1b[0J');
  if (callback) queueMicrotask(callback);
  return true;
}

export function cursorTo(stream: Writable, x: number, y?: number | (() => void), callback?: () => void): boolean {
  let code: string;
  if (typeof y === 'number') {
    code = `\x1b[${y + 1};${x + 1}H`;
  } else {
    code = `\x1b[${x + 1}G`;
    if (typeof y === 'function') callback = y;
  }
  stream.write(code);
  if (callback) queueMicrotask(callback);
  return true;
}

export function moveCursor(stream: Writable, dx: number, dy: number, callback?: () => void): boolean {
  let code = '';
  if (dx > 0) code += `\x1b[${dx}C`;
  else if (dx < 0) code += `\x1b[${-dx}D`;
  if (dy > 0) code += `\x1b[${dy}B`;
  else if (dy < 0) code += `\x1b[${-dy}A`;
  if (code) stream.write(code);
  if (callback) queueMicrotask(callback);
  return true;
}

export function emitKeypressEvents(stream: Readable): void {
  stream.on('data', (data: unknown) => {
    const str = typeof data === 'string' ? data : String(data);
    for (const ch of str) {
      stream.emit('keypress', ch, { sequence: ch, name: ch, ctrl: false, meta: false, shift: false });
    }
  });
}

export default {
  Interface,
  createInterface,
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
  emitKeypressEvents,
};
