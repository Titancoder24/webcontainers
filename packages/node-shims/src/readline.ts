import { EventEmitter } from './events.js';

export interface ReadlineInterface extends EventEmitter {
  question(query: string, callback: (answer: string) => void): void;
  close(): void;
  prompt(preserveCursor?: boolean): void;
  write(data: string): void;
}

class Interface extends EventEmitter implements ReadlineInterface {
  private input: any;
  private output: any;
  private promptStr: string;
  private closed: boolean = false;
  private buffer: string = '';

  constructor(options: { input: any; output?: any; prompt?: string; terminal?: boolean }) {
    super();
    this.input = options.input;
    this.output = options.output ?? null;
    this.promptStr = options.prompt ?? '> ';

    if (this.input && typeof this.input.on === 'function') {
      this.input.on('data', (data: any) => {
        const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
        this.buffer += str;

        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
          this.emit('line', line.replace(/\r$/, ''));
        }
      });

      this.input.on('end', () => {
        if (this.buffer.length > 0) {
          this.emit('line', this.buffer);
          this.buffer = '';
        }
        this.close();
      });
    }
  }

  question(query: string, callback: (answer: string) => void): void {
    if (this.output && typeof this.output.write === 'function') {
      this.output.write(query);
    }
    this.once('line', callback);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  prompt(preserveCursor?: boolean): void {
    if (this.output && typeof this.output.write === 'function') {
      this.output.write(this.promptStr);
    }
  }

  write(data: string): void {
    if (this.output && typeof this.output.write === 'function') {
      this.output.write(data);
    }
  }

  setPrompt(prompt: string): void {
    this.promptStr = prompt;
  }

  getPrompt(): string {
    return this.promptStr;
  }
}

export function createInterface(options: {
  input: any;
  output?: any;
  prompt?: string;
  terminal?: boolean;
}): Interface {
  return new Interface(options);
}

export default { createInterface };
