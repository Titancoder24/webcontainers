import type { FileSystemTree, BootOptions } from '@aspect/shared';
import { VFS } from '@aspect/vfs';
import { loadSnapshot } from '@aspect/vfs';
import { SyscallDispatcher } from './syscall-dispatcher.js';
import { SABPool } from './memory.js';
import { Scheduler, Priority } from './scheduler.js';

export interface Kernel {
  vfs: VFS;
  dispatcher: SyscallDispatcher;
  sabPool: SABPool;
  scheduler: Scheduler;
  defaultEnv: Record<string, string>;
}

export interface BootConfig {
  initialTree?: FileSystemTree;
  restoreFromOPFS?: boolean;
  workerPoolSize?: number;
}

export async function boot(config?: BootConfig): Promise<Kernel> {
  const startTime = performance.now();

  // Step 1: Initialize VFS
  let vfs: VFS;

  if (config?.restoreFromOPFS) {
    try {
      const table = await loadSnapshot();
      vfs = table ? new VFS(table) : new VFS();
    } catch {
      vfs = new VFS();
    }
  } else {
    vfs = new VFS();
  }

  // Create standard directories
  const standardDirs = ['/bin', '/tmp', '/home', '/home/project', '/usr', '/usr/local', '/usr/local/lib', '/dev', '/etc', '/var'];
  for (const dir of standardDirs) {
    if (!vfs.exists(dir)) {
      vfs.mkdir(dir, { recursive: true });
    }
  }

  // Step 2: Initialize SAB pool
  const sabPool = new SABPool(config?.workerPoolSize ?? 6);

  // Step 3: Set up syscall dispatcher
  const dispatcher = new SyscallDispatcher(vfs);

  // Step 4: Initialize scheduler
  const scheduler = new Scheduler<() => Promise<void>>(async (task) => {
    await task();
  });

  // Step 5: Mount initial tree if provided
  if (config?.initialTree) {
    vfs.mount('/home/project', config.initialTree);
  }

  // Step 6: Set up default environment
  const defaultEnv: Record<string, string> = {
    HOME: '/home/project',
    USER: 'user',
    SHELL: '/bin/sh',
    PATH: '/usr/local/bin:/usr/bin:/bin:/home/project/node_modules/.bin',
    PWD: '/home/project',
    TERM: 'xterm-256color',
    NODE_ENV: 'development',
    LANG: 'en_US.UTF-8',
    TMPDIR: '/tmp',
  };

  const elapsed = performance.now() - startTime;
  if (typeof console !== 'undefined') {
    console.debug(`[kernel] Boot completed in ${elapsed.toFixed(1)}ms`);
  }

  return {
    vfs,
    dispatcher,
    sabPool,
    scheduler,
    defaultEnv,
  };
}
