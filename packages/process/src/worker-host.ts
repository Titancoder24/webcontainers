/**
 * Worker Host
 *
 * Creates Web Workers from Blob URLs. The worker runtime code is embedded as
 * a string and turned into a Blob URL at runtime so that no separate script
 * file needs to be served.
 */

/**
 * Returns the worker runtime source code as a string.
 *
 * In a production build this placeholder is replaced by the build system with
 * the compiled and bundled output of `worker-runtime.ts`. During development
 * the placeholder indicates that the substitution has not yet occurred.
 */
export function getWorkerCode(): string {
  // __WORKER_RUNTIME_CODE__ is replaced at build time with the bundled worker source.
  // During development / tests you can override this by calling createWorkerFromUrl().
  return `/* __WORKER_RUNTIME_CODE__ */`;
}

/** Cached Blob URL so we only create one per page lifetime. */
let cachedBlobUrl: string | null = null;

/**
 * Returns a reusable Blob URL for the worker runtime code.
 */
export function getWorkerBlobUrl(): string {
  if (cachedBlobUrl) {
    return cachedBlobUrl;
  }

  const code = getWorkerCode();
  const blob = new Blob([code], { type: 'application/javascript' });
  cachedBlobUrl = URL.createObjectURL(blob);
  return cachedBlobUrl;
}

/**
 * Create a new Web Worker running the worker runtime.
 *
 * Each worker gets its own execution context. Communication with the main
 * thread happens via MessagePorts (for stdio) and SharedArrayBuffer (for
 * synchronous syscalls).
 */
export function createWorker(): Worker {
  const url = getWorkerBlobUrl();
  return new Worker(url, { type: 'classic', name: 'aspect-process' });
}

/**
 * Create a worker from an explicit URL (useful for development and testing
 * where the worker code is served as a standalone file).
 */
export function createWorkerFromUrl(url: string | URL): Worker {
  return new Worker(url, { type: 'module', name: 'aspect-process' });
}

/**
 * Revoke the cached Blob URL to release memory. After calling this,
 * `createWorker()` will generate a fresh Blob URL on next invocation.
 */
export function disposeBlobUrl(): void {
  if (cachedBlobUrl) {
    URL.revokeObjectURL(cachedBlobUrl);
    cachedBlobUrl = null;
  }
}
