import type { FileSystemTree, BootOptions } from '@aspect/shared';

export interface WebContainerProcess {
  pid: number;
  exit: Promise<number>;
  input: WritableStream<string>;
  output: ReadableStream<string>;
  kill(): void;
}

export interface FileSystemAPI {
  readFile(path: string, encoding?: string): Promise<Uint8Array | string>;
  writeFile(path: string, data: string | Uint8Array, options?: { encoding?: string }): Promise<void>;
  readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | DirEnt[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  watch(path: string, options?: { recursive?: boolean }, callback?: (event: string, filename: string | null) => void): FSWatcher;
}

export interface DirEnt {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface FSWatcher {
  close(): void;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  terminal?: { cols: number; rows: number };
}

export type ServerReadyCallback = (port: number, url: string) => void;

export type { FileSystemTree, BootOptions };
