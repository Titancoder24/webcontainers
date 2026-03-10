import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';

export class ChildProcess extends EventEmitter {
  pid: number;
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed: boolean = false;
  connected: boolean = true;

  constructor(pid: number) {
    super();
    this.pid = pid;
    this.stdin = new Writable();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.signalCode = signal ?? 'SIGTERM';

    if (typeof (globalThis as any).__syscall === 'function') {
      (globalThis as any).__syscall(51 /* PROCESS_KILL */, { pid: this.pid, signal: signal ?? 'SIGTERM' });
    }

    queueMicrotask(() => {
      this.emit('exit', null, this.signalCode);
      this.emit('close', null, this.signalCode);
    });

    return true;
  }

  disconnect(): void {
    this.connected = false;
    this.emit('disconnect');
  }

  send(message: any, callback?: (err: Error | null) => void): boolean {
    // IPC messaging via MessageChannel
    if (callback) queueMicrotask(() => callback(null));
    return true;
  }

  ref(): this { return this; }
  unref(): this { return this; }
}

export function spawn(command: string, args?: string[], options?: { cwd?: string; env?: Record<string, string>; stdio?: any }): ChildProcess {
  const pid = Math.floor(Math.random() * 10000) + 100;
  const child = new ChildProcess(pid);

  if (typeof (globalThis as any).__syscall === 'function') {
    try {
      (globalThis as any).__syscall(50 /* PROCESS_SPAWN */, {
        cmd: command,
        args: args ?? [],
        cwd: options?.cwd ?? (globalThis as any).process?.cwd?.() ?? '/home/project',
        env: options?.env ?? {},
      });
    } catch {
      // Spawn via syscall
    }
  }

  return child;
}

export function exec(
  command: string,
  options?: { cwd?: string; env?: Record<string, string>; encoding?: string },
  callback?: (err: Error | null, stdout: string, stderr: string) => void
): ChildProcess {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  const parts = command.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  const child = spawn(cmd, args, options);

  let stdout = '';
  let stderr = '';

  if (child.stdout) {
    child.stdout.on('data', (chunk: any) => {
      stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk: any) => {
      stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    });
  }

  child.on('exit', (code: number) => {
    if (callback) {
      if (code !== 0) {
        const err = new Error(`Command failed: ${command}`) as Error & { code: number };
        err.code = code;
        callback(err, stdout, stderr);
      } else {
        callback(null, stdout, stderr);
      }
    }
  });

  return child;
}

export function execSync(command: string, options?: { cwd?: string; encoding?: string }): string | Buffer {
  // In a worker context with SharedArrayBuffer, this could be truly synchronous
  // For now, throw as it requires synchronous blocking
  if (typeof (globalThis as any).__syscall === 'function') {
    const parts = command.split(/\s+/);
    const result = (globalThis as any).__syscall(50 /* PROCESS_SPAWN */, {
      cmd: parts[0],
      args: parts.slice(1),
      cwd: options?.cwd ?? '/home/project',
      sync: true,
    });
    return result?.stdout ?? '';
  }
  throw new Error(`execSync not available outside worker context`);
}

export function fork(modulePath: string, args?: string[], options?: { cwd?: string; env?: Record<string, string> }): ChildProcess {
  return spawn('node', [modulePath, ...(args ?? [])], options);
}

export function execFile(
  file: string,
  args?: string[],
  options?: { cwd?: string; env?: Record<string, string> },
  callback?: (err: Error | null, stdout: string, stderr: string) => void
): ChildProcess {
  return spawn(file, args, options);
}

export default { spawn, exec, execSync, fork, execFile, ChildProcess };
