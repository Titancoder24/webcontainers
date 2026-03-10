import { describe, it, expect, vi } from 'vitest';
import { WatcherRegistry } from '../src/watcher.js';

describe('WatcherRegistry', () => {
  it('should notify matching watchers', () => {
    const registry = new WatcherRegistry();
    const cb = vi.fn();
    registry.watch('/app/src', { recursive: false }, cb);
    registry.notify('/app/src/file.ts', 'change', 'file.ts');
    expect(cb).toHaveBeenCalledWith('change', 'file.ts');
  });

  it('should notify recursive watchers for nested changes', () => {
    const registry = new WatcherRegistry();
    const cb = vi.fn();
    registry.watch('/app', { recursive: true }, cb);
    registry.notify('/app/src/deep/file.ts', 'change', 'file.ts');
    expect(cb).toHaveBeenCalled();
  });

  it('should not notify non-matching watchers', () => {
    const registry = new WatcherRegistry();
    const cb = vi.fn();
    registry.watch('/other', { recursive: false }, cb);
    registry.notify('/app/file.ts', 'change', 'file.ts');
    expect(cb).not.toHaveBeenCalled();
  });

  it('should unsubscribe when calling returned function', () => {
    const registry = new WatcherRegistry();
    const cb = vi.fn();
    const unsub = registry.watch('/app', {}, cb);
    unsub();
    registry.notify('/app/file.ts', 'change', 'file.ts');
    expect(cb).not.toHaveBeenCalled();
  });

  it('should handle multiple watchers on same path', () => {
    const registry = new WatcherRegistry();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    registry.watch('/app', {}, cb1);
    registry.watch('/app', {}, cb2);
    registry.notify('/app/file.ts', 'change', 'file.ts');
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });
});
