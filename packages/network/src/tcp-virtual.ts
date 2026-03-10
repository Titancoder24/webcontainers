export interface VirtualConnection {
  clientPort: MessagePort;
  serverPort: MessagePort;
  id: string;
}

let connectionCounter = 0;

export function createVirtualConnection(): VirtualConnection {
  const channel = new MessageChannel();
  const id = `conn-${++connectionCounter}`;

  return {
    clientPort: channel.port1,
    serverPort: channel.port2,
    id,
  };
}

export class VirtualTCPServer {
  private port: number;
  private connections: Map<string, VirtualConnection> = new Map();
  private onConnection: ((conn: VirtualConnection) => void) | null = null;
  private listening: boolean = false;

  constructor(port: number) {
    this.port = port;
  }

  listen(callback?: () => void): void {
    this.listening = true;
    if (callback) {
      queueMicrotask(callback);
    }
  }

  onIncomingConnection(handler: (conn: VirtualConnection) => void): void {
    this.onConnection = handler;
  }

  acceptConnection(): VirtualConnection {
    const conn = createVirtualConnection();
    this.connections.set(conn.id, conn);

    if (this.onConnection) {
      this.onConnection(conn);
    }

    return conn;
  }

  close(): void {
    this.listening = false;
    for (const conn of this.connections.values()) {
      conn.clientPort.close();
      conn.serverPort.close();
    }
    this.connections.clear();
  }

  get isListening(): boolean {
    return this.listening;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  getPort(): number {
    return this.port;
  }
}
