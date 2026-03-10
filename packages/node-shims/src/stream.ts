/**
 * Stream implementation for browser environment.
 */

import { EventEmitter } from './events.js';
import { Buffer } from './buffer.js';

type Callback = (error?: Error | null) => void;

export class Readable extends EventEmitter {
  readable: boolean = true;
  readableEnded: boolean = false;
  readableFlowing: boolean | null = null;
  readableLength: number = 0;
  destroyed: boolean = false;

  private _buffer: (Buffer | string)[] = [];
  private _ended: boolean = false;
  private _readableState = {
    highWaterMark: 16384,
    encoding: null as string | null,
    objectMode: false,
    pipes: [] as Writable[],
  };

  constructor(options?: {
    highWaterMark?: number;
    encoding?: string;
    objectMode?: boolean;
    read?: (size: number) => void;
  }) {
    super();
    if (options?.highWaterMark !== undefined) {
      this._readableState.highWaterMark = options.highWaterMark;
    }
    if (options?.encoding) {
      this._readableState.encoding = options.encoding;
    }
    if (options?.objectMode) {
      this._readableState.objectMode = options.objectMode;
    }
    if (options?.read) {
      this._read = options.read.bind(this);
    }
  }

  _read(_size: number): void {
    // Subclass should override
  }

  read(size?: number): Buffer | string | null {
    if (this._buffer.length === 0) {
      if (this._ended) {
        if (!this.readableEnded) {
          this.readableEnded = true;
          this.readable = false;
          queueMicrotask(() => {
            this.emit('end');
            this.emit('close');
          });
        }
        return null;
      }
      this._read(size ?? this._readableState.highWaterMark);
      if (this._buffer.length === 0) return null;
    }

    const chunk = this._buffer.shift()!;
    if (typeof chunk === 'string') {
      this.readableLength -= Buffer.byteLength(chunk);
    } else {
      this.readableLength -= chunk.length;
    }
    return chunk;
  }

  push(chunk: Buffer | string | Uint8Array | null, encoding?: string): boolean {
    if (chunk === null) {
      this._ended = true;
      if (this._buffer.length === 0) {
        queueMicrotask(() => {
          if (!this.readableEnded) {
            this.readableEnded = true;
            this.readable = false;
            this.emit('end');
            this.emit('close');
          }
        });
      }
      return false;
    }

    let data: Buffer | string;
    if (typeof chunk === 'string') {
      data = chunk;
      this.readableLength += Buffer.byteLength(chunk, encoding);
    } else if (chunk instanceof Buffer) {
      data = chunk;
      this.readableLength += chunk.length;
    } else {
      data = Buffer.from(chunk);
      this.readableLength += data.length;
    }

    this._buffer.push(data);

    if (this.readableFlowing) {
      queueMicrotask(() => {
        while (this._buffer.length > 0) {
          const item = this._buffer.shift()!;
          if (typeof item === 'string') {
            this.readableLength -= Buffer.byteLength(item);
          } else {
            this.readableLength -= item.length;
          }
          this.emit('data', item);
          for (const dest of this._readableState.pipes) {
            dest.write(item);
          }
        }
        if (this._ended && !this.readableEnded) {
          this.readableEnded = true;
          this.readable = false;
          this.emit('end');
          this.emit('close');
        }
      });
    }

    return this.readableLength < this._readableState.highWaterMark;
  }

  unshift(chunk: Buffer | string | Uint8Array): void {
    if (typeof chunk === 'string') {
      this._buffer.unshift(chunk);
      this.readableLength += Buffer.byteLength(chunk);
    } else if (chunk instanceof Buffer) {
      this._buffer.unshift(chunk);
      this.readableLength += chunk.length;
    } else {
      const buf = Buffer.from(chunk);
      this._buffer.unshift(buf);
      this.readableLength += buf.length;
    }
  }

  pipe<T extends Writable>(destination: T, options?: { end?: boolean }): T {
    this._readableState.pipes.push(destination);
    const shouldEnd = options?.end !== false;

    this.readableFlowing = true;

    this.on('data', (chunk: unknown) => {
      const canContinue = destination.write(chunk as Buffer | string);
      if (!canContinue) {
        this.readableFlowing = false;
        destination.once('drain', () => {
          this.readableFlowing = true;
          this.resume();
        });
      }
    });

    if (shouldEnd) {
      this.on('end', () => {
        destination.end();
      });
    }

    destination.emit('pipe', this);
    return destination;
  }

  unpipe(destination?: Writable): this {
    if (destination) {
      const idx = this._readableState.pipes.indexOf(destination);
      if (idx !== -1) {
        this._readableState.pipes.splice(idx, 1);
      }
    } else {
      this._readableState.pipes = [];
    }
    if (this._readableState.pipes.length === 0) {
      this.readableFlowing = false;
    }
    return this;
  }

  resume(): this {
    if (!this.readableFlowing) {
      this.readableFlowing = true;
      queueMicrotask(() => {
        while (this._buffer.length > 0 && this.readableFlowing) {
          const chunk = this._buffer.shift()!;
          if (typeof chunk === 'string') {
            this.readableLength -= Buffer.byteLength(chunk);
          } else {
            this.readableLength -= chunk.length;
          }
          this.emit('data', chunk);
        }
        if (this._ended && this._buffer.length === 0 && !this.readableEnded) {
          this.readableEnded = true;
          this.readable = false;
          this.emit('end');
          this.emit('close');
        }
      });
    }
    return this;
  }

  pause(): this {
    this.readableFlowing = false;
    return this;
  }

  setEncoding(encoding: string): this {
    this._readableState.encoding = encoding;
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.readable = false;
    this._buffer = [];
    this.readableLength = 0;

    queueMicrotask(() => {
      if (error) this.emit('error', error);
      this.emit('close');
    });

    return this;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Buffer | string> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next(): Promise<IteratorResult<Buffer | string>> {
        return new Promise((resolve) => {
          const chunk = self.read();
          if (chunk !== null) {
            resolve({ value: chunk, done: false });
            return;
          }
          if (self.readableEnded || self.destroyed) {
            resolve({ value: undefined as unknown as Buffer, done: true });
            return;
          }
          const onData = (data: unknown) => {
            cleanup();
            resolve({ value: data as Buffer | string, done: false });
          };
          const onEnd = () => {
            cleanup();
            resolve({ value: undefined as unknown as Buffer, done: true });
          };
          const onError = (err: unknown) => {
            cleanup();
            throw err;
          };
          const cleanup = () => {
            self.removeListener('data', onData);
            self.removeListener('end', onEnd);
            self.removeListener('error', onError);
          };
          self.once('data', onData);
          self.once('end', onEnd);
          self.once('error', onError);
          self.resume();
        });
      },
    };
  }
}

export class Writable extends EventEmitter {
  writable: boolean = true;
  writableEnded: boolean = false;
  writableFinished: boolean = false;
  writableLength: number = 0;
  destroyed: boolean = false;

  private _corked: number = 0;
  private _corkedWrites: { chunk: Buffer | string; encoding: string; callback: Callback }[] = [];
  private _writableState = {
    highWaterMark: 16384,
  };

  constructor(options?: {
    highWaterMark?: number;
    write?: (chunk: Buffer | string, encoding: string, callback: Callback) => void;
    final?: (callback: Callback) => void;
    destroy?: (error: Error | null, callback: Callback) => void;
  }) {
    super();
    if (options?.highWaterMark !== undefined) {
      this._writableState.highWaterMark = options.highWaterMark;
    }
    if (options?.write) {
      this._write = options.write.bind(this);
    }
    if (options?.final) {
      this._final = options.final.bind(this);
    }
    if (options?.destroy) {
      this._destroy = options.destroy.bind(this);
    }
  }

  _write(chunk: Buffer | string, _encoding: string, callback: Callback): void {
    callback();
  }

  _final(callback: Callback): void {
    callback();
  }

  _destroy(error: Error | null, callback: Callback): void {
    callback(error);
  }

  write(chunk: Buffer | string | Uint8Array, encodingOrCallback?: string | Callback, callback?: Callback): boolean {
    if (this.writableEnded) {
      const err = new Error('write after end');
      if (callback) callback(err);
      else if (typeof encodingOrCallback === 'function') encodingOrCallback(err);
      else this.emit('error', err);
      return false;
    }

    let encoding: string = 'utf8';
    let cb: Callback = callback ?? (() => {});

    if (typeof encodingOrCallback === 'function') {
      cb = encodingOrCallback;
    } else if (typeof encodingOrCallback === 'string') {
      encoding = encodingOrCallback;
    }

    let data: Buffer | string;
    if (chunk instanceof Uint8Array && !(chunk instanceof Buffer)) {
      data = Buffer.from(chunk);
    } else {
      data = chunk as Buffer | string;
    }

    if (this._corked > 0) {
      this._corkedWrites.push({ chunk: data, encoding, callback: cb });
      return false;
    }

    const len = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    this.writableLength += len;

    this._write(data, encoding, (err?: Error | null) => {
      this.writableLength -= len;
      if (err) {
        this.emit('error', err);
      }
      cb(err);
      if (this.writableLength < this._writableState.highWaterMark) {
        this.emit('drain');
      }
    });

    return this.writableLength < this._writableState.highWaterMark;
  }

  end(chunkOrCallback?: Buffer | string | Uint8Array | Callback, encodingOrCallback?: string | Callback, callback?: Callback): this {
    let chunk: Buffer | string | Uint8Array | undefined;
    let cb: Callback = callback ?? (() => {});

    if (typeof chunkOrCallback === 'function') {
      cb = chunkOrCallback;
    } else {
      chunk = chunkOrCallback;
      if (typeof encodingOrCallback === 'function') {
        cb = encodingOrCallback;
      }
    }

    if (chunk !== undefined) {
      this.write(chunk, typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined);
    }

    this.writableEnded = true;

    // Flush corked writes
    if (this._corked > 0) {
      this._corked = 0;
      this._flushCorked();
    }

    this._final((err?: Error | null) => {
      this.writableFinished = true;
      this.writable = false;
      if (err) {
        this.emit('error', err);
      }
      this.emit('finish');
      this.emit('close');
      cb(err);
    });

    return this;
  }

  cork(): void {
    this._corked++;
  }

  uncork(): void {
    if (this._corked > 0) {
      this._corked--;
      if (this._corked === 0) {
        this._flushCorked();
      }
    }
  }

  private _flushCorked(): void {
    const writes = this._corkedWrites.splice(0);
    for (const w of writes) {
      this.write(w.chunk, w.encoding, w.callback);
    }
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.writable = false;

    this._destroy(error ?? null, (err) => {
      if (err) this.emit('error', err);
      this.emit('close');
    });

    return this;
  }

  setDefaultEncoding(encoding: string): this {
    // Validate encoding
    Buffer.isEncoding(encoding);
    return this;
  }
}

export class Duplex extends Readable {
  writable: boolean = true;
  writableEnded: boolean = false;
  writableFinished: boolean = false;
  writableLength: number = 0;

  private _writable: Writable;

  constructor(options?: {
    highWaterMark?: number;
    read?: (size: number) => void;
    write?: (chunk: Buffer | string, encoding: string, callback: Callback) => void;
    final?: (callback: Callback) => void;
  }) {
    super(options);
    this._writable = new Writable({
      highWaterMark: options?.highWaterMark,
      write: options?.write,
      final: options?.final,
    });

    // Proxy writable events
    this._writable.on('finish', () => {
      this.writableFinished = true;
      this.emit('finish');
    });
    this._writable.on('drain', () => this.emit('drain'));
  }

  write(chunk: Buffer | string | Uint8Array, encodingOrCallback?: string | Callback, callback?: Callback): boolean {
    return this._writable.write(chunk, encodingOrCallback as string, callback);
  }

  end(chunkOrCallback?: Buffer | string | Uint8Array | Callback, encodingOrCallback?: string | Callback, callback?: Callback): this {
    this._writable.end(chunkOrCallback as Buffer, encodingOrCallback as string, callback);
    this.writableEnded = true;
    return this;
  }

  cork(): void {
    this._writable.cork();
  }

  uncork(): void {
    this._writable.uncork();
  }
}

export class Transform extends Duplex {
  private _transformCallback: ((error?: Error | null, data?: Buffer | string) => void) | null = null;

  constructor(options?: {
    highWaterMark?: number;
    transform?: (chunk: Buffer | string, encoding: string, callback: (error?: Error | null, data?: Buffer | string) => void) => void;
    flush?: (callback: (error?: Error | null, data?: Buffer | string) => void) => void;
  }) {
    super({
      ...options,
      write: (chunk: Buffer | string, encoding: string, callback: Callback) => {
        this._transform(chunk, encoding, (err, data) => {
          if (data !== undefined && data !== null) {
            this.push(data);
          }
          callback(err);
        });
      },
      final: (callback: Callback) => {
        this._flush((err, data) => {
          if (data !== undefined && data !== null) {
            this.push(data);
          }
          this.push(null);
          callback(err);
        });
      },
    });

    if (options?.transform) {
      this._transform = options.transform.bind(this);
    }
    if (options?.flush) {
      this._flush = options.flush.bind(this);
    }
  }

  _transform(chunk: Buffer | string, _encoding: string, callback: (error?: Error | null, data?: Buffer | string) => void): void {
    callback(null, chunk);
  }

  _flush(callback: (error?: Error | null, data?: Buffer | string) => void): void {
    callback();
  }
}

export class PassThrough extends Transform {
  _transform(chunk: Buffer | string, _encoding: string, callback: (error?: Error | null, data?: Buffer | string) => void): void {
    callback(null, chunk);
  }
}

/**
 * Pipeline helper - pipe streams together and handle cleanup.
 */
export function pipeline(
  ...args: [...streams: (Readable | Writable | Transform)[], callback: Callback]
): void {
  const callback = args.pop() as Callback;
  const streams = args as (Readable | Writable | Transform)[];

  if (streams.length < 2) {
    throw new Error('Pipeline requires at least two streams');
  }

  let error: Error | null = null;
  let finished = false;

  function done(err?: Error | null): void {
    if (finished) return;
    finished = true;
    error = err ?? null;
    callback(error);
  }

  for (let i = 0; i < streams.length - 1; i++) {
    const source = streams[i] as Readable;
    const dest = streams[i + 1] as Writable;

    source.pipe(dest);

    source.on('error', (err: unknown) => {
      dest.destroy(err as Error);
      done(err as Error);
    });
  }

  const last = streams[streams.length - 1];
  last.on('error', (err: unknown) => done(err as Error));
  last.on('finish', () => done());
  last.on('end', () => done());
  (last as Writable).on('close', () => done());
}

/**
 * Finished helper - get notified when a stream is no longer readable/writable/errored.
 */
export function finished(stream: Readable | Writable, callback: Callback): () => void {
  let done = false;

  function onFinish(): void {
    if (done) return;
    done = true;
    cleanup();
    callback();
  }

  function onError(err: unknown): void {
    if (done) return;
    done = true;
    cleanup();
    callback(err as Error);
  }

  function onClose(): void {
    if (done) return;
    done = true;
    cleanup();
    callback();
  }

  function cleanup(): void {
    stream.removeListener('finish', onFinish);
    stream.removeListener('end', onFinish);
    stream.removeListener('error', onError);
    stream.removeListener('close', onClose);
  }

  stream.on('finish', onFinish);
  stream.on('end', onFinish);
  stream.on('error', onError);
  stream.on('close', onClose);

  return cleanup;
}

export default {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
  finished,
};
