import { describe, it, expect } from 'vitest';
import { SABPool } from '../src/memory.js';

describe('SABPool', () => {
  it('should pre-allocate buffers', () => {
    const pool = new SABPool(4);
    expect(pool.available).toBe(4);
  });

  it('should allocate and release buffers', () => {
    const pool = new SABPool(2);
    const sab1 = pool.allocate();
    expect(sab1).toBeInstanceOf(SharedArrayBuffer);
    expect(pool.available).toBe(1);

    pool.release(sab1);
    expect(pool.available).toBe(2);
  });

  it('should create new buffers when pool is exhausted', () => {
    const pool = new SABPool(1);
    const sab1 = pool.allocate();
    const sab2 = pool.allocate();
    expect(sab1).toBeInstanceOf(SharedArrayBuffer);
    expect(sab2).toBeInstanceOf(SharedArrayBuffer);
    expect(sab1).not.toBe(sab2);
  });

  it('should clear buffer on allocate', () => {
    const pool = new SABPool(1);
    const sab = pool.allocate();
    const arr = new Uint8Array(sab);
    arr[0] = 42;
    pool.release(sab);

    const reused = pool.allocate();
    const reusedArr = new Uint8Array(reused);
    expect(reusedArr[0]).toBe(0);
  });

  it('should report usage', () => {
    const pool = new SABPool(3);
    pool.allocate();
    pool.allocate();
    const usage = pool.getUsage();
    expect(usage.inUse).toBeGreaterThan(0);
    expect(usage.total).toBeGreaterThan(0);
  });
});
