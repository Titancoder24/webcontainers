/**
 * Shell executor - walks the AST and runs commands.
 *
 * Builtins are handled directly. External commands are delegated to a
 * user-supplied {@link SpawnFunction}.
 */

import type {
  ASTNode,
  CommandNode,
  PipelineNode,
  SequenceNode,
  BackgroundNode,
  SubshellNode,
  Redirect,
} from './parser.js';
import { builtins, type ShellContext, type BuiltinFn } from './builtins.js';
import { expandGlob, hasGlobChars, type ReaddirFn } from './glob.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Function called to spawn an external (non-builtin) command.
 * The shell provides the resolved binary path, arguments, environment, cwd,
 * and stdin data (if piped).
 */
export type SpawnFunction = (options: {
  cmd: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
  stdout?: 'pipe' | 'inherit';
  stderr?: 'pipe' | 'inherit';
}) => Promise<SpawnResult>;

export interface ExecutorOptions {
  /** Function to spawn external commands. */
  spawn: SpawnFunction;
  /** Current working directory. */
  cwd: string;
  /** Environment variables. */
  env: Record<string, string>;
  /** Aliases map. */
  aliases: Map<string, string>;
  /** History list. */
  history: string[];
  /** Write to stdout. */
  stdout: (data: string) => void;
  /** Write to stderr. */
  stderr: (data: string) => void;
  /** Callback to change cwd. */
  setCwd: (path: string) => void;
  /** Resolve a relative path against cwd. */
  resolvePath: (p: string) => string;
  /** Check if path is a directory. */
  isDirectory: (path: string) => boolean;
  /** Read a file as text. */
  readFile: (path: string) => string;
  /** Write a file (for output redirects). */
  writeFile: (path: string, data: string) => void;
  /** Append to a file (for >> redirects). */
  appendFile: (path: string, data: string) => void;
  /** List directory entries (for glob expansion). */
  readdir: ReaddirFn;
  /** Execute a shell string (for `source`). */
  executeCommand?: (input: string) => Promise<number>;
  /** Request shell exit. */
  requestExit?: (code: number) => void;
  /** Resolve a binary name to its full path via $PATH lookup. */
  resolveBinary?: (name: string) => string | null;
}

// ── Executor ────────────────────────────────────────────────────────────────

export class Executor {
  private opts: ExecutorOptions;
  private lastExitCode: number = 0;

  constructor(opts: ExecutorOptions) {
    this.opts = opts;
  }

  /**
   * Execute an AST node and return the exit code.
   */
  async execute(node: ASTNode): Promise<number> {
    switch (node.type) {
      case 'command':
        return this.executeCommand(node);
      case 'pipeline':
        return this.executePipeline(node);
      case 'sequence':
        return this.executeSequence(node);
      case 'background':
        return this.executeBackground(node);
      case 'subshell':
        return this.executeSubshell(node);
      default:
        this.opts.stderr(`executor: unknown node type: ${(node as ASTNode).type}\n`);
        return 1;
    }
  }

  // ── Command ─────────────────────────────────────────────────────────────

  private async executeCommand(
    node: CommandNode,
    stdinData?: string,
    captureStdout?: boolean,
  ): Promise<number>;
  private async executeCommand(
    node: CommandNode,
    stdinData: string | undefined,
    captureStdout: true,
  ): Promise<{ exitCode: number; stdout: string }>;
  private async executeCommand(
    node: CommandNode,
    stdinData?: string,
    captureStdout?: boolean,
  ): Promise<number | { exitCode: number; stdout: string }> {
    // Expand globs in args
    const expandedArgs = this.expandArgs([node.cmd, ...node.args]);
    const cmd = expandedArgs[0];
    const args = expandedArgs.slice(1);

    // Capture buffer for stdout if needed
    let stdoutBuf = '';
    const stdoutFn = captureStdout
      ? (data: string) => { stdoutBuf += data; }
      : this.opts.stdout;

    // Check for builtins
    const builtin = builtins.get(cmd);
    if (builtin) {
      const ctx = this.buildContext(stdoutFn);
      let exitCode: number;

      if (node.redirects.length > 0) {
        // Capture output and write to redirect targets
        const { exitCode: ec, stdout: out, stderr: err } =
          await this.runBuiltinWithCapture(builtin, args, ctx, node.redirects);
        exitCode = ec;
        if (captureStdout) {
          stdoutBuf = out;
        }
      } else {
        exitCode = await Promise.resolve(builtin(args, ctx));
      }

      this.lastExitCode = exitCode;

      if (captureStdout) {
        return { exitCode, stdout: stdoutBuf };
      }
      return exitCode;
    }

    // External command – resolve binary
    let resolvedCmd = cmd;
    if (this.opts.resolveBinary && !cmd.includes('/')) {
      const resolved = this.opts.resolveBinary(cmd);
      if (resolved === null) {
        this.opts.stderr(`${cmd}: command not found\n`);
        this.lastExitCode = 127;
        if (captureStdout) return { exitCode: 127, stdout: '' };
        return 127;
      }
      resolvedCmd = resolved;
    }

    try {
      const result = await this.opts.spawn({
        cmd: resolvedCmd,
        args,
        cwd: this.opts.cwd,
        env: { ...this.opts.env },
        stdin: stdinData,
        stdout: captureStdout ? 'pipe' : 'inherit',
        stderr: 'inherit',
      });

      // Handle redirects for external commands
      if (node.redirects.length > 0) {
        this.applyOutputRedirects(node.redirects, result.stdout, result.stderr);
      } else if (captureStdout) {
        stdoutBuf = result.stdout;
      } else {
        if (result.stdout) this.opts.stdout(result.stdout);
        if (result.stderr) this.opts.stderr(result.stderr);
      }

      this.lastExitCode = result.exitCode;

      if (captureStdout) {
        return { exitCode: result.exitCode, stdout: stdoutBuf };
      }
      return result.exitCode;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.stderr(`${cmd}: ${msg}\n`);
      this.lastExitCode = 126;
      if (captureStdout) return { exitCode: 126, stdout: '' };
      return 126;
    }
  }

  // ── Pipeline ────────────────────────────────────────────────────────────

  private async executePipeline(node: PipelineNode): Promise<number> {
    if (node.commands.length === 0) return 0;
    if (node.commands.length === 1) return this.execute(node.commands[0]);

    // Connect commands via stdout→stdin chaining.
    // We execute sequentially, passing stdout of each command as stdin of the next.
    let stdinData: string | undefined = undefined;
    let lastExitCode = 0;

    for (let i = 0; i < node.commands.length; i++) {
      const cmd = node.commands[i];
      const isLast = i === node.commands.length - 1;

      if (cmd.type === 'command') {
        if (isLast) {
          // Last command writes directly to terminal stdout
          if (stdinData !== undefined) {
            // We can't easily pass stdin to builtins, so handle it
            const builtin = builtins.get(cmd.cmd);
            if (builtin) {
              // For builtins in a pipeline with stdin data, we ignore the stdin
              // (most builtins don't read stdin)
              const ctx = this.buildContext(this.opts.stdout);
              lastExitCode = await Promise.resolve(builtin(cmd.args, ctx));
            } else {
              lastExitCode = await this.executeCommand(cmd, stdinData, false) as number;
            }
          } else {
            lastExitCode = await this.executeCommand(cmd) as number;
          }
        } else {
          // Intermediate command – capture stdout
          const result = await this.executeCommand(cmd, stdinData, true) as { exitCode: number; stdout: string };
          stdinData = result.stdout;
          lastExitCode = result.exitCode;
        }
      } else {
        // For non-command nodes in a pipeline, execute normally
        lastExitCode = await this.execute(cmd);
        stdinData = undefined;
      }
    }

    this.lastExitCode = lastExitCode;
    return lastExitCode;
  }

  // ── Sequence ────────────────────────────────────────────────────────────

  private async executeSequence(node: SequenceNode): Promise<number> {
    const leftCode = await this.execute(node.left);

    switch (node.operator) {
      case '&&':
        if (leftCode !== 0) return leftCode;
        return this.execute(node.right);

      case '||':
        if (leftCode === 0) return leftCode;
        return this.execute(node.right);

      case ';':
        return this.execute(node.right);

      default:
        return leftCode;
    }
  }

  // ── Background ──────────────────────────────────────────────────────────

  private async executeBackground(node: BackgroundNode): Promise<number> {
    // Fire and forget – start execution but don't await.
    // In a real shell we'd track the job; here we just run it asynchronously.
    const promise = this.execute(node.command);
    promise.catch((err) => {
      this.opts.stderr(`bg: ${err instanceof Error ? err.message : String(err)}\n`);
    });
    return 0;
  }

  // ── Subshell ────────────────────────────────────────────────────────────

  private async executeSubshell(node: SubshellNode): Promise<number> {
    // Execute the body in a "sub-environment" – we clone env/cwd so changes
    // inside the subshell don't affect the parent.
    const savedCwd = this.opts.cwd;
    const savedEnv = { ...this.opts.env };

    let exitCode: number;
    try {
      exitCode = await this.execute(node.body);
    } finally {
      // Restore parent state
      this.opts.cwd = savedCwd;
      Object.keys(this.opts.env).forEach((k) => delete this.opts.env[k]);
      Object.assign(this.opts.env, savedEnv);
    }

    // Apply redirects to subshell is not typical, but we handle it
    this.lastExitCode = exitCode;
    return exitCode;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private expandArgs(words: string[]): string[] {
    const result: string[] = [];
    for (const word of words) {
      if (hasGlobChars(word)) {
        const expanded = expandGlob(word, this.opts.cwd, this.opts.readdir);
        result.push(...expanded);
      } else {
        result.push(word);
      }
    }
    return result;
  }

  private buildContext(stdout: (data: string) => void): ShellContext {
    return {
      cwd: this.opts.cwd,
      env: this.opts.env,
      aliases: this.opts.aliases,
      history: this.opts.history,
      stdout,
      stderr: this.opts.stderr,
      setCwd: this.opts.setCwd,
      resolvePath: this.opts.resolvePath,
      isDirectory: this.opts.isDirectory,
      readFile: this.opts.readFile,
      executeCommand: this.opts.executeCommand,
      requestExit: this.opts.requestExit,
      resolveCommand: this.opts.resolveBinary
        ? (name: string) => {
            if (builtins.has(name)) return { type: 'builtin' as const, value: name };
            if (this.opts.aliases.has(name))
              return { type: 'alias' as const, value: this.opts.aliases.get(name)! };
            const resolved = this.opts.resolveBinary!(name);
            if (resolved) return { type: 'file' as const, value: resolved };
            return null;
          }
        : undefined,
    };
  }

  /**
   * Run a builtin while capturing its stdout/stderr so we can apply redirects.
   */
  private async runBuiltinWithCapture(
    builtin: BuiltinFn,
    args: string[],
    baseCtx: ShellContext,
    redirects: Redirect[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    let capturedOut = '';
    let capturedErr = '';

    const ctx: ShellContext = {
      ...baseCtx,
      stdout: (data: string) => { capturedOut += data; },
      stderr: (data: string) => { capturedErr += data; },
    };

    const exitCode = await Promise.resolve(builtin(args, ctx));

    this.applyOutputRedirects(redirects, capturedOut, capturedErr);

    return { exitCode, stdout: capturedOut, stderr: capturedErr };
  }

  /**
   * Write captured output according to redirect specifications.
   */
  private applyOutputRedirects(
    redirects: Redirect[],
    stdout: string,
    stderr: string,
  ): void {
    for (const redir of redirects) {
      const filePath = this.opts.resolvePath(redir.file);
      const data = redir.fd === 2 ? stderr : stdout;

      switch (redir.op) {
        case '>':
          this.opts.writeFile(filePath, data);
          break;
        case '>>':
          this.opts.appendFile(filePath, data);
          break;
        case '<':
          // Input redirects are handled at read time, not here
          break;
      }
    }
  }

  /**
   * Read data from an input redirect.
   */
  readInputRedirect(redirects: Redirect[]): string | undefined {
    for (const redir of redirects) {
      if (redir.op === '<') {
        const filePath = this.opts.resolvePath(redir.file);
        return this.opts.readFile(filePath);
      }
    }
    return undefined;
  }
}
