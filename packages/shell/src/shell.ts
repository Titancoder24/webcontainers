/**
 * Shell – the top-level shell interpreter.
 *
 * Ties together the tokenizer, parser, executor, and environment
 * to provide a simple `execute(input)` interface.
 */

import { tokenize } from './tokenizer.js';
import { parse, type ASTNode } from './parser.js';
import { Executor, type SpawnFunction, type ExecutorOptions } from './executor.js';
import { builtins } from './builtins.js';
import type { ReaddirFn } from './glob.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ShellOptions {
  /** Initial working directory. */
  cwd?: string;
  /** Initial environment variables. */
  env?: Record<string, string>;
  /** Function to spawn external commands. */
  spawn: SpawnFunction;
  /** Write to stdout (e.g. terminal). */
  stdout?: (data: string) => void;
  /** Write to stderr. */
  stderr?: (data: string) => void;
  /** Check if path is a directory. */
  isDirectory: (path: string) => boolean;
  /** Read a file as text. */
  readFile: (path: string) => string;
  /** Write a file. */
  writeFile: (path: string, data: string) => void;
  /** Append to a file. */
  appendFile: (path: string, data: string) => void;
  /** List directory entries for glob expansion. */
  readdir: ReaddirFn;
  /** Resolve a binary name via $PATH. */
  resolveBinary?: (name: string) => string | null;
}

export interface ShellWritable {
  write(data: string): void;
}

export interface ShellReadable {
  onData(callback: (data: string) => void): void;
}

// ── Shell class ─────────────────────────────────────────────────────────────

export class Shell {
  /** Current working directory. */
  cwd: string;
  /** Environment variables. */
  env: Record<string, string>;
  /** Command history. */
  history: string[];
  /** Aliases. */
  aliases: Map<string, string>;
  /** Last exit code ($?). */
  lastExitCode: number = 0;

  private spawn: SpawnFunction;
  private stdoutFn: (data: string) => void;
  private stderrFn: (data: string) => void;
  private isDirectoryFn: (path: string) => boolean;
  private readFileFn: (path: string) => string;
  private writeFileFn: (path: string, data: string) => void;
  private appendFileFn: (path: string, data: string) => void;
  private readdirFn: ReaddirFn;
  private resolveBinaryFn?: (name: string) => string | null;

  private exitRequested: boolean = false;
  private exitCode: number = 0;

  /** Listeners for readable interface. */
  private dataListeners: Array<(data: string) => void> = [];

  constructor(opts: ShellOptions) {
    this.cwd = opts.cwd ?? '/';
    this.env = { ...opts.env } ?? {};
    this.history = [];
    this.aliases = new Map();

    // Set some standard env vars if not present
    if (!this.env['PWD']) this.env['PWD'] = this.cwd;
    if (!this.env['HOME']) this.env['HOME'] = '/home';
    if (!this.env['PATH']) this.env['PATH'] = '/usr/local/bin:/usr/bin:/bin';
    if (!this.env['SHELL']) this.env['SHELL'] = '/bin/sh';

    this.spawn = opts.spawn;
    this.stdoutFn = opts.stdout ?? ((data: string) => { this.emitData(data); });
    this.stderrFn = opts.stderr ?? ((data: string) => { this.emitData(data); });
    this.isDirectoryFn = opts.isDirectory;
    this.readFileFn = opts.readFile;
    this.writeFileFn = opts.writeFile;
    this.appendFileFn = opts.appendFile;
    this.readdirFn = opts.readdir;
    this.resolveBinaryFn = opts.resolveBinary;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Execute a shell command string.
   * Returns the exit code of the last command.
   */
  async execute(input: string): Promise<number> {
    if (!input.trim()) return this.lastExitCode;

    // Add to history
    this.history.push(input);

    // Expand aliases in the input
    const expanded = this.expandAliases(input);

    // Expand environment variables
    const substituted = this.expandVariables(expanded);

    // Tokenize
    const tokens = tokenize(substituted);

    // Parse
    let ast: ASTNode | null;
    try {
      ast = parse(tokens);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.stderrFn(`syntax error: ${msg}\n`);
      this.lastExitCode = 2;
      return 2;
    }

    if (!ast) return this.lastExitCode;

    // Execute
    const executor = this.createExecutor();
    try {
      this.lastExitCode = await executor.execute(ast);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.stderrFn(`error: ${msg}\n`);
      this.lastExitCode = 1;
    }

    return this.lastExitCode;
  }

  /**
   * Check if the shell has been asked to exit.
   */
  get shouldExit(): boolean {
    return this.exitRequested;
  }

  /**
   * Get the exit code if exit was requested.
   */
  get requestedExitCode(): number {
    return this.exitCode;
  }

  // ── Readable / Writable interface for terminal connection ──────────────

  /**
   * Get a writable interface – call write() to send input to the shell.
   */
  get input(): ShellWritable {
    return {
      write: (data: string) => {
        // For a real terminal, we'd buffer lines. Here we execute directly.
        this.execute(data).catch((err) => {
          this.stderrFn(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
        });
      },
    };
  }

  /**
   * Get a readable interface – register callbacks for output data.
   */
  get output(): ShellReadable {
    return {
      onData: (callback: (data: string) => void) => {
        this.dataListeners.push(callback);
      },
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  private createExecutor(): Executor {
    const opts: ExecutorOptions = {
      spawn: this.spawn,
      cwd: this.cwd,
      env: this.env,
      aliases: this.aliases,
      history: this.history,
      stdout: this.stdoutFn,
      stderr: this.stderrFn,
      setCwd: (path: string) => {
        this.cwd = path;
        this.env['PWD'] = path;
      },
      resolvePath: (p: string) => this.resolvePath(p),
      isDirectory: this.isDirectoryFn,
      readFile: this.readFileFn,
      writeFile: this.writeFileFn,
      appendFile: this.appendFileFn,
      readdir: this.readdirFn,
      executeCommand: (input: string) => this.execute(input),
      requestExit: (code: number) => {
        this.exitRequested = true;
        this.exitCode = code;
      },
      resolveBinary: this.resolveBinaryFn,
    };
    return new Executor(opts);
  }

  /**
   * Resolve a path relative to the current working directory.
   * Handles `.`, `..`, and `~`.
   */
  resolvePath(p: string): string {
    if (p.startsWith('~')) {
      p = (this.env['HOME'] ?? '/home') + p.slice(1);
    }

    if (!p.startsWith('/')) {
      p = this.cwd + '/' + p;
    }

    // Normalize: resolve . and ..
    const parts = p.split('/');
    const resolved: string[] = [];

    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }

    return '/' + resolved.join('/');
  }

  /**
   * Expand environment variables in a string.
   *
   * Handles:
   * - `$VAR` - simple variable reference
   * - `${VAR}` - braced variable reference
   * - `${VAR:-default}` - default value if unset or empty
   * - `${VAR:+alternate}` - alternate value if set and non-empty
   * - `${VAR:=default}` - assign default if unset or empty
   * - `$?` - last exit code
   * - `$$` - shell PID (always 1 in WebContainer)
   * - `$#`, `$0`, `$1`... - not expanded (script params not supported yet)
   * - `\\$` - escaped dollar sign (literal)
   */
  expandVariables(input: string): string {
    let result = '';
    let i = 0;
    let inSingleQuote = false;

    while (i < input.length) {
      const ch = input[i];

      // Track single-quote state – no expansion inside single quotes
      if (ch === "'" && !inSingleQuote) {
        inSingleQuote = true;
        result += ch;
        i++;
        continue;
      }
      if (ch === "'" && inSingleQuote) {
        inSingleQuote = false;
        result += ch;
        i++;
        continue;
      }
      if (inSingleQuote) {
        result += ch;
        i++;
        continue;
      }

      // Escaped dollar
      if (ch === '\\' && i + 1 < input.length && input[i + 1] === '$') {
        result += '\\$';
        i += 2;
        continue;
      }

      // Variable expansion
      if (ch === '$') {
        i++;
        if (i >= input.length) {
          result += '$';
          break;
        }

        // Special variables
        if (input[i] === '?') {
          result += String(this.lastExitCode);
          i++;
          continue;
        }
        if (input[i] === '$') {
          result += '1'; // PID placeholder
          i++;
          continue;
        }

        // Braced expansion ${...}
        if (input[i] === '{') {
          i++;
          const closeIdx = input.indexOf('}', i);
          if (closeIdx === -1) {
            result += '${';
            continue;
          }

          const expr = input.substring(i, closeIdx);
          i = closeIdx + 1;

          // Parse modifiers: ${VAR:-default}, ${VAR:+alt}, ${VAR:=default}
          const colonDashIdx = expr.indexOf(':-');
          const colonPlusIdx = expr.indexOf(':+');
          const colonEqIdx = expr.indexOf(':=');

          if (colonDashIdx !== -1) {
            const varName = expr.substring(0, colonDashIdx);
            const defaultVal = expr.substring(colonDashIdx + 2);
            const val = this.env[varName];
            result += val !== undefined && val !== '' ? val : defaultVal;
          } else if (colonPlusIdx !== -1) {
            const varName = expr.substring(0, colonPlusIdx);
            const altVal = expr.substring(colonPlusIdx + 2);
            const val = this.env[varName];
            result += val !== undefined && val !== '' ? altVal : '';
          } else if (colonEqIdx !== -1) {
            const varName = expr.substring(0, colonEqIdx);
            const defaultVal = expr.substring(colonEqIdx + 2);
            const val = this.env[varName];
            if (val === undefined || val === '') {
              this.env[varName] = defaultVal;
              result += defaultVal;
            } else {
              result += val;
            }
          } else {
            // Simple ${VAR}
            result += this.env[expr] ?? '';
          }
          continue;
        }

        // Simple $VAR – collect alphanumeric/underscore characters
        let varName = '';
        while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
          varName += input[i];
          i++;
        }

        if (varName.length === 0) {
          result += '$';
        } else {
          result += this.env[varName] ?? '';
        }
        continue;
      }

      result += ch;
      i++;
    }

    return result;
  }

  /**
   * Expand aliases at the beginning of a command.
   * Only expands the first word of each simple command.
   * Prevents infinite recursion by tracking already-expanded aliases.
   */
  private expandAliases(input: string): string {
    if (this.aliases.size === 0) return input;

    const expanded = new Set<string>();
    return this.expandAliasesOnce(input, expanded);
  }

  private expandAliasesOnce(input: string, expanded: Set<string>): string {
    const trimmed = input.trimStart();
    if (!trimmed) return input;

    // Find the first word
    const match = trimmed.match(/^(\S+)/);
    if (!match) return input;

    const firstWord = match[1];
    if (expanded.has(firstWord)) return input;

    const aliasValue = this.aliases.get(firstWord);
    if (!aliasValue) return input;

    expanded.add(firstWord);
    const rest = trimmed.slice(firstWord.length);
    const newInput = aliasValue + rest;

    // Recursively expand if the alias ends with a space (bash convention)
    if (aliasValue.endsWith(' ')) {
      return this.expandAliasesOnce(newInput, expanded);
    }

    return newInput;
  }
}
