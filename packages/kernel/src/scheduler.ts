export enum Priority {
  HIGH = 0,
  NORMAL = 1,
  LOW = 2,
}

interface QueueEntry<T> {
  priority: Priority;
  task: T;
  id: number;
}

export class Scheduler<T = () => Promise<void>> {
  private queue: QueueEntry<T>[] = [];
  private nextId: number = 0;
  private running: boolean = false;
  private executor: ((task: T) => Promise<void>) | null = null;

  constructor(executor?: (task: T) => Promise<void>) {
    this.executor = executor ?? null;
  }

  enqueue(priority: Priority, task: T): number {
    const id = this.nextId++;
    const entry: QueueEntry<T> = { priority, task, id };

    // Insert in priority order (lower priority value = higher priority)
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority > priority) {
        this.queue.splice(i, 0, entry);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.queue.push(entry);
    }

    return id;
  }

  dequeue(): T | undefined {
    const entry = this.queue.shift();
    return entry?.task;
  }

  peek(): T | undefined {
    return this.queue[0]?.task;
  }

  get length(): number {
    return this.queue.length;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  clear(): void {
    this.queue = [];
  }

  async run(): Promise<void> {
    if (this.running || !this.executor) return;
    this.running = true;

    while (!this.isEmpty) {
      const task = this.dequeue();
      if (task) {
        try {
          await this.executor(task);
        } catch {
          // Task errors are silently caught; individual tasks handle their own errors
        }
      }
    }

    this.running = false;
  }

  cancel(id: number): boolean {
    const idx = this.queue.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }
}
