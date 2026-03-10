import { Readable, Writable } from './stream.js';

export function isatty(_fd: number): boolean {
  return false;
}

export class ReadStream extends Readable {
  isRaw: boolean = false;
  isTTY: boolean = true;

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    return this;
  }
}

export class WriteStream extends Writable {
  columns: number = 80;
  rows: number = 24;
  isTTY: boolean = true;

  getColorDepth(): number {
    return 8;
  }

  hasColors(count?: number): boolean {
    return (count ?? 16) <= 256;
  }

  getWindowSize(): [number, number] {
    return [this.columns, this.rows];
  }

  clearLine(_dir: number, _callback?: () => void): boolean {
    return true;
  }

  clearScreenDown(_callback?: () => void): boolean {
    return true;
  }

  cursorTo(_x: number, _y?: number, _callback?: () => void): boolean {
    return true;
  }

  moveCursor(_dx: number, _dy: number, _callback?: () => void): boolean {
    return true;
  }
}

export default { isatty, ReadStream, WriteStream };
