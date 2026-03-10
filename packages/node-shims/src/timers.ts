/**
 * Timers shim for browser environment.
 * Re-exports standard timers and polyfills setImmediate via MessageChannel.
 */

const _setTimeout = globalThis.setTimeout;
const _clearTimeout = globalThis.clearTimeout;
const _setInterval = globalThis.setInterval;
const _clearInterval = globalThis.clearInterval;

// setImmediate polyfill using MessageChannel
type ImmediateCallback = (...args: unknown[]) => void;

interface ImmediateHandle {
  _id: number;
  _callback: ImmediateCallback;
  _args: unknown[];
  _cancelled: boolean;
}

let immediateCounter = 0;
const immediateQueue = new Map<number, ImmediateHandle>();

let immediateChannel: MessageChannel | null = null;

function ensureChannel(): void {
  if (immediateChannel) return;

  if (typeof MessageChannel !== 'undefined') {
    immediateChannel = new MessageChannel();
    immediateChannel.port1.onmessage = (event: MessageEvent) => {
      const id = event.data as number;
      const handle = immediateQueue.get(id);
      if (handle && !handle._cancelled) {
        immediateQueue.delete(id);
        handle._callback(...handle._args);
      }
    };
  }
}

export function setImmediate(callback: ImmediateCallback, ...args: unknown[]): ImmediateHandle {
  if (typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate === 'function') {
    return (globalThis as unknown as { setImmediate: typeof setImmediate }).setImmediate(callback, ...args);
  }

  ensureChannel();

  const id = ++immediateCounter;
  const handle: ImmediateHandle = {
    _id: id,
    _callback: callback,
    _args: args,
    _cancelled: false,
  };

  immediateQueue.set(id, handle);

  if (immediateChannel) {
    immediateChannel.port2.postMessage(id);
  } else {
    // Fallback to setTimeout(0)
    _setTimeout(() => {
      if (!handle._cancelled) {
        immediateQueue.delete(id);
        callback(...args);
      }
    }, 0);
  }

  return handle;
}

export function clearImmediate(handle: ImmediateHandle | undefined | null): void {
  if (typeof (globalThis as unknown as { clearImmediate?: unknown }).clearImmediate === 'function') {
    (globalThis as unknown as { clearImmediate: typeof clearImmediate }).clearImmediate(handle);
    return;
  }

  if (handle) {
    handle._cancelled = true;
    immediateQueue.delete(handle._id);
  }
}

export {
  _setTimeout as setTimeout,
  _clearTimeout as clearTimeout,
  _setInterval as setInterval,
  _clearInterval as clearInterval,
};

export default {
  setTimeout: _setTimeout,
  clearTimeout: _clearTimeout,
  setInterval: _setInterval,
  clearInterval: _clearInterval,
  setImmediate,
  clearImmediate,
};
