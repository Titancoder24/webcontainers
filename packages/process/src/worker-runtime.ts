/**
 * Worker Runtime
 *
 * This module runs INSIDE a Web Worker. It sets up a Node.js-like environment
 * including process, Buffer, and console globals, then evaluates code sent
 * from the main thread. Syscalls are made synchronously via SharedArrayBuffer
 * and Atomics.wait, allowing the worker to block until the main thread
 * services the request.
 *
 * Because this runs in a worker context, it cannot import from packages
 * directly at runtime. All needed constants are inlined.
 */

// ---------------------------------------------------------------------------
// Inlined constants (mirrored from @aspect/shared/constants)
// ---------------------------------------------------------------------------
const SAB_STATUS_OFFSET = 0;
const SAB_SYSCALL_TYPE_OFFSET = 4;
const SAB_REQUEST_LENGTH_OFFSET = 8;
const SAB_RESPONSE_LENGTH_OFFSET = 12;
const SAB_ERROR_CODE_OFFSET = 16;
const SAB_PAYLOAD_OFFSET = 64;

const STATUS_IDLE = 0;
const STATUS_REQUEST = 1;
const STATUS_RESPONSE = 2;
const STATUS_ERROR = 3;

// Syscall type constants (mirrored from @aspect/shared/types SyscallType enum)
const SyscallType = {
  FS_READ: 1,
  FS_WRITE: 2,
  FS_STAT: 3,
  FS_READDIR: 4,
  FS_MKDIR: 5,
  FS_UNLINK: 6,
  FS_RENAME: 7,
  FS_SYMLINK: 8,
  FS_READLINK: 9,
  FS_CHMOD: 10,
  FS_OPEN: 11,
  FS_CLOSE: 12,
  FS_WATCH: 13,
  FS_EXISTS: 14,
  FS_REALPATH: 15,
  FS_MKDTEMP: 16,
  FS_RMDIR: 17,
  FS_WRITEFILE: 18,
  FS_READFILE: 19,
  FS_APPENDFILE: 20,
  FS_COPYFILE: 21,
  FS_ACCESS: 22,
  FS_LSTAT: 23,
  FS_UTIMES: 24,
  PROCESS_SPAWN: 50,
  PROCESS_KILL: 51,
  PROCESS_CWD: 52,
  PROCESS_CHDIR: 53,
  PROCESS_EXIT: 54,
  NET_LISTEN: 70,
  NET_CONNECT: 71,
  NET_CLOSE: 72,
} as const;

// ---------------------------------------------------------------------------
// Inlined encoding helpers (mirrored from @aspect/shared/encoding)
// ---------------------------------------------------------------------------
const _encoder = new TextEncoder();
const _decoder = new TextDecoder();

function encodePayload(
  sab: SharedArrayBuffer,
  offset: number,
  metadata: Record<string, unknown>,
  binaryData?: Uint8Array,
): number {
  const view = new DataView(sab);
  const metaStr = JSON.stringify(metadata);
  const metaBytes = _encoder.encode(metaStr);

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

function decodePayload(
  sab: SharedArrayBuffer,
  offset: number,
): { metadata: Record<string, unknown>; binaryData: Uint8Array | null } {
  const view = new DataView(sab);
  const arr = new Uint8Array(sab);

  const metaLength = view.getUint32(offset, true);
  const metaBytes = arr.slice(offset + 4, offset + 4 + metaLength);
  const metadata = JSON.parse(_decoder.decode(metaBytes));

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

// ---------------------------------------------------------------------------
// Worker global context typing
// ---------------------------------------------------------------------------
declare const self: DedicatedWorkerGlobalScope;

// ---------------------------------------------------------------------------
// State managed per-worker
// ---------------------------------------------------------------------------
let syscallBuffer: SharedArrayBuffer | null = null;
let stdoutPort: MessagePort | null = null;
let stderrPort: MessagePort | null = null;
let stdinPort: MessagePort | null = null;
let processPid = 0;
let processCwd = '/home/project';
let processEnv: Record<string, string> = {};
let processExitCode: number | null = null;

// ---------------------------------------------------------------------------
// Synchronous syscall bridge
// ---------------------------------------------------------------------------

/**
 * Make a synchronous syscall to the main thread.
 *
 * Protocol:
 *  1. Encode the request payload into the SharedArrayBuffer at SAB_PAYLOAD_OFFSET.
 *  2. Write the syscall type and request length into their header slots.
 *  3. Set the status word to STATUS_REQUEST and notify the main thread.
 *  4. Call Atomics.wait on the status word until it is no longer STATUS_REQUEST.
 *  5. Read the status to determine success (STATUS_RESPONSE) or error (STATUS_ERROR).
 *  6. Decode and return the response payload.
 */
function syscall(
  type: number,
  payload: Record<string, unknown>,
  binaryData?: Uint8Array,
): { metadata: Record<string, unknown>; binaryData: Uint8Array | null } {
  if (!syscallBuffer) {
    throw new Error('Syscall buffer not initialised');
  }

  const statusArray = new Int32Array(syscallBuffer);
  const view = new DataView(syscallBuffer);

  // Write syscall type
  view.setInt32(SAB_SYSCALL_TYPE_OFFSET, type, true);

  // Encode request payload
  const requestLength = encodePayload(syscallBuffer, SAB_PAYLOAD_OFFSET, payload, binaryData);
  view.setInt32(SAB_REQUEST_LENGTH_OFFSET, requestLength, true);

  // Clear response / error slots
  view.setInt32(SAB_RESPONSE_LENGTH_OFFSET, 0, true);
  view.setInt32(SAB_ERROR_CODE_OFFSET, 0, true);

  // Signal: STATUS_REQUEST
  Atomics.store(statusArray, SAB_STATUS_OFFSET / 4, STATUS_REQUEST);
  Atomics.notify(statusArray, SAB_STATUS_OFFSET / 4);

  // Block until the main thread writes a response
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const waitResult = Atomics.wait(statusArray, SAB_STATUS_OFFSET / 4, STATUS_REQUEST, 5000);
    const currentStatus = Atomics.load(statusArray, SAB_STATUS_OFFSET / 4);

    if (currentStatus === STATUS_RESPONSE || currentStatus === STATUS_ERROR) {
      break;
    }

    // If timed-out but status is still REQUEST, keep waiting
    if (waitResult === 'timed-out' && currentStatus === STATUS_REQUEST) {
      continue;
    }

    // For any other state, break out
    break;
  }

  const finalStatus = Atomics.load(statusArray, SAB_STATUS_OFFSET / 4);

  if (finalStatus === STATUS_ERROR) {
    const errorCode = view.getInt32(SAB_ERROR_CODE_OFFSET, true);
    // Attempt to read an error message from the response payload
    const responseLength = view.getInt32(SAB_RESPONSE_LENGTH_OFFSET, true);
    let errorMessage = `Syscall error (errno ${errorCode})`;
    let errorCodeStr = 'UNKNOWN';

    if (responseLength > 0) {
      try {
        const { metadata } = decodePayload(syscallBuffer, SAB_PAYLOAD_OFFSET);
        errorMessage = (metadata.message as string) ?? errorMessage;
        errorCodeStr = (metadata.code as string) ?? errorCodeStr;
      } catch {
        // ignore decode failures for error payloads
      }
    }

    // Reset status to idle
    Atomics.store(statusArray, SAB_STATUS_OFFSET / 4, STATUS_IDLE);

    const err = new Error(errorMessage) as Error & { code: string; errno: number };
    err.code = errorCodeStr;
    err.errno = errorCode;
    throw err;
  }

  // STATUS_RESPONSE — decode
  const response = decodePayload(syscallBuffer, SAB_PAYLOAD_OFFSET);

  // Reset status to idle
  Atomics.store(statusArray, SAB_STATUS_OFFSET / 4, STATUS_IDLE);

  return response;
}

// ---------------------------------------------------------------------------
// global.Buffer (minimal implementation for worker context)
// ---------------------------------------------------------------------------

class WorkerBuffer extends Uint8Array {
  static override from(
    value: string | ArrayBufferLike | ArrayLike<number> | Iterable<number>,
    encodingOrOffset?: string | number | ((v: number, k: number) => number),
    length?: number,
  ): WorkerBuffer {
    if (typeof value === 'string') {
      const encoding = (encodingOrOffset as string) ?? 'utf-8';
      if (encoding === 'base64') {
        const binaryStr = atob(value);
        const buf = new WorkerBuffer(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          buf[i] = binaryStr.charCodeAt(i);
        }
        return buf;
      }
      if (encoding === 'hex') {
        const buf = new WorkerBuffer(value.length / 2);
        for (let i = 0; i < value.length; i += 2) {
          buf[i / 2] = parseInt(value.substring(i, i + 2), 16);
        }
        return buf;
      }
      // utf-8 / utf8
      const bytes = _encoder.encode(value);
      const buf = new WorkerBuffer(bytes.length);
      buf.set(bytes);
      return buf;
    }

    if (value instanceof ArrayBuffer) {
      const buf = new WorkerBuffer(value, encodingOrOffset as number | undefined, length);
      return buf;
    }

    if (ArrayBuffer.isView(value) || Array.isArray(value)) {
      const src = value as ArrayLike<number>;
      const buf = new WorkerBuffer(src.length);
      for (let i = 0; i < src.length; i++) {
        buf[i] = src[i];
      }
      return buf;
    }

    return new WorkerBuffer(0);
  }

  static alloc(size: number, fill?: number): WorkerBuffer {
    const buf = new WorkerBuffer(size);
    if (fill !== undefined) {
      buf.fill(fill);
    }
    return buf;
  }

  static allocUnsafe(size: number): WorkerBuffer {
    return new WorkerBuffer(size);
  }

  static concat(list: Uint8Array[], totalLength?: number): WorkerBuffer {
    const total = totalLength ?? list.reduce((sum, b) => sum + b.length, 0);
    const result = new WorkerBuffer(total);
    let offset = 0;
    for (const buf of list) {
      result.set(buf, offset);
      offset += buf.length;
      if (offset >= total) break;
    }
    return result;
  }

  static isBuffer(obj: unknown): obj is WorkerBuffer {
    return obj instanceof WorkerBuffer;
  }

  static byteLength(str: string, encoding?: string): number {
    if (encoding === 'base64') {
      return Math.ceil((str.length * 3) / 4);
    }
    return _encoder.encode(str).length;
  }

  toString(encoding?: string, start?: number, end?: number): string {
    const slice = this.subarray(start ?? 0, end ?? this.length);
    const enc = encoding ?? 'utf-8';

    if (enc === 'base64') {
      let binary = '';
      for (let i = 0; i < slice.length; i++) {
        binary += String.fromCharCode(slice[i]);
      }
      return btoa(binary);
    }

    if (enc === 'hex') {
      let hex = '';
      for (let i = 0; i < slice.length; i++) {
        hex += slice[i].toString(16).padStart(2, '0');
      }
      return hex;
    }

    return _decoder.decode(slice);
  }

  write(str: string, offset?: number, length?: number, encoding?: string): number {
    const bytes = _encoder.encode(str);
    const start = offset ?? 0;
    const maxLen = length ?? this.length - start;
    const writeLen = Math.min(bytes.length, maxLen);
    this.set(bytes.subarray(0, writeLen), start);
    return writeLen;
  }

  copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number {
    const tStart = targetStart ?? 0;
    const sStart = sourceStart ?? 0;
    const sEnd = sourceEnd ?? this.length;
    const slice = this.subarray(sStart, sEnd);
    const writeLen = Math.min(slice.length, target.length - tStart);
    target.set(slice.subarray(0, writeLen), tStart);
    return writeLen;
  }

  toJSON(): { type: 'Buffer'; data: number[] } {
    return { type: 'Buffer', data: Array.from(this) };
  }

  equals(other: Uint8Array): boolean {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) {
      if (this[i] !== other[i]) return false;
    }
    return true;
  }

  compare(other: Uint8Array): -1 | 0 | 1 {
    const len = Math.min(this.length, other.length);
    for (let i = 0; i < len; i++) {
      if (this[i] < other[i]) return -1;
      if (this[i] > other[i]) return 1;
    }
    if (this.length < other.length) return -1;
    if (this.length > other.length) return 1;
    return 0;
  }

  slice(start?: number, end?: number): WorkerBuffer {
    const sliced = super.slice(start, end);
    const buf = new WorkerBuffer(sliced.length);
    buf.set(sliced);
    return buf;
  }
}

// ---------------------------------------------------------------------------
// global.process
// ---------------------------------------------------------------------------

function createStdoutStream(port: MessagePort) {
  return {
    write(chunk: string | Uint8Array, encoding?: string, callback?: () => void): boolean {
      const data = typeof chunk === 'string' ? chunk : _decoder.decode(chunk);
      port.postMessage({ type: 'stdout', data });
      if (callback) queueMicrotask(callback);
      return true;
    },
    end(chunk?: string | Uint8Array): void {
      if (chunk !== undefined) {
        this.write(chunk);
      }
    },
    on(_event: string, _cb: (...args: unknown[]) => void): unknown {
      return this;
    },
    once(_event: string, _cb: (...args: unknown[]) => void): unknown {
      return this;
    },
    emit(_event: string, ..._args: unknown[]): boolean {
      return false;
    },
    isTTY: false,
    writable: true,
    columns: 80,
  };
}

function createStderrStream(port: MessagePort) {
  return {
    write(chunk: string | Uint8Array, encoding?: string, callback?: () => void): boolean {
      const data = typeof chunk === 'string' ? chunk : _decoder.decode(chunk);
      port.postMessage({ type: 'stderr', data });
      if (callback) queueMicrotask(callback);
      return true;
    },
    end(chunk?: string | Uint8Array): void {
      if (chunk !== undefined) {
        this.write(chunk);
      }
    },
    on(_event: string, _cb: (...args: unknown[]) => void): unknown {
      return this;
    },
    once(_event: string, _cb: (...args: unknown[]) => void): unknown {
      return this;
    },
    emit(_event: string, ..._args: unknown[]): boolean {
      return false;
    },
    isTTY: false,
    writable: true,
    columns: 80,
  };
}

function createStdinStream(port: MessagePort | null) {
  const listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();

  if (port) {
    port.onmessage = (e: MessageEvent) => {
      const cbs = listeners.get('data');
      if (cbs) {
        for (const cb of cbs) {
          cb(e.data);
        }
      }
    };
  }

  return {
    readable: true,
    isTTY: false,
    on(event: string, cb: (...args: unknown[]) => void): unknown {
      let arr = listeners.get(event);
      if (!arr) {
        arr = [];
        listeners.set(event, arr);
      }
      arr.push(cb);
      return this;
    },
    once(event: string, cb: (...args: unknown[]) => void): unknown {
      const wrapper = (...args: unknown[]) => {
        this.removeListener(event, wrapper);
        cb(...args);
      };
      return this.on(event, wrapper);
    },
    removeListener(event: string, cb: (...args: unknown[]) => void): unknown {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(cb);
        if (idx !== -1) arr.splice(idx, 1);
      }
      return this;
    },
    resume(): unknown {
      return this;
    },
    pause(): unknown {
      return this;
    },
    setEncoding(_encoding: string): unknown {
      return this;
    },
    read(): null {
      return null;
    },
  };
}

function buildProcessObject(
  pid: number,
  cwd: string,
  env: Record<string, string>,
  stdoutStream: ReturnType<typeof createStdoutStream>,
  stderrStream: ReturnType<typeof createStderrStream>,
  stdinStream: ReturnType<typeof createStdinStream>,
) {
  const exitListeners: Array<(code: number) => void> = [];

  const processObj: Record<string, unknown> = {
    pid,
    ppid: 0,
    platform: 'linux',
    arch: 'wasm',
    version: 'v18.18.0',
    versions: {
      node: '18.18.0',
      v8: '0.0.0',
      modules: '108',
    },
    argv: ['node'],
    argv0: 'node',
    execArgv: [],
    execPath: '/usr/local/bin/node',
    title: 'node',

    env,

    stdout: stdoutStream,
    stderr: stderrStream,
    stdin: stdinStream,

    exitCode: undefined as number | undefined,

    cwd(): string {
      return processCwd;
    },

    chdir(dir: string): void {
      syscall(SyscallType.PROCESS_CHDIR, { dir });
      processCwd = dir;
    },

    exit(code?: number): never {
      const exitCode = code ?? processObj.exitCode ?? 0;
      processExitCode = exitCode as number;

      // Notify listeners
      for (const listener of exitListeners) {
        try {
          listener(exitCode as number);
        } catch {
          // ignore errors in exit listeners
        }
      }

      // Notify main thread
      syscall(SyscallType.PROCESS_EXIT, { code: exitCode });

      // Post exit message and close the worker
      self.postMessage({ type: 'exit', exitCode });
      self.close();

      // This throw ensures the calling code stops execution
      throw new Error(`process.exit(${exitCode})`);
    },

    nextTick(callback: (...args: unknown[]) => void, ...args: unknown[]): void {
      queueMicrotask(() => callback(...args));
    },

    on(event: string, listener: (...args: unknown[]) => void): unknown {
      if (event === 'exit') {
        exitListeners.push(listener as (code: number) => void);
      }
      // uncaughtException, unhandledRejection etc. are silently accepted
      return processObj;
    },

    once(event: string, listener: (...args: unknown[]) => void): unknown {
      if (event === 'exit') {
        const wrapper = (code: number) => {
          const idx = exitListeners.indexOf(wrapper);
          if (idx !== -1) exitListeners.splice(idx, 1);
          (listener as (code: number) => void)(code);
        };
        exitListeners.push(wrapper);
      }
      return processObj;
    },

    removeListener(_event: string, _listener: (...args: unknown[]) => void): unknown {
      return processObj;
    },

    emit(event: string, ...args: unknown[]): boolean {
      if (event === 'exit') {
        for (const listener of exitListeners) {
          try {
            listener(args[0] as number);
          } catch {
            // ignore
          }
        }
        return exitListeners.length > 0;
      }
      return false;
    },

    hrtime: Object.assign(
      function hrtime(prev?: [number, number]): [number, number] {
        const now = performance.now();
        const seconds = Math.floor(now / 1000);
        const nanos = Math.floor((now % 1000) * 1e6);
        if (prev) {
          let diffSec = seconds - prev[0];
          let diffNano = nanos - prev[1];
          if (diffNano < 0) {
            diffSec -= 1;
            diffNano += 1e9;
          }
          return [diffSec, diffNano];
        }
        return [seconds, nanos];
      },
      {
        bigint(): bigint {
          return BigInt(Math.floor(performance.now() * 1e6));
        },
      },
    ),

    memoryUsage(): Record<string, number> {
      return {
        rss: 0,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0,
      };
    },

    cpuUsage(): Record<string, number> {
      return { user: 0, system: 0 };
    },

    uptime(): number {
      return performance.now() / 1000;
    },

    kill(_pid: number, _signal?: string | number): boolean {
      return false;
    },

    umask(_mask?: number): number {
      return 0o022;
    },

    features: {
      inspector: false,
      debug: false,
      uv: false,
      ipv6: false,
      tls_alpn: false,
      tls_sni: false,
      tls_ocsp: false,
      tls: false,
    },

    release: {
      name: 'node',
    },

    config: {},
    debugPort: 9229,
    allowedNodeEnvironmentFlags: new Set<string>(),
    connected: false,
  };

  return processObj;
}

// ---------------------------------------------------------------------------
// Console routed through process.stdout / process.stderr
// ---------------------------------------------------------------------------

function createWorkerConsole(
  stdoutStream: ReturnType<typeof createStdoutStream>,
  stderrStream: ReturnType<typeof createStderrStream>,
) {
  function formatArgs(args: unknown[]): string {
    return args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
        try {
          return JSON.stringify(a, null, 2);
        } catch {
          return String(a);
        }
      })
      .join(' ');
  }

  return {
    log(...args: unknown[]): void {
      stdoutStream.write(formatArgs(args) + '\n');
    },
    info(...args: unknown[]): void {
      stdoutStream.write(formatArgs(args) + '\n');
    },
    warn(...args: unknown[]): void {
      stderrStream.write(formatArgs(args) + '\n');
    },
    error(...args: unknown[]): void {
      stderrStream.write(formatArgs(args) + '\n');
    },
    debug(...args: unknown[]): void {
      stdoutStream.write(formatArgs(args) + '\n');
    },
    trace(...args: unknown[]): void {
      const err = new Error();
      stderrStream.write('Trace: ' + formatArgs(args) + '\n' + (err.stack ?? '') + '\n');
    },
    dir(obj: unknown): void {
      stdoutStream.write(
        (typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) + '\n',
      );
    },
    time: (() => {
      const timers = new Map<string, number>();
      return function time(label = 'default'): void {
        timers.set(label, performance.now());
      };
    })(),
    timeEnd: (() => {
      const timers = new Map<string, number>();
      return function timeEnd(label = 'default'): void {
        const start = timers.get(label);
        if (start !== undefined) {
          stdoutStream.write(`${label}: ${(performance.now() - start).toFixed(3)}ms\n`);
          timers.delete(label);
        }
      };
    })(),
    assert(condition: unknown, ...args: unknown[]): void {
      if (!condition) {
        stderrStream.write('Assertion failed: ' + formatArgs(args) + '\n');
      }
    },
    clear(): void {
      // no-op in worker context
    },
    count: (() => {
      const counts = new Map<string, number>();
      return function count(label = 'default'): void {
        const c = (counts.get(label) ?? 0) + 1;
        counts.set(label, c);
        stdoutStream.write(`${label}: ${c}\n`);
      };
    })(),
    countReset: (() => {
      const counts = new Map<string, number>();
      return function countReset(label = 'default'): void {
        counts.set(label, 0);
      };
    })(),
    table(data: unknown): void {
      stdoutStream.write(JSON.stringify(data, null, 2) + '\n');
    },
    group(): void {
      // no-op
    },
    groupEnd(): void {
      // no-op
    },
    groupCollapsed(): void {
      // no-op
    },
  };
}

// ---------------------------------------------------------------------------
// Module wrapper pattern (mirrors Node.js internal wrapper)
// ---------------------------------------------------------------------------

function wrapModule(code: string): string {
  return `(function(exports, require, module, __filename, __dirname) {\n${code}\n});`;
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === 'init') {
    syscallBuffer = msg.syscallBuffer as SharedArrayBuffer;
    stdoutPort = msg.stdoutPort as MessagePort;
    stderrPort = msg.stderrPort as MessagePort;
    stdinPort = (msg.stdinPort as MessagePort) ?? null;
    processPid = msg.pid as number;
    processCwd = msg.cwd as string;
    processEnv = msg.env as Record<string, string>;

    // Set up globals
    const stdoutStream = createStdoutStream(stdoutPort);
    const stderrStream = createStderrStream(stderrPort);
    const stdinStream = createStdinStream(stdinPort);
    const proc = buildProcessObject(
      processPid,
      processCwd,
      processEnv,
      stdoutStream,
      stderrStream,
      stdinStream,
    );
    const workerConsole = createWorkerConsole(stdoutStream, stderrStream);

    // Install globals
    (self as any).process = proc;
    (self as any).Buffer = WorkerBuffer;
    (self as any).console = workerConsole;
    (self as any).global = self;
    (self as any).globalThis = self;
    (self as any).__syscall = syscall;

    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'exec') {
    const code = msg.code as string;
    const filename = (msg.filename as string) ?? '<eval>';
    const dirname =
      (msg.dirname as string) ??
      (filename.substring(0, filename.lastIndexOf('/')) || '/');

    // Update argv if command info provided
    const proc = (self as any).process;
    if (msg.argv) {
      proc.argv = msg.argv;
      proc.argv0 = (msg.argv as string[])[0] ?? 'node';
    }

    try {
      const wrapped = wrapModule(code);
      // eslint-disable-next-line no-eval
      const compiledFn = (0, eval)(wrapped);

      const moduleObj = { exports: {} as Record<string, unknown>, id: filename, filename, loaded: false };
      const exportsObj = moduleObj.exports;

      // Basic require stub
      const requireFn = (id: string): unknown => {
        // Handle built-in module stubs
        if (id === 'path' || id === 'node:path') {
          return createPathStub();
        }
        if (id === 'fs' || id === 'node:fs') {
          return createFsStub();
        }
        if (id === 'os' || id === 'node:os') {
          return createOsStub();
        }
        if (id === 'util' || id === 'node:util') {
          return createUtilStub();
        }
        if (id === 'events' || id === 'node:events') {
          return createEventsStub();
        }
        if (id === 'stream' || id === 'node:stream') {
          return createStreamStub();
        }
        if (id === 'buffer' || id === 'node:buffer') {
          return { Buffer: WorkerBuffer };
        }
        if (id === 'process' || id === 'node:process') {
          return proc;
        }

        // Attempt to load from filesystem via syscall
        const resolved = resolveModule(id, dirname);
        if (resolved) {
          return loadModule(resolved);
        }

        throw new Error(`Cannot find module '${id}'`);
      };

      requireFn.resolve = (id: string) => resolveModule(id, dirname) ?? id;
      requireFn.cache = {};
      requireFn.main = moduleObj;

      compiledFn(exportsObj, requireFn, moduleObj, filename, dirname);
      moduleObj.loaded = true;

      self.postMessage({ type: 'exec-complete', exitCode: processExitCode ?? 0 });
    } catch (err: any) {
      if (err.message && err.message.startsWith('process.exit(')) {
        // Controlled exit, already handled
        return;
      }

      const stderrStream = (self as any).process?.stderr;
      if (stderrStream) {
        stderrStream.write(`${err.stack ?? err.message ?? String(err)}\n`);
      }
      self.postMessage({ type: 'exec-complete', exitCode: 1, error: err.message });
    }
    return;
  }
};

// ---------------------------------------------------------------------------
// Module resolution and loading helpers
// ---------------------------------------------------------------------------

const moduleCache = new Map<string, Record<string, unknown>>();

function resolveModule(id: string, fromDir: string): string | null {
  // Relative paths
  if (id.startsWith('./') || id.startsWith('../') || id.startsWith('/')) {
    const basePath = id.startsWith('/') ? id : normalizePath(fromDir + '/' + id);
    // Try exact, .js, .json, /index.js
    for (const candidate of [basePath, basePath + '.js', basePath + '.json', basePath + '/index.js']) {
      try {
        const result = syscall(SyscallType.FS_EXISTS, { path: candidate });
        if (result.metadata.exists) {
          return candidate;
        }
      } catch {
        // continue
      }
    }
    return null;
  }

  // Node modules resolution
  let dir = fromDir;
  while (dir !== '/') {
    const nmDir = dir + '/node_modules/' + id;
    // Try package.json main
    try {
      const pkgResult = syscall(SyscallType.FS_EXISTS, { path: nmDir + '/package.json' });
      if (pkgResult.metadata.exists) {
        const pkgData = syscall(SyscallType.FS_READFILE, {
          path: nmDir + '/package.json',
          encoding: 'utf-8',
        });
        const pkg = JSON.parse(pkgData.metadata.content as string);
        const main = pkg.main ?? 'index.js';
        const mainPath = normalizePath(nmDir + '/' + main);
        // Try exact main and main + .js
        for (const candidate of [mainPath, mainPath + '.js', mainPath + '/index.js']) {
          try {
            const exists = syscall(SyscallType.FS_EXISTS, { path: candidate });
            if (exists.metadata.exists) return candidate;
          } catch {
            // continue
          }
        }
      }
    } catch {
      // continue
    }

    // Try direct file
    for (const candidate of [nmDir + '.js', nmDir + '/index.js', nmDir]) {
      try {
        const result = syscall(SyscallType.FS_EXISTS, { path: candidate });
        if (result.metadata.exists) return candidate;
      } catch {
        // continue
      }
    }

    // Go up one directory
    const parent = dir.substring(0, dir.lastIndexOf('/')) || '/';
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function loadModule(resolvedPath: string): Record<string, unknown> {
  const cached = moduleCache.get(resolvedPath);
  if (cached) return cached;

  const result = syscall(SyscallType.FS_READFILE, { path: resolvedPath, encoding: 'utf-8' });
  const code = result.metadata.content as string;

  if (resolvedPath.endsWith('.json')) {
    const parsed = JSON.parse(code);
    moduleCache.set(resolvedPath, parsed);
    return parsed;
  }

  const moduleObj = { exports: {} as Record<string, unknown>, id: resolvedPath, filename: resolvedPath, loaded: false };
  const exportsObj = moduleObj.exports;
  moduleCache.set(resolvedPath, exportsObj);

  const dirname = resolvedPath.substring(0, resolvedPath.lastIndexOf('/')) || '/';
  const wrapped = wrapModule(code);

  try {
    // eslint-disable-next-line no-eval
    const compiledFn = (0, eval)(wrapped);

    const requireFn = (id: string): unknown => {
      const resolved = resolveModule(id, dirname);
      if (resolved) return loadModule(resolved);

      // Check for built-ins via the main require on the process
      if (id === 'path' || id === 'node:path') return createPathStub();
      if (id === 'fs' || id === 'node:fs') return createFsStub();
      if (id === 'os' || id === 'node:os') return createOsStub();
      if (id === 'util' || id === 'node:util') return createUtilStub();
      if (id === 'events' || id === 'node:events') return createEventsStub();
      if (id === 'stream' || id === 'node:stream') return createStreamStub();
      if (id === 'buffer' || id === 'node:buffer') return { Buffer: WorkerBuffer };
      if (id === 'process' || id === 'node:process') return (self as any).process;

      throw new Error(`Cannot find module '${id}'`);
    };
    requireFn.resolve = (id: string) => resolveModule(id, dirname) ?? id;
    requireFn.cache = {};
    requireFn.main = moduleObj;

    compiledFn(exportsObj, requireFn, moduleObj, resolvedPath, dirname);
    moduleObj.loaded = true;

    // Update cache to module.exports in case it was reassigned
    moduleCache.set(resolvedPath, moduleObj.exports);
    return moduleObj.exports;
  } catch (err) {
    moduleCache.delete(resolvedPath);
    throw err;
  }
}

function normalizePath(p: string): string {
  const parts = p.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return '/' + normalized.join('/');
}

// ---------------------------------------------------------------------------
// Built-in module stubs
// ---------------------------------------------------------------------------

function createPathStub() {
  return {
    join(...segments: string[]): string {
      return normalizePath(segments.join('/'));
    },
    resolve(...segments: string[]): string {
      let resolved = '';
      for (let i = segments.length - 1; i >= 0; i--) {
        resolved = segments[i] + (resolved ? '/' + resolved : '');
        if (segments[i].startsWith('/')) break;
      }
      if (!resolved.startsWith('/')) {
        resolved = processCwd + '/' + resolved;
      }
      return normalizePath(resolved);
    },
    dirname(p: string): string {
      return p.substring(0, p.lastIndexOf('/')) || '/';
    },
    basename(p: string, ext?: string): string {
      const base = p.substring(p.lastIndexOf('/') + 1);
      if (ext && base.endsWith(ext)) {
        return base.substring(0, base.length - ext.length);
      }
      return base;
    },
    extname(p: string): string {
      const base = p.substring(p.lastIndexOf('/') + 1);
      const dotIdx = base.lastIndexOf('.');
      return dotIdx > 0 ? base.substring(dotIdx) : '';
    },
    normalize(p: string): string {
      return normalizePath(p);
    },
    isAbsolute(p: string): boolean {
      return p.startsWith('/');
    },
    relative(from: string, to: string): string {
      const fromParts = normalizePath(from).split('/').filter(Boolean);
      const toParts = normalizePath(to).split('/').filter(Boolean);
      let common = 0;
      while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
        common++;
      }
      const ups = fromParts.length - common;
      const remaining = toParts.slice(common);
      return [...Array(ups).fill('..'), ...remaining].join('/') || '.';
    },
    sep: '/',
    delimiter: ':',
    posix: null as any,
    win32: null as any,
    parse(p: string): Record<string, string> {
      const dir = p.substring(0, p.lastIndexOf('/')) || '/';
      const base = p.substring(p.lastIndexOf('/') + 1);
      const dotIdx = base.lastIndexOf('.');
      const ext = dotIdx > 0 ? base.substring(dotIdx) : '';
      const name = dotIdx > 0 ? base.substring(0, dotIdx) : base;
      return { root: p.startsWith('/') ? '/' : '', dir, base, ext, name };
    },
    format(pathObj: Record<string, string>): string {
      const dir = pathObj.dir ?? '';
      const base = pathObj.base ?? (pathObj.name ?? '') + (pathObj.ext ?? '');
      return dir ? dir + '/' + base : base;
    },
  };
}

function createFsStub() {
  const fs: Record<string, unknown> = {};

  fs.readFileSync = (path: string, options?: string | { encoding?: string }) => {
    const encoding = typeof options === 'string' ? options : options?.encoding;
    const result = syscall(SyscallType.FS_READFILE, { path, encoding });
    if (result.binaryData && !encoding) {
      return WorkerBuffer.from(result.binaryData);
    }
    return result.metadata.content;
  };

  fs.writeFileSync = (path: string, data: string | Uint8Array, options?: string | { encoding?: string; flag?: string; mode?: number }) => {
    const opts = typeof options === 'string' ? { encoding: options } : options ?? {};
    if (typeof data === 'string') {
      syscall(SyscallType.FS_WRITEFILE, { path, content: data, ...opts });
    } else {
      syscall(SyscallType.FS_WRITEFILE, { path, ...opts }, data instanceof Uint8Array ? data : new Uint8Array(data));
    }
  };

  fs.existsSync = (path: string): boolean => {
    try {
      const result = syscall(SyscallType.FS_EXISTS, { path });
      return result.metadata.exists as boolean;
    } catch {
      return false;
    }
  };

  fs.statSync = (path: string) => {
    const result = syscall(SyscallType.FS_STAT, { path });
    return buildStatResult(result.metadata);
  };

  fs.lstatSync = (path: string) => {
    const result = syscall(SyscallType.FS_LSTAT, { path });
    return buildStatResult(result.metadata);
  };

  fs.readdirSync = (path: string, options?: { withFileTypes?: boolean }) => {
    const result = syscall(SyscallType.FS_READDIR, { path, withFileTypes: options?.withFileTypes });
    return result.metadata.entries;
  };

  fs.mkdirSync = (path: string, options?: { recursive?: boolean; mode?: number } | number) => {
    const opts = typeof options === 'number' ? { mode: options } : options ?? {};
    syscall(SyscallType.FS_MKDIR, { path, ...opts });
  };

  fs.rmdirSync = (path: string) => {
    syscall(SyscallType.FS_RMDIR, { path });
  };

  fs.unlinkSync = (path: string) => {
    syscall(SyscallType.FS_UNLINK, { path });
  };

  fs.renameSync = (oldPath: string, newPath: string) => {
    syscall(SyscallType.FS_RENAME, { oldPath, newPath });
  };

  fs.symlinkSync = (target: string, linkPath: string) => {
    syscall(SyscallType.FS_SYMLINK, { target, linkPath });
  };

  fs.readlinkSync = (path: string): string => {
    const result = syscall(SyscallType.FS_READLINK, { path });
    return result.metadata.target as string;
  };

  fs.chmodSync = (path: string, mode: number) => {
    syscall(SyscallType.FS_CHMOD, { path, mode });
  };

  fs.accessSync = (path: string, mode?: number) => {
    syscall(SyscallType.FS_ACCESS, { path, mode });
  };

  fs.realpathSync = (path: string): string => {
    const result = syscall(SyscallType.FS_REALPATH, { path });
    return result.metadata.resolvedPath as string;
  };

  fs.mkdtempSync = (prefix: string): string => {
    const result = syscall(SyscallType.FS_MKDTEMP, { prefix });
    return result.metadata.path as string;
  };

  fs.appendFileSync = (path: string, data: string | Uint8Array) => {
    if (typeof data === 'string') {
      syscall(SyscallType.FS_APPENDFILE, { path, content: data });
    } else {
      syscall(SyscallType.FS_APPENDFILE, { path }, data);
    }
  };

  fs.copyFileSync = (src: string, dest: string) => {
    syscall(SyscallType.FS_COPYFILE, { src, dest });
  };

  // Promise-based versions (wrapping sync calls)
  fs.promises = {
    readFile: async (path: string, options?: string | { encoding?: string }) =>
      (fs.readFileSync as Function)(path, options),
    writeFile: async (path: string, data: string | Uint8Array, options?: string | { encoding?: string }) =>
      (fs.writeFileSync as Function)(path, data, options),
    stat: async (path: string) => (fs.statSync as Function)(path),
    lstat: async (path: string) => (fs.lstatSync as Function)(path),
    readdir: async (path: string, options?: { withFileTypes?: boolean }) =>
      (fs.readdirSync as Function)(path, options),
    mkdir: async (path: string, options?: { recursive?: boolean }) =>
      (fs.mkdirSync as Function)(path, options),
    rmdir: async (path: string) => (fs.rmdirSync as Function)(path),
    unlink: async (path: string) => (fs.unlinkSync as Function)(path),
    rename: async (oldPath: string, newPath: string) =>
      (fs.renameSync as Function)(oldPath, newPath),
    access: async (path: string, mode?: number) =>
      (fs.accessSync as Function)(path, mode),
    realpath: async (path: string) => (fs.realpathSync as Function)(path),
    copyFile: async (src: string, dest: string) =>
      (fs.copyFileSync as Function)(src, dest),
    appendFile: async (path: string, data: string | Uint8Array) =>
      (fs.appendFileSync as Function)(path, data),
  };

  // Constants
  fs.constants = {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
  };

  return fs;
}

function buildStatResult(metadata: Record<string, unknown>) {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    mode: metadata.mode,
    nlink: metadata.nlink,
    uid: metadata.uid,
    gid: metadata.gid,
    rdev: metadata.rdev,
    size: metadata.size,
    blksize: metadata.blksize,
    blocks: metadata.blocks,
    atimeMs: metadata.atimeMs,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    birthtimeMs: metadata.birthtimeMs,
    atime: new Date(metadata.atimeMs as number),
    mtime: new Date(metadata.mtimeMs as number),
    ctime: new Date(metadata.ctimeMs as number),
    birthtime: new Date(metadata.birthtimeMs as number),
    isFile: () => metadata.isFile as boolean,
    isDirectory: () => metadata.isDirectory as boolean,
    isSymbolicLink: () => metadata.isSymbolicLink as boolean,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

function createOsStub() {
  return {
    platform: () => 'linux',
    arch: () => 'wasm',
    type: () => 'Linux',
    release: () => '0.0.0',
    homedir: () => '/home/project',
    tmpdir: () => '/tmp',
    hostname: () => 'webcontainer',
    cpus: () => [{ model: 'WebContainer', speed: 0 }],
    totalmem: () => 256 * 1024 * 1024,
    freemem: () => 128 * 1024 * 1024,
    uptime: () => performance.now() / 1000,
    endianness: () => 'LE',
    networkInterfaces: () => ({}),
    userInfo: () => ({
      uid: 1000,
      gid: 1000,
      username: 'user',
      homedir: '/home/project',
      shell: '/bin/sh',
    }),
    EOL: '\n',
    constants: {
      signals: {},
      errno: {},
      priority: {},
    },
  };
}

function createUtilStub() {
  return {
    inherits(ctor: Function, superCtor: Function): void {
      Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
    },
    inspect(obj: unknown): string {
      try {
        return JSON.stringify(obj, null, 2);
      } catch {
        return String(obj);
      }
    },
    format(fmt: string, ...args: unknown[]): string {
      let i = 0;
      return fmt.replace(/%[sdifjoO%]/g, (match) => {
        if (match === '%%') return '%';
        if (i >= args.length) return match;
        const arg = args[i++];
        switch (match) {
          case '%s': return String(arg);
          case '%d': return Number(arg).toString();
          case '%i': return parseInt(String(arg), 10).toString();
          case '%f': return parseFloat(String(arg)).toString();
          case '%j':
          case '%o':
          case '%O':
            try { return JSON.stringify(arg); } catch { return String(arg); }
          default: return String(arg);
        }
      });
    },
    deprecate<T extends Function>(fn: T, _msg: string): T {
      return fn;
    },
    promisify(fn: Function): (...args: unknown[]) => Promise<unknown> {
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, result: unknown) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
    },
    callbackify(fn: (...args: unknown[]) => Promise<unknown>): (...args: unknown[]) => void {
      return (...args: unknown[]) => {
        const cb = args.pop() as (err: Error | null, result?: unknown) => void;
        fn(...args).then(
          (result) => cb(null, result),
          (err) => cb(err),
        );
      };
    },
    types: {
      isPromise: (val: unknown): val is Promise<unknown> => val instanceof Promise,
      isDate: (val: unknown): val is Date => val instanceof Date,
      isRegExp: (val: unknown): val is RegExp => val instanceof RegExp,
    },
    TextEncoder,
    TextDecoder,
  };
}

function createEventsStub() {
  class EventEmitter {
    private _events: Map<string, Array<(...args: unknown[]) => void>> = new Map();
    private _maxListeners: number = 10;

    on(event: string, listener: (...args: unknown[]) => void): this {
      let arr = this._events.get(event);
      if (!arr) {
        arr = [];
        this._events.set(event, arr);
      }
      arr.push(listener);
      return this;
    }

    addListener = this.on;

    once(event: string, listener: (...args: unknown[]) => void): this {
      const wrapper = (...args: unknown[]) => {
        this.removeListener(event, wrapper);
        listener(...args);
      };
      return this.on(event, wrapper);
    }

    off(event: string, listener: (...args: unknown[]) => void): this {
      return this.removeListener(event, listener);
    }

    removeListener(event: string, listener: (...args: unknown[]) => void): this {
      const arr = this._events.get(event);
      if (arr) {
        const idx = arr.indexOf(listener);
        if (idx !== -1) arr.splice(idx, 1);
        if (arr.length === 0) this._events.delete(event);
      }
      return this;
    }

    removeAllListeners(event?: string): this {
      if (event) {
        this._events.delete(event);
      } else {
        this._events.clear();
      }
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      const arr = this._events.get(event);
      if (!arr || arr.length === 0) return false;
      for (const listener of [...arr]) {
        listener(...args);
      }
      return true;
    }

    listenerCount(event: string): number {
      return this._events.get(event)?.length ?? 0;
    }

    listeners(event: string): Array<(...args: unknown[]) => void> {
      return [...(this._events.get(event) ?? [])];
    }

    rawListeners(event: string): Array<(...args: unknown[]) => void> {
      return this.listeners(event);
    }

    eventNames(): string[] {
      return [...this._events.keys()];
    }

    setMaxListeners(n: number): this {
      this._maxListeners = n;
      return this;
    }

    getMaxListeners(): number {
      return this._maxListeners;
    }

    prependListener(event: string, listener: (...args: unknown[]) => void): this {
      let arr = this._events.get(event);
      if (!arr) {
        arr = [];
        this._events.set(event, arr);
      }
      arr.unshift(listener);
      return this;
    }

    prependOnceListener(event: string, listener: (...args: unknown[]) => void): this {
      const wrapper = (...args: unknown[]) => {
        this.removeListener(event, wrapper);
        listener(...args);
      };
      return this.prependListener(event, wrapper);
    }

    static defaultMaxListeners = 10;
  }

  const mod = EventEmitter as unknown as Record<string, unknown>;
  mod.EventEmitter = EventEmitter;
  mod.default = EventEmitter;
  return mod;
}

function createStreamStub() {
  const events = createEventsStub();
  const EventEmitter = events.EventEmitter as any;

  class Readable extends EventEmitter {
    readable = true;
    read(): null { return null; }
    pipe(dest: any): any { return dest; }
    unpipe(): this { return this; }
    resume(): this { return this; }
    pause(): this { return this; }
    setEncoding(): this { return this; }
    destroy(): this { this.readable = false; return this; }
  }

  class Writable extends EventEmitter {
    writable = true;
    write(_chunk: unknown, _encoding?: string, cb?: () => void): boolean {
      if (cb) queueMicrotask(cb);
      return true;
    }
    end(_chunk?: unknown, _encoding?: string, cb?: () => void): this {
      this.writable = false;
      if (cb) queueMicrotask(cb);
      return this;
    }
    destroy(): this { this.writable = false; return this; }
  }

  class Duplex extends Readable {
    writable = true;
    write(_chunk: unknown, _encoding?: string, cb?: () => void): boolean {
      if (cb) queueMicrotask(cb);
      return true;
    }
    end(_chunk?: unknown, _encoding?: string, cb?: () => void): this {
      this.writable = false;
      if (cb) queueMicrotask(cb);
      return this;
    }
  }

  class Transform extends Duplex {
    _transform(chunk: unknown, _encoding: string, cb: (err?: Error | null, data?: unknown) => void): void {
      cb(null, chunk);
    }
  }

  class PassThrough extends Transform {}

  return { Readable, Writable, Duplex, Transform, PassThrough, Stream: Readable };
}

// This export is a no-op but signals to TypeScript that this file is a module.
export type WorkerRuntimeModule = typeof self;
