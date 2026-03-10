/**
 * EventEmitter implementation for browser environment.
 */

type Listener = (...args: unknown[]) => void;

interface WrappedListener {
  fn: Listener;
  once: boolean;
}

export class EventEmitter {
  private _events: Map<string | symbol, WrappedListener[]> = new Map();
  private _maxListeners: number = 10;

  static defaultMaxListeners: number = 10;

  setMaxListeners(n: number): this {
    if (typeof n !== 'number' || n < 0 || Number.isNaN(n)) {
      throw new RangeError('The value of "n" is out of range');
    }
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this._maxListeners;
  }

  private _addListener(eventName: string | symbol, listener: Listener, prepend: boolean, once: boolean): this {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type Function');
    }

    const wrapped: WrappedListener = { fn: listener, once };

    let listeners = this._events.get(eventName);
    if (!listeners) {
      listeners = [];
      this._events.set(eventName, listeners);
    }

    if (prepend) {
      listeners.unshift(wrapped);
    } else {
      listeners.push(wrapped);
    }

    // Check max listeners
    const max = this._maxListeners;
    if (max > 0 && listeners.length > max && !((listeners as unknown as { warned?: boolean }).warned)) {
      (listeners as unknown as { warned?: boolean }).warned = true;
      const warning = `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. ${listeners.length} ${String(eventName)} listeners added. Use emitter.setMaxListeners() to increase limit`;
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(warning);
      }
    }

    // Emit 'newListener' if there are listeners for it (but not for 'newListener' itself)
    if (eventName !== 'newListener' && this._events.has('newListener')) {
      this.emit('newListener', eventName, listener);
    }

    return this;
  }

  on(eventName: string | symbol, listener: Listener): this {
    return this._addListener(eventName, listener, false, false);
  }

  addListener(eventName: string | symbol, listener: Listener): this {
    return this.on(eventName, listener);
  }

  once(eventName: string | symbol, listener: Listener): this {
    return this._addListener(eventName, listener, false, true);
  }

  prependListener(eventName: string | symbol, listener: Listener): this {
    return this._addListener(eventName, listener, true, false);
  }

  prependOnceListener(eventName: string | symbol, listener: Listener): this {
    return this._addListener(eventName, listener, true, true);
  }

  off(eventName: string | symbol, listener: Listener): this {
    return this.removeListener(eventName, listener);
  }

  removeListener(eventName: string | symbol, listener: Listener): this {
    const listeners = this._events.get(eventName);
    if (!listeners) return this;

    for (let i = listeners.length - 1; i >= 0; i--) {
      if (listeners[i].fn === listener) {
        listeners.splice(i, 1);
        break;
      }
    }

    if (listeners.length === 0) {
      this._events.delete(eventName);
    }

    if (eventName !== 'removeListener' && this._events.has('removeListener')) {
      this.emit('removeListener', eventName, listener);
    }

    return this;
  }

  removeAllListeners(eventName?: string | symbol): this {
    if (eventName !== undefined) {
      const listeners = this._events.get(eventName);
      if (listeners && this._events.has('removeListener') && eventName !== 'removeListener') {
        for (const wrapped of [...listeners]) {
          this.emit('removeListener', eventName, wrapped.fn);
        }
      }
      this._events.delete(eventName);
    } else {
      const events = [...this._events.keys()];
      for (const event of events) {
        if (event !== 'removeListener') {
          this.removeAllListeners(event);
        }
      }
      this._events.delete('removeListener');
    }
    return this;
  }

  emit(eventName: string | symbol, ...args: unknown[]): boolean {
    const listeners = this._events.get(eventName);
    if (!listeners || listeners.length === 0) {
      if (eventName === 'error') {
        const err = args[0];
        if (err instanceof Error) throw err;
        throw new Error('Unhandled error event: ' + String(err));
      }
      return false;
    }

    const copy = [...listeners];
    for (const wrapped of copy) {
      if (wrapped.once) {
        // Remove the once listener before calling it
        const idx = listeners.indexOf(wrapped);
        if (idx !== -1) {
          listeners.splice(idx, 1);
        }
        if (listeners.length === 0) {
          this._events.delete(eventName);
        }
      }
      wrapped.fn.apply(this, args);
    }

    return true;
  }

  listenerCount(eventName: string | symbol): number {
    const listeners = this._events.get(eventName);
    return listeners ? listeners.length : 0;
  }

  listeners(eventName: string | symbol): Listener[] {
    const listeners = this._events.get(eventName);
    if (!listeners) return [];
    return listeners.map((w) => w.fn);
  }

  rawListeners(eventName: string | symbol): Listener[] {
    const listeners = this._events.get(eventName);
    if (!listeners) return [];
    return listeners.map((w) => {
      if (w.once) {
        const wrapper = (...args: unknown[]) => {
          this.removeListener(eventName, wrapper);
          w.fn.apply(this, args);
        };
        (wrapper as unknown as { listener: Listener }).listener = w.fn;
        return wrapper;
      }
      return w.fn;
    });
  }

  eventNames(): (string | symbol)[] {
    return [...this._events.keys()];
  }
}

export default EventEmitter;
