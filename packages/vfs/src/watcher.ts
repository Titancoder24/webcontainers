import { normalizePath } from './path-resolver.js';

export type WatchEventType = 'rename' | 'change';
export type WatchCallback = (eventType: WatchEventType, filename: string | null) => void;

interface WatchEntry {
  path: string;
  recursive: boolean;
  callback: WatchCallback;
  id: number;
}

export class WatcherRegistry {
  private watchers: Map<number, WatchEntry> = new Map();
  private nextId: number = 1;

  watch(
    path: string,
    options: { recursive?: boolean },
    callback: WatchCallback
  ): () => void {
    const id = this.nextId++;
    const normalized = normalizePath(path);
    this.watchers.set(id, {
      path: normalized,
      recursive: options.recursive ?? false,
      callback,
      id,
    });
    return () => {
      this.watchers.delete(id);
    };
  }

  notify(path: string, eventType: WatchEventType, filename: string | null): void {
    const normalized = normalizePath(path);

    for (const entry of this.watchers.values()) {
      if (this.matches(entry, normalized)) {
        try {
          entry.callback(eventType, filename);
        } catch {
          // Watcher callback errors should not propagate
        }
      }
    }
  }

  private matches(entry: WatchEntry, changedPath: string): boolean {
    if (changedPath === entry.path) return true;
    if (entry.recursive && changedPath.startsWith(entry.path + '/')) return true;
    // Also match if the changed path is a direct child
    const parent = changedPath.substring(0, changedPath.lastIndexOf('/')) || '/';
    if (parent === entry.path) return true;
    return false;
  }

  clear(): void {
    this.watchers.clear();
  }

  get size(): number {
    return this.watchers.size;
  }
}
