import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';

export class IncomingMessage extends Readable {
  method: string;
  url: string;
  headers: Record<string, string>;
  httpVersion: string;
  statusCode: number;
  statusMessage: string;

  constructor(options: { method?: string; url?: string; headers?: Record<string, string>; statusCode?: number }) {
    super();
    this.method = options.method ?? 'GET';
    this.url = options.url ?? '/';
    this.headers = options.headers ?? {};
    this.httpVersion = '1.1';
    this.statusCode = options.statusCode ?? 200;
    this.statusMessage = 'OK';
  }
}

export class ServerResponse extends Writable {
  statusCode: number = 200;
  statusMessage: string = 'OK';
  headersSent: boolean = false;
  private headers: Map<string, string> = new Map();
  private chunks: Uint8Array[] = [];
  private _resolve: ((value: { status: number; headers: Record<string, string>; body: Uint8Array }) => void) | null = null;
  finished: boolean = false;

  constructor() {
    super();
  }

  setResponsePromise(resolve: (value: { status: number; headers: Record<string, string>; body: Uint8Array }) => void): void {
    this._resolve = resolve;
  }

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        this.headers.set(key.toLowerCase(), value);
      }
    }
    this.headersSent = true;
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase());
  }

  getHeaders(): Record<string, string> {
    return Object.fromEntries(this.headers);
  }

  hasHeader(name: string): boolean {
    return this.headers.has(name.toLowerCase());
  }

  override _write(chunk: Uint8Array | string, _encoding: string, callback: (err?: Error) => void): void {
    const data = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    this.chunks.push(data);
    callback();
  }

  override end(data?: string | Uint8Array, encoding?: string, callback?: () => void): this {
    if (data) {
      const chunk = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      this.chunks.push(chunk);
    }

    this.finished = true;
    this.headersSent = true;

    // Combine chunks
    let totalLen = 0;
    for (const chunk of this.chunks) totalLen += chunk.length;
    const body = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of this.chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }

    if (this._resolve) {
      this._resolve({
        status: this.statusCode,
        headers: Object.fromEntries(this.headers),
        body,
      });
    }

    this.emit('finish');
    this.emit('close');

    if (callback) callback();
    return this;
  }
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export class Server extends EventEmitter {
  private handler: RequestHandler;
  private port: number = 0;
  private _listening: boolean = false;

  constructor(handler: RequestHandler) {
    super();
    this.handler = handler;
  }

  listen(port: number, callback?: () => void): this;
  listen(port: number, hostname?: string, callback?: () => void): this;
  listen(port: number, hostnameOrCallback?: string | (() => void), maybeCallback?: () => void): this {
    this.port = port;
    this._listening = true;

    const callback = typeof hostnameOrCallback === 'function' ? hostnameOrCallback : maybeCallback;

    // Notify via syscall that we're listening
    if (typeof (globalThis as any).__syscall === 'function') {
      (globalThis as any).__syscall(70 /* NET_LISTEN */, { port });
    }

    if (callback) {
      queueMicrotask(callback);
    }

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

  handleRequest(requestData: { method: string; url: string; headers: Record<string, string>; body: Uint8Array | null }): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }> {
    return new Promise((resolve) => {
      const req = new IncomingMessage({
        method: requestData.method,
        url: requestData.url,
        headers: requestData.headers,
      });

      if (requestData.body) {
        req.push(requestData.body);
      }
      req.push(null);

      const res = new ServerResponse();
      res.setResponsePromise(resolve);

      this.handler(req, res);
    });
  }

  get listening(): boolean {
    return this._listening;
  }
}

export function createServer(handler: RequestHandler): Server {
  return new Server(handler);
}

export default { createServer, Server, IncomingMessage, ServerResponse };
