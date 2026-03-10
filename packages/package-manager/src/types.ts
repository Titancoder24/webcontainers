/**
 * VFS interface expected by the package manager.
 * This abstracts away the actual virtual filesystem implementation,
 * allowing the package manager to work with any compatible VFS.
 */
export interface VFS {
  readFile(path: string, encoding?: string): Uint8Array | string;
  writeFile(
    path: string,
    data: Uint8Array | string,
    options?: { flag?: string; mode?: number },
  ): void;
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): void;
  exists(path: string): boolean;
  readdir(path: string, options?: { withFileTypes?: boolean }): string[] | Array<{ name: string; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  symlink(target: string, linkPath: string): void;
  unlink(path: string): void;
  stat(path: string): {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    size: number;
    mtimeMs: number;
  };
  rm?(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  readlink?(path: string): string;
  chmod?(path: string, mode: number): void;
}

/**
 * Options for the package manager CLI.
 */
export interface PackageManagerOptions {
  /** Working directory (project root) */
  cwd: string;
  /** Virtual filesystem instance */
  vfs: VFS;
  /** Function to spawn a child process */
  spawn?: SpawnFunction;
  /** Custom registry URL */
  registryUrl?: string;
  /** Custom CDN URL */
  cdnUrl?: string;
  /** Standard output stream */
  stdout?: WritableStream<string> | { write(data: string): void };
  /** Standard error stream */
  stderr?: WritableStream<string> | { write(data: string): void };
  /** Environment variables */
  env?: Record<string, string>;
}

export interface SpawnFunction {
  (
    command: string,
    args: string[],
    options: {
      cwd: string;
      env?: Record<string, string>;
      stdio?: 'inherit' | 'pipe';
    },
  ): {
    exitCode: number | Promise<number>;
    stdout?: ReadableStream<Uint8Array> | string;
    stderr?: ReadableStream<Uint8Array> | string;
  };
}
