import type { FileSystemTree, BootOptions } from '@aspect/shared';
import { boot } from '@aspect/kernel';
import type { Kernel } from '@aspect/kernel';
import { PortTable } from '@aspect/network';
import type {
  FileSystemAPI,
  WebContainerProcess,
  SpawnOptions,
  ServerReadyCallback,
  DirEnt,
  FSWatcher,
} from './types.js';

export class WebContainer {
  private kernel: Kernel;
  private portTable: PortTable;
  private serverReadyCallbacks: Set<ServerReadyCallback> = new Set();
  private disposed: boolean = false;

  private constructor(kernel: Kernel, portTable: PortTable) {
    this.kernel = kernel;
    this.portTable = portTable;

    // Listen for port bindings
    this.portTable.on('bind', (port) => {
      const url = this.getPreviewUrl(port);
      for (const cb of this.serverReadyCallbacks) {
        try {
          cb(port, url);
        } catch {
          // callback errors should not propagate
        }
      }
    });
  }

  static async boot(options?: BootOptions): Promise<WebContainer> {
    const kernel = await boot({
      workerPoolSize: 6,
    });
    const portTable = new PortTable();
    return new WebContainer(kernel, portTable);
  }

  get fs(): FileSystemAPI {
    const vfs = this.kernel.vfs;
    return {
      async readFile(path: string, encoding?: string): Promise<Uint8Array | string> {
        return vfs.readFile(path, encoding);
      },
      async writeFile(path: string, data: string | Uint8Array): Promise<void> {
        vfs.writeFile(path, data);
      },
      async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | DirEnt[]> {
        return vfs.readdir(path, options) as string[] | DirEnt[];
      },
      async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
        vfs.mkdir(path, options);
      },
      async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
        vfs.rm(path, options);
      },
      async rename(oldPath: string, newPath: string): Promise<void> {
        vfs.rename(oldPath, newPath);
      },
      watch(
        path: string,
        options?: { recursive?: boolean },
        callback?: (event: string, filename: string | null) => void
      ): FSWatcher {
        const unsub = vfs.watch(path, options ?? {}, (eventType, filename) => {
          if (callback) callback(eventType, filename);
        });
        return { close: unsub };
      },
    };
  }

  async mount(tree: FileSystemTree): Promise<void> {
    this.kernel.vfs.mount('/home/project', tree);
  }

  async spawn(
    cmd: string,
    args: string[] = [],
    options?: SpawnOptions
  ): Promise<WebContainerProcess> {
    const cwd = options?.cwd ?? '/home/project';
    const env = { ...this.kernel.defaultEnv, ...options?.env };

    // Create streams for stdio
    let outputController: ReadableStreamDefaultController<string>;
    const output = new ReadableStream<string>({
      start(controller) {
        outputController = controller;
      },
    });

    let inputResolver: ((value: string) => void) | null = null;
    const input = new WritableStream<string>({
      write(chunk) {
        if (inputResolver) {
          inputResolver(chunk);
          inputResolver = null;
        }
      },
    });

    const pid = Math.floor(Math.random() * 10000) + 1;

    // For now, implement a simple execution model
    // In production, this would spawn a real Web Worker
    const exitPromise = new Promise<number>((resolve) => {
      queueMicrotask(() => {
        try {
          // Route through the shell/process system
          const fullCmd = [cmd, ...args].join(' ');
          outputController!.enqueue(`$ ${fullCmd}\r\n`);

          // Basic command handling
          if (cmd === 'echo') {
            outputController!.enqueue(args.join(' ') + '\r\n');
            outputController!.close();
            resolve(0);
          } else if (cmd === 'node') {
            const filename = args[0];
            if (filename) {
              try {
                const content = this.kernel.vfs.readFile(
                  filename.startsWith('/') ? filename : cwd + '/' + filename,
                  'utf-8'
                ) as string;
                outputController!.enqueue(`[node] Executing ${filename}\r\n`);
                outputController!.close();
                resolve(0);
              } catch (e: any) {
                outputController!.enqueue(`Error: ${e.message}\r\n`);
                outputController!.close();
                resolve(1);
              }
            } else {
              outputController!.enqueue('Welcome to Node.js\r\n');
              outputController!.close();
              resolve(0);
            }
          } else if (cmd === 'npm' || cmd === 'npx') {
            outputController!.enqueue(`[${cmd}] ${args.join(' ')}\r\n`);
            outputController!.close();
            resolve(0);
          } else if (cmd === 'ls') {
            try {
              const entries = this.kernel.vfs.readdir(cwd) as string[];
              outputController!.enqueue(entries.join('  ') + '\r\n');
              outputController!.close();
              resolve(0);
            } catch (e: any) {
              outputController!.enqueue(`ls: ${e.message}\r\n`);
              outputController!.close();
              resolve(1);
            }
          } else if (cmd === 'cat') {
            const file = args[0];
            if (file) {
              try {
                const content = this.kernel.vfs.readFile(
                  file.startsWith('/') ? file : cwd + '/' + file,
                  'utf-8'
                ) as string;
                outputController!.enqueue(content + '\r\n');
                outputController!.close();
                resolve(0);
              } catch (e: any) {
                outputController!.enqueue(`cat: ${e.message}\r\n`);
                outputController!.close();
                resolve(1);
              }
            } else {
              outputController!.close();
              resolve(0);
            }
          } else if (cmd === 'pwd') {
            outputController!.enqueue(cwd + '\r\n');
            outputController!.close();
            resolve(0);
          } else if (cmd === 'mkdir') {
            try {
              const dir = args[args.length - 1];
              const recursive = args.includes('-p');
              this.kernel.vfs.mkdir(
                dir.startsWith('/') ? dir : cwd + '/' + dir,
                { recursive }
              );
              outputController!.close();
              resolve(0);
            } catch (e: any) {
              outputController!.enqueue(`mkdir: ${e.message}\r\n`);
              outputController!.close();
              resolve(1);
            }
          } else {
            outputController!.enqueue(`command not found: ${cmd}\r\n`);
            outputController!.close();
            resolve(127);
          }
        } catch (e: any) {
          outputController!.enqueue(`Error: ${e.message}\r\n`);
          outputController!.close();
          resolve(1);
        }
      });
    });

    return {
      pid,
      exit: exitPromise,
      input,
      output,
      kill: () => {
        try {
          outputController?.close();
        } catch {
          // already closed
        }
      },
    };
  }

  on(event: 'server-ready', callback: ServerReadyCallback): () => void;
  on(event: string, callback: (...args: any[]) => void): () => void {
    if (event === 'server-ready') {
      this.serverReadyCallbacks.add(callback as ServerReadyCallback);
      return () => {
        this.serverReadyCallbacks.delete(callback as ServerReadyCallback);
      };
    }
    return () => {};
  }

  async teardown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // Clear port table
    this.portTable.clear();

    // Clear callbacks
    this.serverReadyCallbacks.clear();
  }

  private getPreviewUrl(port: number): string {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/__wc_port_${port}/`;
    }
    return `http://localhost:${port}/`;
  }

  get workdir(): string {
    return '/home/project';
  }

  getKernel(): Kernel {
    return this.kernel;
  }
}
