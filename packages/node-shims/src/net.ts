import { EventEmitter } from './events.js';
import { Duplex } from './stream.js';

export class Socket extends Duplex {
  remoteAddress: string = '127.0.0.1';
  remotePort: number = 0;
  localAddress: string = '127.0.0.1';
  localPort: number = 0;
  connecting: boolean = false;
  destroyed: boolean = false;
  private channel: MessageChannel | null = null;

  constructor() {
    super();
  }

  connect(port: number, host?: string, callback?: () => void): this {
    this.remotePort = port;
    if (host) this.remoteAddress = host;
    this.connecting = true;

    queueMicrotask(() => {
      this.connecting = false;
      this.emit('connect');
      if (callback) callback();
    });

    return this;
  }

  override _read(): void {
    // Data comes from the MessagePort
  }

  override _write(chunk: Uint8Array | string, _encoding: string, callback: (err?: Error) => void): void {
    // Write to the MessagePort
    if (this.channel) {
      const data = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      this.channel.port1.postMessage(data);
    }
    callback();
  }

  override destroy(err?: Error): this {
    this.destroyed = true;
    if (this.channel) {
      this.channel.port1.close();
      this.channel.port2.close();
      this.channel = null;
    }
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
  }

  setNoDelay(): this { return this; }
  setKeepAlive(): this { return this; }
  setTimeout(_timeout: number, _callback?: () => void): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }

  address(): { port: number; family: string; address: string } {
    return { port: this.localPort, family: 'IPv4', address: this.localAddress };
  }
}

export class Server extends EventEmitter {
  private port: number = 0;
  private _listening: boolean = false;

  listen(port: number, callback?: () => void): this;
  listen(port: number, hostname?: string, callback?: () => void): this;
  listen(port: number, hostnameOrCallback?: string | (() => void), maybeCallback?: () => void): this {
    this.port = port;
    this._listening = true;
    const callback = typeof hostnameOrCallback === 'function' ? hostnameOrCallback : maybeCallback;
    if (callback) queueMicrotask(callback);
    this.emit('listening');
    return this;
  }

  close(callback?: () => void): void {
    this._listening = false;
    if (callback) queueMicrotask(callback);
    this.emit('close');
  }

  address(): { port: number; family: string; address: string } | null {
    if (!this._listening) return null;
    return { port: this.port, family: 'IPv4', address: '0.0.0.0' };
  }

  get listening(): boolean {
    return this._listening;
  }
}

export function createServer(handler?: (socket: Socket) => void): Server {
  const server = new Server();
  if (handler) server.on('connection', handler);
  return server;
}

export function createConnection(port: number, host?: string, callback?: () => void): Socket {
  const socket = new Socket();
  socket.connect(port, host, callback);
  return socket;
}

export function connect(port: number, host?: string, callback?: () => void): Socket {
  return createConnection(port, host, callback);
}

export default { Socket, Server, createServer, createConnection, connect };
