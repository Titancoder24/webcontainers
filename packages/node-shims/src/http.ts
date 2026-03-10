/**
 * HTTP module shim for browser environment.
 */

import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';
import { Buffer } from './buffer.js';

export const METHODS = [
  'ACL', 'BIND', 'CHECKOUT', 'CONNECT', 'COPY', 'DELETE', 'GET', 'HEAD',
  'LINK', 'LOCK', 'M-SEARCH', 'MERGE', 'MKACTIVITY', 'MKCALENDAR',
  'MKCOL', 'MOVE', 'NOTIFY', 'OPTIONS', 'PATCH', 'POST', 'PRI',
  'PROPFIND', 'PROPPATCH', 'PURGE', 'PUT', 'REBIND', 'REPORT',
  'SEARCH', 'SOURCE', 'SUBSCRIBE', 'TRACE', 'UNBIND', 'UNLINK',
  'UNLOCK', 'UNSUBSCRIBE',
];

export const STATUS_CODES: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  102: 'Processing',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export class IncomingMessage extends Readable {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: string[];
  httpVersion: string;
  statusCode: number;
  statusMessage: string;
  complete: boolean = false;
  aborted: boolean = false;
  socket: unknown = null;

  constructor(options?: {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    httpVersion?: string;
    statusCode?: number;
    statusMessage?: string;
  }) {
    super();
    this.method = options?.method || 'GET';
    this.url = options?.url || '/';
    this.headers = options?.headers || {};
    this.rawHeaders = [];
    this.httpVersion = options?.httpVersion || '1.1';
    this.statusCode = options?.statusCode || 200;
    this.statusMessage = options?.statusMessage || 'OK';

    // Build rawHeaders from headers
    for (const [key, value] of Object.entries(this.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          this.rawHeaders.push(key, v);
        }
      } else if (value !== undefined) {
        this.rawHeaders.push(key, value);
      }
    }
  }

  setTimeout(msecs: number, callback?: () => void): this {
    if (callback) {
      this.once('timeout', callback);
    }
    globalThis.setTimeout(() => this.emit('timeout'), msecs);
    return this;
  }
}

export class ServerResponse extends Writable {
  statusCode: number = 200;
  statusMessage: string = 'OK';
  headersSent: boolean = false;
  finished: boolean = false;
  sendDate: boolean = true;

  private _headers: Map<string, string | string[]> = new Map();
  private _body: Buffer[] = [];

  constructor() {
    super({
      write: (chunk: Buffer | string, _encoding: string, callback: (err?: Error | null) => void) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk instanceof Buffer ? chunk : Buffer.from(chunk);
        this._body.push(buf);
        callback();
      },
    });
  }

  writeHead(statusCode: number, statusMessage?: string | Record<string, string | string[]>, headers?: Record<string, string | string[]>): this {
    this.statusCode = statusCode;

    let hdrs: Record<string, string | string[]> | undefined;
    if (typeof statusMessage === 'string') {
      this.statusMessage = statusMessage;
      hdrs = headers;
    } else if (typeof statusMessage === 'object') {
      hdrs = statusMessage;
    }

    if (hdrs) {
      for (const [key, value] of Object.entries(hdrs)) {
        this._headers.set(key.toLowerCase(), value);
      }
    }

    this.headersSent = true;
    return this;
  }

  setHeader(name: string, value: string | string[]): this {
    this._headers.set(name.toLowerCase(), value);
    return this;
  }

  getHeader(name: string): string | string[] | undefined {
    return this._headers.get(name.toLowerCase());
  }

  getHeaders(): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {};
    for (const [key, value] of this._headers) {
      headers[key] = value;
    }
    return headers;
  }

  getHeaderNames(): string[] {
    return [...this._headers.keys()];
  }

  hasHeader(name: string): boolean {
    return this._headers.has(name.toLowerCase());
  }

  removeHeader(name: string): void {
    this._headers.delete(name.toLowerCase());
  }

  flushHeaders(): void {
    this.headersSent = true;
  }

  setTimeout(msecs: number, callback?: () => void): this {
    if (callback) {
      this.once('timeout', callback);
    }
    globalThis.setTimeout(() => this.emit('timeout'), msecs);
    return this;
  }

  getBody(): Buffer {
    return Buffer.concat(this._body);
  }

  end(chunkOrCallback?: Buffer | string | Uint8Array | (() => void), encodingOrCallback?: string | (() => void), callback?: () => void): this {
    this.finished = true;
    this.headersSent = true;
    return super.end(chunkOrCallback as Buffer, encodingOrCallback as string, callback);
  }
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export class VirtualServer extends EventEmitter {
  private _handler: RequestHandler | null = null;
  private _listening: boolean = false;
  private _address: { port: number; family: string; address: string } | null = null;

  constructor(handler?: RequestHandler) {
    super();
    this._handler = handler || null;
    this.on('request', (req: IncomingMessage, res: ServerResponse) => {
      if (this._handler) {
        this._handler(req, res);
      }
    });
  }

  listen(port?: number, hostname?: string | (() => void), backlog?: number | (() => void), callback?: () => void): this {
    let cb: (() => void) | undefined;
    let actualPort = port || 0;

    if (typeof hostname === 'function') {
      cb = hostname;
    } else if (typeof backlog === 'function') {
      cb = backlog;
    } else {
      cb = callback;
    }

    if (actualPort === 0) {
      actualPort = 3000 + Math.floor(Math.random() * 1000);
    }

    this._address = {
      port: actualPort,
      family: 'IPv4',
      address: typeof hostname === 'string' ? hostname : '0.0.0.0',
    };
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
    this._address = null;

    queueMicrotask(() => {
      this.emit('close');
      if (callback) callback();
    });

    return this;
  }

  /**
   * Inject a request into the virtual server for testing/internal use.
   */
  inject(options: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  }): Promise<{ statusCode: number; headers: Record<string, string | string[]>; body: Buffer }> {
    return new Promise((resolve) => {
      const req = new IncomingMessage({
        method: options.method || 'GET',
        url: options.url || '/',
        headers: options.headers || {},
      });

      if (options.body) {
        const bodyBuf = typeof options.body === 'string' ? Buffer.from(options.body) : options.body;
        req.push(bodyBuf);
        req.push(null);
      } else {
        req.push(null);
      }

      const res = new ServerResponse();
      res.on('finish', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.getHeaders(),
          body: res.getBody(),
        });
      });

      this.emit('request', req, res);
    });
  }

  get listening(): boolean {
    return this._listening;
  }
}

export function createServer(handler?: RequestHandler): VirtualServer {
  return new VirtualServer(handler);
}

export function request(
  urlOrOptions: string | { hostname?: string; port?: number; path?: string; method?: string; headers?: Record<string, string> },
  optionsOrCallback?: Record<string, unknown> | ((res: IncomingMessage) => void),
  callback?: (res: IncomingMessage) => void
): ClientRequest {
  let options: { hostname?: string; port?: number; path?: string; method?: string; headers?: Record<string, string> };
  let cb: ((res: IncomingMessage) => void) | undefined;

  if (typeof urlOrOptions === 'string') {
    const url = new URL(urlOrOptions);
    options = {
      hostname: url.hostname,
      port: url.port ? parseInt(url.port) : undefined,
      path: url.pathname + url.search,
      method: 'GET',
    };
    if (typeof optionsOrCallback === 'function') {
      cb = optionsOrCallback;
    } else {
      Object.assign(options, optionsOrCallback);
      cb = callback;
    }
  } else {
    options = urlOrOptions;
    if (typeof optionsOrCallback === 'function') {
      cb = optionsOrCallback;
    } else {
      cb = callback;
    }
  }

  return new ClientRequest(options, cb);
}

export function get(
  urlOrOptions: string | Record<string, unknown>,
  optionsOrCallback?: Record<string, unknown> | ((res: IncomingMessage) => void),
  callback?: (res: IncomingMessage) => void
): ClientRequest {
  const req = request(urlOrOptions as string, optionsOrCallback, callback);
  req.end();
  return req;
}

class ClientRequest extends Writable {
  private _options: { hostname?: string; port?: number; path?: string; method?: string; headers?: Record<string, string> };
  private _callback: ((res: IncomingMessage) => void) | undefined;
  private _body: Buffer[] = [];
  aborted: boolean = false;

  constructor(
    options: { hostname?: string; port?: number; path?: string; method?: string; headers?: Record<string, string> },
    callback?: (res: IncomingMessage) => void
  ) {
    super({
      write: (chunk: Buffer | string, _encoding: string, cb: (err?: Error | null) => void) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk instanceof Buffer ? chunk : Buffer.from(chunk);
        this._body.push(buf);
        cb();
      },
      final: (cb: (err?: Error | null) => void) => {
        this._send();
        cb();
      },
    });
    this._options = options;
    this._callback = callback;

    if (callback) {
      this.on('response', callback);
    }
  }

  private _send(): void {
    const protocol = 'http:';
    const host = this._options.hostname || 'localhost';
    const port = this._options.port ? `:${this._options.port}` : '';
    const path = this._options.path || '/';
    const url = `${protocol}//${host}${port}${path}`;

    const body = this._body.length > 0 ? Buffer.concat(this._body) : undefined;

    const fetchOptions: RequestInit = {
      method: this._options.method || 'GET',
      headers: this._options.headers,
    };

    if (body && fetchOptions.method !== 'GET' && fetchOptions.method !== 'HEAD') {
      fetchOptions.body = body;
    }

    fetch(url, fetchOptions)
      .then(async (response) => {
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        const res = new IncomingMessage({
          statusCode: response.status,
          statusMessage: response.statusText,
          headers,
          httpVersion: '1.1',
        });

        const arrayBuf = await response.arrayBuffer();
        res.push(Buffer.from(new Uint8Array(arrayBuf)));
        res.push(null);

        this.emit('response', res);
      })
      .catch((err) => {
        this.emit('error', err);
      });
  }

  abort(): void {
    this.aborted = true;
    this.emit('abort');
    this.destroy();
  }

  setTimeout(msecs: number, callback?: () => void): this {
    if (callback) {
      this.once('timeout', callback);
    }
    globalThis.setTimeout(() => this.emit('timeout'), msecs);
    return this;
  }

  setNoDelay(_noDelay?: boolean): void {
    // No-op in browser
  }

  setSocketKeepAlive(_enable?: boolean, _initialDelay?: number): void {
    // No-op in browser
  }
}

export { ClientRequest };

export default {
  METHODS,
  STATUS_CODES,
  IncomingMessage,
  ServerResponse,
  VirtualServer,
  ClientRequest,
  createServer,
  request,
  get,
};
