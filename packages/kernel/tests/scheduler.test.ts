import { describe, it, expect } from 'vitest';
import { Scheduler, Priority } from '../src/scheduler.js';

describe('Scheduler', () => {
  it('should enqueue and dequeue tasks', () => {
    const scheduler = new Scheduler<string>();
    scheduler.enqueue(Priority.NORMAL, 'task1');
    scheduler.enqueue(Priority.NORMAL, 'task2');
    expect(scheduler.dequeue()).toBe('task1');
    expect(scheduler.dequeue()).toBe('task2');
  });

  it('should respect priority ordering', () => {
    const scheduler = new Scheduler<string>();
    scheduler.enqueue(Priority.LOW, 'low');
    scheduler.enqueue(Priority.HIGH, 'high');
    scheduler.enqueue(Priority.NORMAL, 'normal');
    expect(scheduler.dequeue()).toBe('high');
    expect(scheduler.dequeue()).toBe('normal');
    expect(scheduler.dequeue()).toBe('low');
  });

  it('should report length and isEmpty', () => {
    const scheduler = new Scheduler<string>();
    expect(scheduler.isEmpty).toBe(true);
    expect(scheduler.length).toBe(0);

    scheduler.enqueue(Priority.NORMAL, 'task');
    expect(scheduler.isEmpty).toBe(false);
    expect(scheduler.length).toBe(1);
  });

  it('should cancel tasks by id', () => {
    const scheduler = new Scheduler<string>();
    const id = scheduler.enqueue(Priority.NORMAL, 'task');
    expect(scheduler.cancel(id)).toBe(true);
    expect(scheduler.isEmpty).toBe(true);
  });

  it('should peek without removing', () => {
    const scheduler = new Scheduler<string>();
    scheduler.enqueue(Priority.NORMAL, 'task');
    expect(scheduler.peek()).toBe('task');
    expect(scheduler.length).toBe(1);
  });

  it('should run all tasks with executor', async () => {
    const results: string[] = [];
    const scheduler = new Scheduler<string>(async (task) => {
      results.push(task);
    });
    scheduler.enqueue(Priority.NORMAL, 'a');
    scheduler.enqueue(Priority.NORMAL, 'b');
    await scheduler.run();
    expect(results).toEqual(['a', 'b']);
  });
});
