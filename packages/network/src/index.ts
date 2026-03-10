export { PortTable } from './port-table.js';
export { VirtualTCPServer, createVirtualConnection } from './tcp-virtual.js';
export type { VirtualConnection } from './tcp-virtual.js';
export { parseRequest, parseRequestWithBody, serializeResponse, createResponseFromChunks } from './http-parser.js';
export type { ParsedRequest, SerializedResponse } from './http-parser.js';

// Service worker registration helper
export async function registerServiceWorker(swUrl: string = '/sw.js'): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    console.warn('[network] Service Workers not available');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(swUrl, { scope: '/' });
    // Wait for the service worker to be active
    if (registration.installing) {
      await new Promise<void>((resolve) => {
        registration.installing!.addEventListener('statechange', function handler() {
          if (this.state === 'activated') {
            this.removeEventListener('statechange', handler);
            resolve();
          }
        });
      });
    }
    return registration;
  } catch (e) {
    console.warn('[network] Failed to register service worker:', e);
    return null;
  }
}

// Notify service worker of port bindings via BroadcastChannel
export function notifyPortBind(port: number, handler: MessagePort): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const bc = new BroadcastChannel('wc-network');
  bc.postMessage({ type: 'port-bind', port, handler }, [handler]);
  bc.close();
}

export function notifyPortUnbind(port: number): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const bc = new BroadcastChannel('wc-network');
  bc.postMessage({ type: 'port-unbind', port });
  bc.close();
}
