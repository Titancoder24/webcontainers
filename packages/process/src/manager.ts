/**
 * ProcessManager
 *
 * Manages the lifecycle of Web Worker processes that emulate Node.js.
 * Each spawned process gets its own Worker, SharedArrayBuffer for synchronous
 * syscalls, and MessageChannel pairs for stdio streams.
 */

import {
  type ProcessEntry,
  type SpawnOptions,
  SAB_STATUS_OFFSET,
  SAB_SYSCALL_TYPE_OFFSET,
  SAB_REQUEST_LENGTH_OFFSET,
  SAB_RESPONSE_LENGTH_OFFSET,
  SAB_ERROR_CODE_OFFSET,
  SAB_PAYLOAD_OFFSET,
  STATUS_IDLE,
  STATUS_REQUEST,
  STATUS_RESPONSE,
  STATUS_ERROR,
  encodePayload,
  decodePayload,
  SyscallType,
} from '@aspect/shared';

import { SyscallDispatcher, SABPool } from '@aspect/kernel';

import { createWorker } from './worker-host.js';

// ---------------------------------------------------------------------------
// ProcessHandle — the public API returned from spawn()
// ---------------------------------------------------------------------------

export class ProcessHandle {
  /** The process identifier. */
  readonly pid: number;

  /** Readable stream of stdout data. */
  readonly stdout: ReadableStream<string>;

  /** Readable stream of stderr data. */
  readonly stderr: ReadableStream<string>;

  /** Writable stream connected to the process's stdin. */
  readonly stdin: WritableStream<string>;

  /** Resolves with the exit code when the process terminates. */
  readonly exit: Promise<number>;

  private readonly _killFn: (signal?: number) => void;

  constructor(
    pid: number,
    stdout: ReadableStream<string>,
    stderr: ReadableStream<string>,
    stdin: WritableStream<string>,
    exit: Promise<number>,
    killFn: (signal?: number) => void,
  ) {
    this.pid = pid;
    this.stdout = stdout;
    this.stderr = stderr;
    this.stdin = stdin;
    this.exit = exit;
    this._killFn = killFn;
  }

  /**
   * Send a signal to the process. Default signal is SIGTERM (15).
   */
  kill(signal: number = 15): void {
    this._killFn(signal);
  }
}

// ---------------------------------------------------------------------------
// ProcessManager
// ---------------------------------------------------------------------------

export class ProcessManager {
  private readonly pidTable: Map<number, ProcessEntry> = new Map();
  private nextPid: number = 1;
  private readonly sabPool: SABPool;
  private readonly syscallDispatcher: SyscallDispatcher;

  /** Interval IDs for syscall monitoring loops keyed by PID. */
  private readonly monitorIntervals: Map<number, ReturnType<typeof setInterval>> = new Map();

  constructor(syscallDispatcher: SyscallDispatcher, sabPool: SABPool) {
    this.syscallDispatcher = syscallDispatcher;
    this.sabPool = sabPool;
  }

  // -----------------------------------------------------------------------
  // spawn
  // -----------------------------------------------------------------------

  /**
   * Spawn a new process.
   *
   * Allocates a PID, obtains a SharedArrayBuffer from the pool, creates
   * MessageChannels for stdio, creates a Worker, sends the init message,
   * starts the syscall monitoring loop, and returns a ProcessHandle.
   */
  spawn(
    cmd: string,
    args: string[] = [],
    options: SpawnOptions = {},
  ): ProcessHandle {
    const pid = this.nextPid++;
    const cwd = options.cwd ?? '/home/project';
    const env = options.env ?? { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/project', USER: 'user', NODE_ENV: 'development' };

    // Allocate a SharedArrayBuffer for the synchronous syscall bridge
    const sab = this.sabPool.allocate();

    // Create MessageChannels for stdio
    const stdoutChannel = new MessageChannel();
    const stderrChannel = new MessageChannel();
    const stdinChannel = new MessageChannel();

    // Create the worker
    const worker = createWorker();

    // Build the process table entry
    const entry: ProcessEntry = {
      pid,
      ppid: 0,
      cmd,
      args,
      cwd,
      env,
      state: 'running',
      exitCode: null,
      worker,
      childPids: [],
      stdoutPort: stdoutChannel.port1,
      stderrPort: stderrChannel.port1,
      stdinPort: stdinChannel.port1,
      syscallBuffer: sab,
    };

    this.pidTable.set(pid, entry);

    // ------------------------------------------------------------------
    // Wire up stdio ReadableStreams / WritableStream
    // ------------------------------------------------------------------

    let stdoutController: ReadableStreamDefaultController<string>;
    let stderrController: ReadableStreamDefaultController<string>;

    const stdout = new ReadableStream<string>({
      start(controller) {
        stdoutController = controller;
      },
    });

    const stderr = new ReadableStream<string>({
      start(controller) {
        stderrController = controller;
      },
    });

    // Listen on our end of the stdout / stderr MessageChannels
    stdoutChannel.port1.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type === 'stdout' && stdoutController) {
        try {
          stdoutController.enqueue(ev.data.data as string);
        } catch {
          // stream may already be closed
        }
      }
    };

    stderrChannel.port1.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type === 'stderr' && stderrController) {
        try {
          stderrController.enqueue(ev.data.data as string);
        } catch {
          // stream may already be closed
        }
      }
    };

    // stdin: WritableStream that posts messages to the worker's stdinPort
    const stdinPortRef = stdinChannel.port1;
    const stdin = new WritableStream<string>({
      write(chunk) {
        stdinPortRef.postMessage(chunk);
      },
    });

    // ------------------------------------------------------------------
    // Exit promise
    // ------------------------------------------------------------------

    let resolveExit: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });

    // ------------------------------------------------------------------
    // Worker message handler
    // ------------------------------------------------------------------

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;

      if (msg.type === 'ready') {
        // Worker is initialised and ready to execute code
        return;
      }

      if (msg.type === 'exit' || msg.type === 'exec-complete') {
        const exitCode = (msg.exitCode as number) ?? 0;
        this.cleanupProcess(pid, exitCode);

        // Close the readable streams
        try { stdoutController?.close(); } catch { /* already closed */ }
        try { stderrController?.close(); } catch { /* already closed */ }

        resolveExit!(exitCode);
        return;
      }
    };

    worker.onerror = (ev: ErrorEvent) => {
      const stderrCtrl = stderrController;
      if (stderrCtrl) {
        try {
          stderrCtrl.enqueue(`Worker error: ${ev.message}\n`);
        } catch { /* stream closed */ }
      }
      this.cleanupProcess(pid, 1);
      try { stdoutController?.close(); } catch { /* already closed */ }
      try { stderrController?.close(); } catch { /* already closed */ }
      resolveExit!(1);
    };

    // ------------------------------------------------------------------
    // Send init message to the worker (transfer the ports)
    // ------------------------------------------------------------------

    worker.postMessage(
      {
        type: 'init',
        pid,
        cwd,
        env,
        syscallBuffer: sab,
        stdoutPort: stdoutChannel.port2,
        stderrPort: stderrChannel.port2,
        stdinPort: stdinChannel.port2,
      },
      [stdoutChannel.port2, stderrChannel.port2, stdinChannel.port2],
    );

    // ------------------------------------------------------------------
    // Start the syscall monitoring loop
    // ------------------------------------------------------------------

    this.startSyscallMonitor(entry);

    // ------------------------------------------------------------------
    // Build and return the handle
    // ------------------------------------------------------------------

    const handle = new ProcessHandle(
      pid,
      stdout,
      stderr,
      stdin,
      exitPromise,
      (signal?: number) => this.kill(pid, signal ?? 15),
    );

    return handle;
  }

  // -----------------------------------------------------------------------
  // kill
  // -----------------------------------------------------------------------

  /**
   * Kill a process by PID.
   */
  kill(pid: number, signal: number = 15): void {
    const entry = this.pidTable.get(pid);
    if (!entry || entry.state !== 'running') {
      return;
    }

    this.cleanupProcess(pid, 128 + signal);

    // Forcefully terminate the worker
    if (entry.worker) {
      entry.worker.terminate();
    }
  }

  // -----------------------------------------------------------------------
  // Process table accessors
  // -----------------------------------------------------------------------

  /**
   * Get a process entry by PID.
   */
  getProcess(pid: number): ProcessEntry | undefined {
    return this.pidTable.get(pid);
  }

  /**
   * Get the working directory of a process.
   */
  getCwd(pid: number): string {
    const entry = this.pidTable.get(pid);
    return entry?.cwd ?? '/home/project';
  }

  /**
   * Change the working directory of a process.
   */
  chdir(pid: number, dir: string): void {
    const entry = this.pidTable.get(pid);
    if (entry) {
      entry.cwd = dir;
    }
  }

  /**
   * Handle process exit notification from the worker.
   */
  exit(pid: number, code: number): void {
    this.cleanupProcess(pid, code);
  }

  /**
   * List all active (running) PIDs.
   */
  listPids(): number[] {
    const pids: number[] = [];
    for (const [pid, entry] of this.pidTable) {
      if (entry.state === 'running') {
        pids.push(pid);
      }
    }
    return pids;
  }

  /**
   * Get the total number of entries in the process table (all states).
   */
  get size(): number {
    return this.pidTable.size;
  }

  // -----------------------------------------------------------------------
  // Syscall monitoring
  // -----------------------------------------------------------------------

  /**
   * Start a polling loop that checks the SharedArrayBuffer for incoming
   * syscall requests from the worker. When a STATUS_REQUEST is detected
   * the request is decoded, dispatched to the SyscallDispatcher, and
   * the response (or error) is written back to the SAB so the worker
   * can resume via Atomics.wait / Atomics.notify.
   */
  private startSyscallMonitor(entry: ProcessEntry): void {
    const sab = entry.syscallBuffer;
    if (!sab) return;

    const statusArray = new Int32Array(sab);
    const view = new DataView(sab);

    const intervalId = setInterval(() => {
      // Quick check — avoid decoding overhead when idle
      const status = Atomics.load(statusArray, SAB_STATUS_OFFSET / 4);
      if (status !== STATUS_REQUEST) {
        return;
      }

      this.dispatchSyscall(entry, sab, statusArray, view);
    }, 1);

    this.monitorIntervals.set(entry.pid, intervalId);
  }

  /**
   * Decode the syscall request from the SAB, dispatch it, and write the
   * response back.
   */
  private dispatchSyscall(
    entry: ProcessEntry,
    sab: SharedArrayBuffer,
    statusArray: Int32Array,
    view: DataView,
  ): void {
    // Read syscall type
    const syscallType = view.getInt32(SAB_SYSCALL_TYPE_OFFSET, true) as SyscallType;

    // Decode the request payload
    let metadata: Record<string, unknown> = {};
    let binaryData: Uint8Array | null = null;

    const requestLength = view.getInt32(SAB_REQUEST_LENGTH_OFFSET, true);
    if (requestLength > 0) {
      try {
        const decoded = decodePayload(sab, SAB_PAYLOAD_OFFSET);
        metadata = decoded.metadata;
        binaryData = decoded.binaryData;
      } catch {
        // If decoding fails, send an error response
        this.writeSyscallError(sab, statusArray, view, 'EINVAL', 'Failed to decode syscall payload', -22);
        return;
      }
    }

    // Dispatch to the SyscallDispatcher
    const result = this.syscallDispatcher.handleSyscall(
      syscallType,
      metadata,
      binaryData,
      entry.pid,
    );

    if (result.error) {
      this.writeSyscallError(
        sab,
        statusArray,
        view,
        result.error.code,
        result.error.message,
        result.error.errno,
      );
      return;
    }

    // Write success response
    const responseData = result.data ?? {};
    const responseBinary = result.binaryData;
    const responseLength = encodePayload(sab, SAB_PAYLOAD_OFFSET, responseData, responseBinary);

    view.setInt32(SAB_RESPONSE_LENGTH_OFFSET, responseLength, true);
    view.setInt32(SAB_ERROR_CODE_OFFSET, 0, true);

    // Signal response ready
    Atomics.store(statusArray, SAB_STATUS_OFFSET / 4, STATUS_RESPONSE);
    Atomics.notify(statusArray, SAB_STATUS_OFFSET / 4);
  }

  /**
   * Write an error response to the SAB and notify the worker.
   */
  private writeSyscallError(
    sab: SharedArrayBuffer,
    statusArray: Int32Array,
    view: DataView,
    code: string,
    message: string,
    errno: number,
  ): void {
    const errorPayload = { code, message };
    const responseLength = encodePayload(sab, SAB_PAYLOAD_OFFSET, errorPayload);

    view.setInt32(SAB_RESPONSE_LENGTH_OFFSET, responseLength, true);
    view.setInt32(SAB_ERROR_CODE_OFFSET, errno, true);

    Atomics.store(statusArray, SAB_STATUS_OFFSET / 4, STATUS_ERROR);
    Atomics.notify(statusArray, SAB_STATUS_OFFSET / 4);
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Mark a process as exited, stop its syscall monitor, and release its
   * SharedArrayBuffer back to the pool.
   */
  private cleanupProcess(pid: number, exitCode: number): void {
    const entry = this.pidTable.get(pid);
    if (!entry) return;

    // Stop the syscall monitor
    const intervalId = this.monitorIntervals.get(pid);
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      this.monitorIntervals.delete(pid);
    }

    // Update state
    entry.state = 'exited';
    entry.exitCode = exitCode;

    // Release the SAB back to the pool
    if (entry.syscallBuffer) {
      this.sabPool.release(entry.syscallBuffer);
      entry.syscallBuffer = null;
    }

    // Close stdio ports
    try { entry.stdoutPort?.close(); } catch { /* ignore */ }
    try { entry.stderrPort?.close(); } catch { /* ignore */ }
    try { entry.stdinPort?.close(); } catch { /* ignore */ }

    entry.stdoutPort = null;
    entry.stderrPort = null;
    entry.stdinPort = null;
    entry.worker = null;
  }

  /**
   * Terminate all running processes and release all resources.
   */
  dispose(): void {
    for (const [pid, entry] of this.pidTable) {
      if (entry.state === 'running') {
        if (entry.worker) {
          entry.worker.terminate();
        }
        this.cleanupProcess(pid, 137); // SIGKILL
      }
    }
    this.pidTable.clear();
  }
}
