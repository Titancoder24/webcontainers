/**
 * Child process shim using PROCESS_SPAWN syscall.
 */

import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';
import { Buffer } from './buffer.js';
import { SyscallType } from '@aspect/shared';
import type { SpawnOptions } from '@aspect/shared';

type SyscallFn = (type: SyscallType, args: Record<string, unknown>) => unknown;

function getSyscall(): SyscallFn {
  const g = globalThis as unknown as { __syscall?: SyscallFn };
  if (!g.__syscall) {
    throw new Error('No syscall bridge available. child_process operations require a WebContainer runtime.');
  }
  return g.__syscall;
}

export class ChildProcess extends EventEmitter {
  pid: number = 0;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed: boolean = false;
  connected: boolean = true;
  spawnfile: string = '';
  spawnargs: string[] = [];

  stdin: Writable | null = null;
  stdout: Readable | null = null;
  stderr: Readable | null = null;

  private _stdio: (Readable | Writable | null)[] = [];

  constructor() {
    super();
  }

  kill(signal?: string | number): boolean {
    if (this.killed) return false;

    const sig = signal || 'SIGTERM';
    this.killed = true;
    this.signalCode = typeof sig === 'string' ? sig : `SIGNAL_${sig}`;

    try {
      const syscall = getSyscall();
      syscall(SyscallType.PROCESS_KILL, { pid: this.pid, signal: sig });
    } catch {
      // Process may already be dead
    }

    return true;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  disconnect(): void {
    this.connected = false;
    this.emit('disconnect');
  }

  send(message: unknown, _sendHandle?: unknown, _options?: unknown, callback?: (error: Error | null) => void): boolean {
    // IPC not fully supported in browser shim
    if (callback) callback(null);
    return true;
  }

  get stdio(): (Readable | Writable | null)[] {
    return this._stdio;
  }

  _setupStdio(stdinOption?: string, stdoutOption?: string, stderrOption?: string): void {
    if (stdinOption !== 'inherit') {
      this.stdin = new Writable({
        write: (_chunk: Buffer | string, _encoding: string, callback: (err?: Error | null) => void) => {
          callback();
        },
      });
    }

    if (stdoutOption !== 'inherit') {
      this.stdout = new Readable();
    }

    if (stderrOption !== 'inherit') {
      this.stderr = new Readable();
    }

    this._stdio = [this.stdin, this.stdout, this.stderr];
  }
}

export function spawn(
  command: string,
  args?: string[] | SpawnOptions,
  options?: SpawnOptions
): ChildProcess {
  let actualArgs: string[];
  let actualOptions: SpawnOptions;

  if (Array.isArray(args)) {
    actualArgs = args;
    actualOptions = options || {};
  } else {
    actualArgs = [];
    actualOptions = args || {};
  }

  const child = new ChildProcess();
  child.spawnfile = command;
  child.spawnargs = [command, ...actualArgs];

  child._setupStdio(
    actualOptions.stdin,
    actualOptions.stdout,
    actualOptions.stderr
  );

  try {
    const syscall = getSyscall();
    const result = syscall(SyscallType.PROCESS_SPAWN, {
      cmd: command,
      args: actualArgs,
      cwd: actualOptions.cwd,
      env: actualOptions.env,
      stdin: actualOptions.stdin || 'pipe',
      stdout: actualOptions.stdout || 'pipe',
      stderr: actualOptions.stderr || 'pipe',
    }) as { pid: number; error?: string };

    if (result.error) {
      queueMicrotask(() => {
        child.emit('error', new Error(result.error));
      });
    } else {
      child.pid = result.pid;
      child.connected = true;
    }
  } catch (err) {
    queueMicrotask(() => {
      child.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
  }

  return child;
}

export function exec(
  command: string,
  optionsOrCallback?: { cwd?: string; env?: Record<string, string>; encoding?: string; timeout?: number; maxBuffer?: number } | ((error: Error | null, stdout: string, stderr: string) => void),
  callback?: (error: Error | null, stdout: string, stderr: string) => void
): ChildProcess {
  let options: { cwd?: string; env?: Record<string, string>; encoding?: string; timeout?: number; maxBuffer?: number } = {};
  let cb: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;

  if (typeof optionsOrCallback === 'function') {
    cb = optionsOrCallback;
  } else {
    options = optionsOrCallback || {};
    cb = callback;
  }

  const parts = parseCommand(command);
  const cmd = parts[0];
  const args = parts.slice(1);

  const child = spawn(cmd, args, {
    cwd: options.cwd,
    env: options.env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const maxBuffer = options.maxBuffer || 1024 * 1024;
  let stdoutLen = 0;
  let stderrLen = 0;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;

  if (options.timeout && options.timeout > 0) {
    timeoutHandle = globalThis.setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeout);
  }

  if (child.stdout) {
    child.stdout.on('data', (data: unknown) => {
      const buf = typeof data === 'string' ? Buffer.from(data) : data as Buffer;
      stdoutLen += buf.length;
      if (stdoutLen > maxBuffer) {
        child.kill('SIGTERM');
        return;
      }
      stdoutChunks.push(buf);
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (data: unknown) => {
      const buf = typeof data === 'string' ? Buffer.from(data) : data as Buffer;
      stderrLen += buf.length;
      if (stderrLen > maxBuffer) {
        child.kill('SIGTERM');
        return;
      }
      stderrChunks.push(buf);
    });
  }

  child.on('close', (code: number) => {
    if (timeoutHandle) {
      globalThis.clearTimeout(timeoutHandle);
    }

    const encoding = options.encoding || 'utf8';
    const stdout = Buffer.concat(stdoutChunks).toString(encoding);
    const stderr = Buffer.concat(stderrChunks).toString(encoding);

    let error: (Error & { code?: number; killed?: boolean; signal?: string }) | null = null;
    if (code !== 0 || timedOut) {
      error = new Error(`Command failed: ${command}`);
      error.code = code;
      error.killed = timedOut;
      if (timedOut) error.signal = 'SIGTERM';
    }

    if (cb) cb(error, stdout, stderr);
  });

  child.on('error', (err: Error) => {
    if (timeoutHandle) {
      globalThis.clearTimeout(timeoutHandle);
    }
    if (cb) cb(err, '', '');
  });

  return child;
}

export function execSync(
  command: string,
  options?: { cwd?: string; env?: Record<string, string>; encoding?: string; timeout?: number; input?: string | Buffer }
): string | Buffer {
  const syscall = getSyscall();
  const parts = parseCommand(command);
  const cmd = parts[0];
  const args = parts.slice(1);

  const result = syscall(SyscallType.PROCESS_SPAWN, {
    cmd,
    args,
    cwd: options?.cwd,
    env: options?.env,
    stdin: options?.input ? 'pipe' : 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
    sync: true,
    input: options?.input,
  }) as { stdout: Uint8Array; stderr: Uint8Array; status: number; error?: string };

  if (result.error) {
    throw new Error(result.error);
  }

  if (result.status !== 0) {
    const err = new Error(`Command failed: ${command}`) as Error & { status: number; stdout: Buffer; stderr: Buffer };
    err.status = result.status;
    err.stdout = Buffer.from(result.stdout || new Uint8Array(0));
    err.stderr = Buffer.from(result.stderr || new Uint8Array(0));
    throw err;
  }

  const encoding = options?.encoding;
  const stdout = Buffer.from(result.stdout || new Uint8Array(0));

  if (encoding && encoding !== 'buffer') {
    return stdout.toString(encoding);
  }
  return stdout;
}

export function execFile(
  file: string,
  args?: string[] | ((error: Error | null, stdout: string, stderr: string) => void),
  options?: { cwd?: string; env?: Record<string, string>; encoding?: string; timeout?: number; maxBuffer?: number } | ((error: Error | null, stdout: string, stderr: string) => void),
  callback?: (error: Error | null, stdout: string, stderr: string) => void
): ChildProcess {
  let actualArgs: string[];
  let actualOptions: { cwd?: string; env?: Record<string, string> } = {};
  let cb: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;

  if (typeof args === 'function') {
    cb = args;
    actualArgs = [];
  } else {
    actualArgs = args || [];
    if (typeof options === 'function') {
      cb = options;
    } else {
      actualOptions = options || {};
      cb = callback;
    }
  }

  const command = file + (actualArgs.length > 0 ? ' ' + actualArgs.join(' ') : '');
  return exec(command, { ...actualOptions, encoding: 'utf8' }, cb);
}

export function fork(
  modulePath: string,
  args?: string[] | { cwd?: string; env?: Record<string, string> },
  options?: { cwd?: string; env?: Record<string, string> }
): ChildProcess {
  let actualArgs: string[];
  let actualOptions: { cwd?: string; env?: Record<string, string> };

  if (Array.isArray(args)) {
    actualArgs = args;
    actualOptions = options || {};
  } else {
    actualArgs = [];
    actualOptions = args || {};
  }

  const child = spawn('node', [modulePath, ...actualArgs], {
    cwd: actualOptions.cwd,
    env: actualOptions.env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  child.send = (message: unknown, _sendHandle?: unknown, _options?: unknown, callback?: (error: Error | null) => void): boolean => {
    try {
      const syscall = getSyscall();
      syscall(SyscallType.PROCESS_SPAWN, {
        pid: child.pid,
        ipcMessage: message,
      });
      if (callback) callback(null);
      return true;
    } catch (err) {
      if (callback) callback(err as Error);
      return false;
    }
  };

  return child;
}

export function spawnSync(
  command: string,
  args?: string[],
  options?: { cwd?: string; env?: Record<string, string>; encoding?: string; input?: string | Buffer; timeout?: number }
): { stdout: Buffer | string; stderr: Buffer | string; status: number | null; signal: string | null; error?: Error } {
  try {
    const syscall = getSyscall();
    const result = syscall(SyscallType.PROCESS_SPAWN, {
      cmd: command,
      args: args || [],
      cwd: options?.cwd,
      env: options?.env,
      stdin: options?.input ? 'pipe' : 'inherit',
      stdout: 'pipe',
      stderr: 'pipe',
      sync: true,
      input: options?.input,
    }) as { stdout: Uint8Array; stderr: Uint8Array; status: number; error?: string };

    const encoding = options?.encoding;
    const stdout = Buffer.from(result.stdout || new Uint8Array(0));
    const stderr = Buffer.from(result.stderr || new Uint8Array(0));

    return {
      stdout: encoding && encoding !== 'buffer' ? stdout.toString(encoding) : stdout,
      stderr: encoding && encoding !== 'buffer' ? stderr.toString(encoding) : stderr,
      status: result.status,
      signal: null,
      error: result.error ? new Error(result.error) : undefined,
    };
  } catch (err) {
    return {
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: null,
      signal: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

function parseCommand(cmd: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];

    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      escape = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (ch === ' ' && !inSingle && !inDouble) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

export default {
  ChildProcess,
  spawn,
  exec,
  execSync,
  execFile,
  fork,
  spawnSync,
};
