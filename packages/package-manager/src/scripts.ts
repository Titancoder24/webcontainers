/**
 * Lifecycle script runner for npm packages.
 * Handles pre/post hooks and script execution with timeout support.
 */

export interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bin?: string | Record<string, string>;
  main?: string;
  module?: string;
  types?: string;
  exports?: unknown;
}

/**
 * Function signature for spawning a child process.
 * Returns an object with an exit code (or promise thereof).
 */
export interface SpawnFn {
  (
    command: string,
    args: string[],
    options: {
      cwd: string;
      env?: Record<string, string>;
      stdio?: 'inherit' | 'pipe';
    },
  ): SpawnResult;
}

export interface SpawnResult {
  exitCode: number | Promise<number>;
  stdout?: ReadableStream<Uint8Array> | string;
  stderr?: ReadableStream<Uint8Array> | string;
}

/** Default script execution timeout: 30 seconds */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Well-known lifecycle script names and their execution order.
 */
const LIFECYCLE_ORDER = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
] as const;

/**
 * Run a named script from a package.json, including pre/post lifecycle hooks.
 *
 * @param name - Script name (e.g. "build", "test", "start")
 * @param packageJson - The package.json object
 * @param cwd - Working directory to run the script in
 * @param spawnFn - Function to spawn a child process
 * @param options - Additional options
 * @returns Exit code of the script (0 for success)
 */
export async function runScript(
  name: string,
  packageJson: PackageJson,
  cwd: string,
  spawnFn: SpawnFn,
  options?: {
    env?: Record<string, string>;
    timeoutMs?: number;
    ignorePrePost?: boolean;
  },
): Promise<number> {
  const scripts = packageJson.scripts ?? {};
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Run pre-script hook if it exists (e.g. "prebuild" for "build")
  if (!options?.ignorePrePost) {
    const preScript = scripts[`pre${name}`];
    if (preScript) {
      const preExitCode = await executeScript(
        preScript,
        cwd,
        spawnFn,
        timeoutMs,
        options?.env,
      );
      if (preExitCode !== 0) {
        return preExitCode;
      }
    }
  }

  // Run the main script
  const script = scripts[name];
  if (!script) {
    // Special handling: "start" defaults to "node server.js" if no script defined
    if (name === 'start') {
      return executeScript('node server.js', cwd, spawnFn, timeoutMs, options?.env);
    }
    throw new ScriptError(`Missing script: "${name}"`);
  }

  const exitCode = await executeScript(script, cwd, spawnFn, timeoutMs, options?.env);

  // Run post-script hook if it exists (e.g. "postbuild" for "build")
  if (!options?.ignorePrePost && exitCode === 0) {
    const postScript = scripts[`post${name}`];
    if (postScript) {
      return executeScript(postScript, cwd, spawnFn, timeoutMs, options?.env);
    }
  }

  return exitCode;
}

/**
 * Run all applicable install lifecycle scripts in order.
 */
export async function runInstallScripts(
  packageJson: PackageJson,
  cwd: string,
  spawnFn: SpawnFn,
  options?: {
    env?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<void> {
  const scripts = packageJson.scripts ?? {};
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const name of LIFECYCLE_ORDER) {
    const script = scripts[name];
    if (!script) continue;

    const exitCode = await executeScript(
      script,
      cwd,
      spawnFn,
      timeoutMs,
      options?.env,
    );

    if (exitCode !== 0) {
      throw new ScriptError(
        `Lifecycle script "${name}" exited with code ${exitCode}`,
      );
    }
  }
}

/**
 * Execute a shell command string with timeout.
 */
async function executeScript(
  script: string,
  cwd: string,
  spawnFn: SpawnFn,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<number> {
  // Parse the script into command and arguments.
  // We use "sh -c" style execution to support shell features (pipes, &&, etc.)
  const result = spawnFn('sh', ['-c', script], {
    cwd,
    env,
    stdio: 'inherit',
  });

  const exitCodeValue = result.exitCode;

  if (exitCodeValue instanceof Promise) {
    return raceWithTimeout(exitCodeValue, timeoutMs, script);
  }

  return exitCodeValue;
}

/**
 * Race a promise against a timeout.
 */
function raceWithTimeout(
  promise: Promise<number>,
  timeoutMs: number,
  scriptName: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ScriptTimeoutError(
          `Script "${scriptName}" timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    promise
      .then((code) => {
        clearTimeout(timer);
        resolve(code);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * List all available scripts in a package.json.
 */
export function listScripts(packageJson: PackageJson): Array<{ name: string; command: string }> {
  const scripts = packageJson.scripts ?? {};
  return Object.entries(scripts).map(([name, command]) => ({ name, command }));
}

export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptError';
  }
}

export class ScriptTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptTimeoutError';
  }
}
