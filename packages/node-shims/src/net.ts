/**
 * Net module shim backed by MessageChannel.
 */

import { EventEmitter } from './events.js';
import { Duplex } from './stream.js';
import { Buffer } from './buffer.js';

export class Socket extends Duplex {
  remoteAddress: string | undefined;
  remotePort: number | undefined;
  remoteFamily: string | undefined;
  localAddress: string = '127.0.0.1';
  localPort: number = 0;
  localFamily: string = 'IPv4';
  bytesRead: number = 0;
  bytesWritten: number = 0;
  connecting: boolean = false;
  destroyed: boolean = false;
  readyState: string = 'closed';
  timeout: number = 0;

  private _port: MessagePort | null = null;
  private _peerPort: MessagePort | null = null;
  private _connected: boolean = false;

  constructor(options?: { port?: MessagePort }) {
    super({
      read: () => {},
      write: (chunk: Buffer | string, _encoding: string, callback: (err?: Error | null) => void) => {
        const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        const bytes = data instanceof Buffer ? data : Buffer.from(data);
        this.bytesWritten += bytes.length;

        if (this._port) {
          this._port.postMessage(bytes);
        }
        callback();
      },
    });

    if (options?.port) {
      this._setupPort(options.port);
    }
  }

  private _setupPort(port: MessagePort): void {
    this._port = port;
    port.onmessage = (event: MessageEvent) => {
      const data = event.data;
      const buf = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(String(data));
      this.bytesRead += buf.length;
      this.push(buf);
    };
  }

  connect(portOrOptions: number | { port: number; host?: string }, hostOrCallback?: string | (() => void), callback?: () => void): this {
    let port: number;
    let host: string;
    let cb: (() => void) | undefined;

    if (typeof portOrOptions === 'number') {
      port = portOrOptions;
      if (typeof hostOrCallback === 'string') {
        host = hostOrCallback;
        cb = callback;
      } else {
        host = '127.0.0.1';
        cb = hostOrCallback;
      }
    } else {
      port = portOrOptions.port;
      host = portOrOptions.host || '127.0.0.1';
      if (typeof hostOrCallback === 'function') {
        cb = hostOrCallback;
      } else {
        cb = callback;
      }
    }

    this.connecting = true;
    this.remoteAddress = host;
    this.remotePort = port;
    this.remoteFamily = 'IPv4';

    // Create a MessageChannel pair
    const channel = new MessageChannel();
    this._port = channel.port1;
    this._peerPort = channel.port2;

    this._setupPort(channel.port1);

    queueMicrotask(() => {
      this.connecting = false;
      this._connected = true;
      this.readyState = 'open';
      this.emit('connect');
      if (cb) cb();
    });

    return this;
  }

  setTimeout(timeout: number, callback?: () => void): this {
    this.timeout = timeout;
    if (callback) {
      this.once('timeout', callback);
    }
    if (timeout > 0) {
      globalThis.setTimeout(() => {
        if (!this.destroyed) {
          this.emit('timeout');
        }
      }, timeout);
    }
    return this;
  }

  setNoDelay(_noDelay?: boolean): this {
    return this;
  }

  setKeepAlive(_enable?: boolean, _initialDelay?: number): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  address(): { port: number; family: string; address: string } {
    return {
      port: this.localPort,
      family: this.localFamily,
      address: this.localAddress,
    };
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this._connected = false;
    this.readyState = 'closed';

    if (this._port) {
      this._port.close();
      this._port = null;
    }
    if (this._peerPort) {
      this._peerPort.close();
      this._peerPort = null;
    }

    queueMicrotask(() => {
      if (error) this.emit('error', error);
      this.emit('close', !!error);
    });

    return this;
  }

  /**
   * Get the peer port for connecting the other end of the socket.
   */
  getPeerPort(): MessagePort | null {
    return this._peerPort;
  }
}

export class Server extends EventEmitter {
  private _listening: boolean = false;
  private _address: { port: number; family: string; address: string } | null = null;
  private _connections: Set<Socket> = new Set();
  maxConnections: number = 0;

  constructor(connectionListener?: (socket: Socket) => void) {
    super();
    if (connectionListener) {
      this.on('connection', connectionListener);
    }
  }

  listen(port?: number, hostname?: string | (() => void), backlog?: number | (() => void), callback?: () => void): this {
    let cb: (() => void) | undefined;
    let host: string = '0.0.0.0';
    let actualPort = port || 0;

    if (typeof hostname === 'function') {
      cb = hostname;
    } else if (typeof hostname === 'string') {
      host = hostname;
      if (typeof backlog === 'function') {
        cb = backlog;
      } else {
        cb = callback;
      }
    } else if (typeof backlog === 'function') {
      cb = backlog;
    } else {
      cb = callback;
    }

    if (actualPort === 0) {
      actualPort = 3000 + Math.floor(Math.random() * 60000);
    }

    this._address = { port: actualPort, family: 'IPv4', address: host };
    this._listening = true;

    queueMicrotask(() => {
      this.emit('listening');
      if (cb) cb();
    });

    return this;
  }

  address(): { port: number; family: string; address: string } | null {
    return this._address;
  }

  close(callback?: (err?: Error) => void): this {
    this._listening = false;

    // Close all connections
    for (const conn of this._connections) {
      conn.destroy();
    }
    this._connections.clear();
    this._address = null;

    queueMicrotask(() => {
      this.emit('close');
      if (callback) callback();
    });

    return this;
  }

  getConnections(callback: (err: Error | null, count: number) => void): void {
    callback(null, this._connections.size);
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  get listening(): boolean {
    return this._listening;
  }

  /**
   * Inject a connection into the server (used by virtual networking).
   */
  injectConnection(socket: Socket): void {
    this._connections.add(socket);
    socket.on('close', () => this._connections.delete(socket));
    this.emit('connection', socket);
  }
}

export function createServer(connectionListener?: (socket: Socket) => void): Server {
  return new Server(connectionListener);
}

export function createConnection(port: number, host?: string, callback?: () => void): Socket;
export function createConnection(options: { port: number; host?: string }, callback?: () => void): Socket;
export function createConnection(portOrOptions: number | { port: number; host?: string }, hostOrCallback?: string | (() => void), callback?: () => void): Socket {
  const socket = new Socket();

  if (typeof portOrOptions === 'number') {
    socket.connect(portOrOptions, hostOrCallback as string, callback);
  } else {
    socket.connect(portOrOptions, hostOrCallback as (() => void));
  }

  return socket;
}

export const connect = createConnection;

export function isIP(input: string): 0 | 4 | 6 {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(input)) {
    const parts = input.split('.').map(Number);
    if (parts.every((p) => p >= 0 && p <= 255)) return 4;
  }
  if (/^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(input)) return 6;
  return 0;
}

export function isIPv4(input: string): boolean {
  return isIP(input) === 4;
}

export function isIPv6(input: string): boolean {
  return isIP(input) === 6;
}

export default {
  Socket,
  Server,
  createServer,
  createConnection,
  connect,
  isIP,
  isIPv4,
  isIPv6,
};
