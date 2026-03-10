import type { WebContainer, WebContainerProcess } from './index.js';

export interface TerminalLike {
  write(data: string): void;
  onData(callback: (data: string) => void): { dispose(): void };
  cols?: number;
  rows?: number;
}

export class TerminalAdapter {
  private container: WebContainer;
  private process: WebContainerProcess | null = null;
  private disposables: Array<{ dispose(): void }> = [];
  private outputReader: ReadableStreamDefaultReader<string> | null = null;

  constructor(container: WebContainer) {
    this.container = container;
  }

  async startShell(terminal: TerminalLike): Promise<void> {
    // Spawn shell process
    this.process = await this.container.spawn('sh', [], {
      terminal: {
        cols: terminal.cols ?? 80,
        rows: terminal.rows ?? 24,
      },
    });

    // Pipe process output to terminal
    this.outputReader = this.process.output.getReader();
    this.readOutput(terminal);

    // Pipe terminal input to process
    const writer = this.process.input.getWriter();
    const disposable = terminal.onData((data: string) => {
      // Handle special keys
      if (data === '\x03') {
        // Ctrl+C - SIGINT
        this.process?.kill();
        terminal.write('^C\r\n');
        return;
      }
      if (data === '\x04') {
        // Ctrl+D - EOF
        writer.close().catch(() => {});
        return;
      }

      writer.write(data).catch(() => {});
    });

    this.disposables.push(disposable);
  }

  private async readOutput(terminal: TerminalLike): Promise<void> {
    if (!this.outputReader) return;

    try {
      while (true) {
        const { done, value } = await this.outputReader.read();
        if (done) break;
        terminal.write(value);
      }
    } catch {
      // Stream closed
    }
  }

  async dispose(): Promise<void> {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];

    if (this.outputReader) {
      try {
        await this.outputReader.cancel();
      } catch {
        // ignore
      }
      this.outputReader = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
