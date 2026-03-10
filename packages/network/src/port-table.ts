type PortEventType = 'bind' | 'unbind';
type PortEventCallback = (port: number) => void;

interface PortEntry {
  port: number;
  pid: number;
  handler: MessagePort;
}

export class PortTable {
  private ports: Map<number, PortEntry> = new Map();
  private listeners: Map<PortEventType, Set<PortEventCallback>> = new Map();

  constructor() {
    this.listeners.set('bind', new Set());
    this.listeners.set('unbind', new Set());
  }

  bind(port: number, pid: number, handler: MessagePort): void {
    if (this.ports.has(port)) {
      throw new Error(`Port ${port} is already in use`);
    }
    this.ports.set(port, { port, pid, handler });
    this.emit('bind', port);
  }

  unbind(port: number): void {
    const entry = this.ports.get(port);
    if (entry) {
      this.ports.delete(port);
      this.emit('unbind', port);
    }
  }

  lookup(port: number): MessagePort | null {
    return this.ports.get(port)?.handler ?? null;
  }

  list(): number[] {
    return Array.from(this.ports.keys());
  }

  getEntry(port: number): PortEntry | undefined {
    return this.ports.get(port);
  }

  unbindByPid(pid: number): void {
    for (const [port, entry] of this.ports) {
      if (entry.pid === pid) {
        this.unbind(port);
      }
    }
  }

  on(event: PortEventType, callback: PortEventCallback): () => void {
    const set = this.listeners.get(event);
    if (set) {
      set.add(callback);
    }
    return () => {
      set?.delete(callback);
    };
  }

  private emit(event: PortEventType, port: number): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) {
        try {
          cb(port);
        } catch {
          // Listener errors should not propagate
        }
      }
    }
  }

  clear(): void {
    for (const [port] of this.ports) {
      this.unbind(port);
    }
  }

  get size(): number {
    return this.ports.size;
  }
}
