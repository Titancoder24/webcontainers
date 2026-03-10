import { SAB_SIZE, WORKER_POOL_SIZE } from '@aspect/shared';

export class SABPool {
  private pool: SharedArrayBuffer[] = [];
  private inUse: Set<SharedArrayBuffer> = new Set();
  private totalAllocated: number = 0;

  constructor(preAllocate: number = WORKER_POOL_SIZE) {
    for (let i = 0; i < preAllocate; i++) {
      const sab = new SharedArrayBuffer(SAB_SIZE);
      this.pool.push(sab);
      this.totalAllocated += SAB_SIZE;
    }
  }

  allocate(): SharedArrayBuffer {
    const sab = this.pool.pop();
    if (sab) {
      this.inUse.add(sab);
      // Clear the buffer
      new Uint8Array(sab).fill(0);
      return sab;
    }

    // Pool exhausted, create new
    const newSab = new SharedArrayBuffer(SAB_SIZE);
    this.inUse.add(newSab);
    this.totalAllocated += SAB_SIZE;
    return newSab;
  }

  release(sab: SharedArrayBuffer): void {
    if (this.inUse.delete(sab)) {
      new Uint8Array(sab).fill(0);
      this.pool.push(sab);
    }
  }

  getUsage(): { total: number; inUse: number; pooled: number } {
    return {
      total: this.totalAllocated,
      inUse: this.inUse.size * SAB_SIZE,
      pooled: this.pool.length * SAB_SIZE,
    };
  }

  get available(): number {
    return this.pool.length;
  }
}
