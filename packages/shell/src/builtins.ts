/**
 * Shell built-in commands.
 *
 * Each builtin is a function that receives its arguments and a
 * {@link ShellContext}, and returns an exit code (0 = success).
 */

export interface ShellContext {
  cwd: string;
  env: Record<string, string>;
  aliases: Map<string, string>;
  history: string[];
  stdout: (data: string) => void;
  stderr: (data: string) => void;
  /** Callback to change the shell's working directory. */
  setCwd: (path: string) => void;
  /** Resolve a path relative to cwd. */
  resolvePath: (p: string) => string;
  /** Check whether a path is a directory (for `cd`). */
  isDirectory: (path: string) => boolean;
  /** Read a file as text (for `source`). */
  readFile: (path: string) => string;
  /** Execute a shell command string (for `source`). */
  executeCommand?: (input: string) => Promise<number>;
  /** Request shell exit. */
  requestExit?: (code: number) => void;
  /** Resolve a command to its type/path. */
  resolveCommand?: (name: string) => { type: 'builtin' | 'alias' | 'file'; value: string } | null;
}

export type BuiltinFn = (args: string[], ctx: ShellContext) => number | Promise<number>;

// ── Individual builtins ─────────────────────────────────────────────────────

function builtinCd(args: string[], ctx: ShellContext): number {
  let target: string;

  if (args.length === 0 || args[0] === '~') {
    target = ctx.env['HOME'] ?? '/';
  } else if (args[0] === '-') {
    const prev = ctx.env['OLDPWD'];
    if (!prev) {
      ctx.stderr('cd: OLDPWD not set\n');
      return 1;
    }
    target = prev;
    ctx.stdout(target + '\n');
  } else {
    target = args[0];
  }

  const resolved = ctx.resolvePath(target);

  try {
    if (!ctx.isDirectory(resolved)) {
      ctx.stderr(`cd: ${args[0]}: Not a directory\n`);
      return 1;
    }
  } catch {
    ctx.stderr(`cd: ${args[0]}: No such file or directory\n`);
    return 1;
  }

  ctx.env['OLDPWD'] = ctx.cwd;
  ctx.setCwd(resolved);
  ctx.env['PWD'] = resolved;
  return 0;
}

function builtinPwd(_args: string[], ctx: ShellContext): number {
  ctx.stdout(ctx.cwd + '\n');
  return 0;
}

function builtinEcho(args: string[], ctx: ShellContext): number {
  let newline = true;
  let escape = false;
  let startIdx = 0;

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n') {
      newline = false;
      startIdx = i + 1;
    } else if (args[i] === '-e') {
      escape = true;
      startIdx = i + 1;
    } else if (args[i] === '-E') {
      escape = false;
      startIdx = i + 1;
    } else if (args[i] === '-ne' || args[i] === '-en') {
      newline = false;
      escape = true;
      startIdx = i + 1;
    } else {
      break;
    }
  }

  let output = args.slice(startIdx).join(' ');

  if (escape) {
    output = interpretEscapes(output);
  }

  ctx.stdout(output);
  if (newline) ctx.stdout('\n');
  return 0;
}

function interpretEscapes(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      switch (next) {
        case 'n':
          result += '\n';
          i++;
          break;
        case 't':
          result += '\t';
          i++;
          break;
        case 'r':
          result += '\r';
          i++;
          break;
        case '\\':
          result += '\\';
          i++;
          break;
        case 'a':
          result += '\x07';
          i++;
          break;
        case 'b':
          result += '\b';
          i++;
          break;
        case 'f':
          result += '\f';
          i++;
          break;
        case 'v':
          result += '\v';
          i++;
          break;
        case '0': {
          // Octal
          let octal = '';
          let j = i + 2;
          while (j < s.length && j < i + 5 && s[j] >= '0' && s[j] <= '7') {
            octal += s[j];
            j++;
          }
          result += String.fromCharCode(parseInt(octal || '0', 8));
          i = j - 1;
          break;
        }
        case 'x': {
          // Hex
          let hex = '';
          let j = i + 2;
          while (j < s.length && j < i + 4 && /[0-9a-fA-F]/.test(s[j])) {
            hex += s[j];
            j++;
          }
          if (hex) {
            result += String.fromCharCode(parseInt(hex, 16));
            i = j - 1;
          } else {
            result += '\\x';
            i++;
          }
          break;
        }
        default:
          result += '\\' + next;
          i++;
      }
    } else {
      result += s[i];
    }
  }
  return result;
}

function builtinExport(args: string[], ctx: ShellContext): number {
  if (args.length === 0) {
    // Print all exported variables
    for (const [key, val] of Object.entries(ctx.env)) {
      ctx.stdout(`declare -x ${key}="${val}"\n`);
    }
    return 0;
  }

  for (const arg of args) {
    // Handle -n flag (unexport)
    if (arg === '-n') continue;

    const eqIdx = arg.indexOf('=');
    if (eqIdx === -1) {
      // Just mark for export (in our model, all env vars are exported)
      // If the variable doesn't exist yet, create it as empty
      if (!(arg in ctx.env)) {
        ctx.env[arg] = '';
      }
    } else {
      const key = arg.substring(0, eqIdx);
      const value = arg.substring(eqIdx + 1);
      ctx.env[key] = value;
    }
  }
  return 0;
}

function builtinUnset(args: string[], ctx: ShellContext): number {
  for (const name of args) {
    if (name === '-v' || name === '-f') continue; // flags we accept but ignore
    delete ctx.env[name];
  }
  return 0;
}

function builtinEnv(_args: string[], ctx: ShellContext): number {
  for (const [key, val] of Object.entries(ctx.env)) {
    ctx.stdout(`${key}=${val}\n`);
  }
  return 0;
}

function builtinAlias(args: string[], ctx: ShellContext): number {
  if (args.length === 0) {
    for (const [name, value] of ctx.aliases) {
      ctx.stdout(`alias ${name}='${value}'\n`);
    }
    return 0;
  }

  for (const arg of args) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx === -1) {
      // Print specific alias
      const val = ctx.aliases.get(arg);
      if (val !== undefined) {
        ctx.stdout(`alias ${arg}='${val}'\n`);
      } else {
        ctx.stderr(`alias: ${arg}: not found\n`);
        return 1;
      }
    } else {
      const name = arg.substring(0, eqIdx);
      const value = arg.substring(eqIdx + 1);
      ctx.aliases.set(name, value);
    }
  }
  return 0;
}

function builtinUnalias(args: string[], ctx: ShellContext): number {
  if (args.length === 0) {
    ctx.stderr('unalias: usage: unalias [-a] name [name ...]\n');
    return 1;
  }

  if (args[0] === '-a') {
    ctx.aliases.clear();
    return 0;
  }

  let exitCode = 0;
  for (const name of args) {
    if (!ctx.aliases.delete(name)) {
      ctx.stderr(`unalias: ${name}: not found\n`);
      exitCode = 1;
    }
  }
  return exitCode;
}

function builtinType(args: string[], ctx: ShellContext): number {
  if (args.length === 0) return 0;

  let exitCode = 0;

  for (const name of args) {
    if (ctx.aliases.has(name)) {
      ctx.stdout(`${name} is aliased to '${ctx.aliases.get(name)}'\n`);
    } else if (builtins.has(name)) {
      ctx.stdout(`${name} is a shell builtin\n`);
    } else if (ctx.resolveCommand) {
      const resolved = ctx.resolveCommand(name);
      if (resolved && resolved.type === 'file') {
        ctx.stdout(`${name} is ${resolved.value}\n`);
      } else {
        ctx.stderr(`type: ${name}: not found\n`);
        exitCode = 1;
      }
    } else {
      ctx.stderr(`type: ${name}: not found\n`);
      exitCode = 1;
    }
  }

  return exitCode;
}

function builtinWhich(args: string[], ctx: ShellContext): number {
  if (args.length === 0) return 1;

  let exitCode = 0;

  for (const name of args) {
    if (ctx.resolveCommand) {
      const resolved = ctx.resolveCommand(name);
      if (resolved && resolved.type === 'file') {
        ctx.stdout(resolved.value + '\n');
      } else if (builtins.has(name)) {
        ctx.stdout(`${name}: shell built-in command\n`);
      } else {
        ctx.stderr(`which: no ${name} in (${ctx.env['PATH'] ?? ''})\n`);
        exitCode = 1;
      }
    } else if (builtins.has(name)) {
      ctx.stdout(`${name}: shell built-in command\n`);
    } else {
      ctx.stderr(`which: no ${name} in (${ctx.env['PATH'] ?? ''})\n`);
      exitCode = 1;
    }
  }

  return exitCode;
}

function builtinExit(args: string[], ctx: ShellContext): number {
  const code = args.length > 0 ? parseInt(args[0], 10) : 0;
  const exitCode = isNaN(code) ? 1 : code;
  if (ctx.requestExit) {
    ctx.requestExit(exitCode);
  }
  return exitCode;
}

async function builtinSource(args: string[], ctx: ShellContext): Promise<number> {
  if (args.length === 0) {
    ctx.stderr('source: filename argument required\n');
    return 2;
  }

  const filePath = ctx.resolvePath(args[0]);

  let content: string;
  try {
    content = ctx.readFile(filePath);
  } catch {
    ctx.stderr(`source: ${args[0]}: No such file or directory\n`);
    return 1;
  }

  if (ctx.executeCommand) {
    return ctx.executeCommand(content);
  }

  return 0;
}

function builtinTrue(): number {
  return 0;
}

function builtinFalse(): number {
  return 1;
}

/**
 * Minimal implementation of `test` / `[`.
 * Supports a useful subset of test expressions.
 */
function builtinTest(args: string[], ctx: ShellContext): number {
  // If invoked as `[`, the last arg must be `]`
  let testArgs = [...args];
  if (testArgs.length > 0 && testArgs[testArgs.length - 1] === ']') {
    testArgs = testArgs.slice(0, -1);
  }

  if (testArgs.length === 0) return 1; // empty test is false

  // Unary operators
  if (testArgs.length === 1) {
    // Non-empty string is true
    return testArgs[0].length > 0 ? 0 : 1;
  }

  if (testArgs.length === 2) {
    const [op, val] = testArgs;
    switch (op) {
      case '-n':
        return val.length > 0 ? 0 : 1;
      case '-z':
        return val.length === 0 ? 0 : 1;
      case '!':
        return builtinTest([val], ctx) === 0 ? 1 : 0;
      case '-d':
        try {
          return ctx.isDirectory(ctx.resolvePath(val)) ? 0 : 1;
        } catch {
          return 1;
        }
      case '-f':
        try {
          return !ctx.isDirectory(ctx.resolvePath(val)) ? 0 : 1;
        } catch {
          return 1;
        }
      case '-e':
        try {
          ctx.isDirectory(ctx.resolvePath(val)); // throws if not found
          return 0;
        } catch {
          return 1;
        }
      default:
        return 1;
    }
  }

  if (testArgs.length === 3) {
    const [left, op, right] = testArgs;

    // String comparison
    switch (op) {
      case '=':
      case '==':
        return left === right ? 0 : 1;
      case '!=':
        return left !== right ? 0 : 1;
      // Integer comparison
      case '-eq':
        return parseInt(left, 10) === parseInt(right, 10) ? 0 : 1;
      case '-ne':
        return parseInt(left, 10) !== parseInt(right, 10) ? 0 : 1;
      case '-lt':
        return parseInt(left, 10) < parseInt(right, 10) ? 0 : 1;
      case '-le':
        return parseInt(left, 10) <= parseInt(right, 10) ? 0 : 1;
      case '-gt':
        return parseInt(left, 10) > parseInt(right, 10) ? 0 : 1;
      case '-ge':
        return parseInt(left, 10) >= parseInt(right, 10) ? 0 : 1;
      default:
        ctx.stderr(`test: unknown operator: ${op}\n`);
        return 2;
    }
  }

  // Negation: ! expr
  if (testArgs[0] === '!') {
    return builtinTest(testArgs.slice(1), ctx) === 0 ? 1 : 0;
  }

  ctx.stderr('test: too many arguments\n');
  return 2;
}

function builtinClear(_args: string[], ctx: ShellContext): number {
  ctx.stdout('\x1b[2J\x1b[H');
  return 0;
}

function builtinHistory(_args: string[], ctx: ShellContext): number {
  ctx.history.forEach((entry, idx) => {
    const num = String(idx + 1).padStart(5, ' ');
    ctx.stdout(`${num}  ${entry}\n`);
  });
  return 0;
}

// ── Registry ────────────────────────────────────────────────────────────────

export const builtins: Map<string, BuiltinFn> = new Map<string, BuiltinFn>([
  ['cd', builtinCd],
  ['pwd', builtinPwd],
  ['echo', builtinEcho],
  ['export', builtinExport],
  ['unset', builtinUnset],
  ['env', builtinEnv],
  ['alias', builtinAlias],
  ['unalias', builtinUnalias],
  ['type', builtinType],
  ['which', builtinWhich],
  ['exit', builtinExit],
  ['source', builtinSource],
  ['.', builtinSource], // alias for source
  ['true', builtinTrue],
  ['false', builtinFalse],
  ['test', builtinTest],
  ['[', builtinTest],
  ['clear', builtinClear],
  ['history', builtinHistory],
]);
