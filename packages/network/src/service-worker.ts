// This file is the Service Worker script.
// It must be a standalone file served from the root scope.
// It intercepts fetch events and routes virtual port requests to handlers.

declare const self: ServiceWorkerGlobalScope;

interface PortHandler {
  port: MessagePort;
  active: boolean;
}

const portHandlers = new Map<number, PortHandler>();
const pendingRequests = new Map<string, { resolve: (r: Response) => void; reject: (e: Error) => void }>();
let requestCounter = 0;

// Listen for port bind/unbind messages from the main thread
const bc = new BroadcastChannel('wc-network');
bc.addEventListener('message', (event: MessageEvent) => {
  const data = event.data;
  if (data.type === 'port-bind') {
    portHandlers.set(data.port, { port: data.handler, active: true });
    data.handler.onmessage = (e: MessageEvent) => {
      handlePortResponse(e.data);
    };
  } else if (data.type === 'port-unbind') {
    const handler = portHandlers.get(data.port);
    if (handler) {
      handler.active = false;
      portHandlers.delete(data.port);
    }
  }
});

function handlePortResponse(data: any): void {
  const { requestId, status, statusText, headers, body } = data;
  const pending = pendingRequests.get(requestId);
  if (pending) {
    pendingRequests.delete(requestId);
    const responseHeaders = new Headers(headers ?? {});
    pending.resolve(new Response(body, { status: status ?? 200, statusText: statusText ?? 'OK', headers: responseHeaders }));
  }
}

function extractPortFromUrl(url: URL): number | null {
  // Check for /__wc_port_{port}/ pattern
  const match = url.pathname.match(/^\/__wc_port_(\d+)(\/.*)?$/);
  if (match) {
    return parseInt(match[1], 10);
  }

  // Check for {port}.webcontainer.local hostname
  const hostMatch = url.hostname.match(/^(\d+)\.webcontainer\.local$/);
  if (hostMatch) {
    return parseInt(hostMatch[1], 10);
  }

  return null;
}

self.addEventListener('install', () => {
  (self as any).skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil((self as any).clients.claim());
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  const port = extractPortFromUrl(url);

  if (port === null) {
    // Not a virtual port request, pass through
    return;
  }

  const handler = portHandlers.get(port);
  if (!handler || !handler.active) {
    event.respondWith(new Response('Port not found', { status: 502, statusText: 'Bad Gateway' }));
    return;
  }

  event.respondWith(forwardToHandler(event.request, handler.port, url, port));
});

async function forwardToHandler(request: Request, handlerPort: MessagePort, url: URL, port: number): Promise<Response> {
  const requestId = `req-${++requestCounter}`;

  // Rewrite URL to remove the port prefix
  let rewrittenPath = url.pathname;
  const prefixMatch = rewrittenPath.match(/^\/__wc_port_\d+(\/.*)?$/);
  if (prefixMatch) {
    rewrittenPath = prefixMatch[1] ?? '/';
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let body: ArrayBuffer | null = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      body = await request.arrayBuffer();
    } catch {
      // ignore
    }
  }

  return new Promise<Response>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });

    // Set a timeout
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        resolve(new Response('Gateway Timeout', { status: 504 }));
      }
    }, 30000);

    handlerPort.postMessage({
      requestId,
      method: request.method,
      url: rewrittenPath + url.search,
      headers,
      body: body ? new Uint8Array(body) : null,
    });
  });
}
