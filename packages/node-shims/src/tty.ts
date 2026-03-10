/**
 * TTY shim for browser environment.
 */

import { Readable, Writable } from './stream.js';
import { Buffer } from './buffer.js';

export function isatty(_fd?: number): boolean {
  return false;
}

export class ReadStream extends Readable {
  isTTY: boolean = false;
  isRaw: boolean = false;

  constructor() {
    super();
  }

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    return this;
  }
}

export class WriteStream extends Writable {
  isTTY: boolean = false;
  columns: number = 80;
  rows: number = 24;
  cursorTo: (x: number, y?: number) => boolean = () => false;
  moveCursor: (dx: number, dy: number) => boolean = () => false;
  clearLine: (dir: number) => boolean = () => false;
  clearScreenDown: () => boolean = () => false;
  getColorDepth: () => number = () => 1;
  hasColors: (count?: number) => boolean = () => false;
  getWindowSize: () => [number, number] = () => [this.columns, this.rows];

  constructor() {
    super({
      write: (_chunk: Buffer | string, _encoding: string, callback: (err?: Error | null) => void) => {
        callback();
      },
    });
  }
}

export default {
  isatty,
  ReadStream,
  WriteStream,
};
