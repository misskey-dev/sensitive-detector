import { describe, expect, it } from 'vitest';
import { Semaphore } from '../src/semaphore.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Semaphore', () => {
  it('throws for a non-positive-integer concurrency', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
    expect(() => new Semaphore(-1)).toThrow(RangeError);
    expect(() => new Semaphore(1.5)).toThrow(RangeError);
  });

  it('allows up to max concurrent holders and queues the rest', async () => {
    const sem = new Semaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    expect(sem.activeCount).toBe(2);

    let third = false;
    const p3 = sem.acquire().then((release) => {
      third = true;
      return release;
    });
    await tick();
    expect(third).toBe(false); // still queued
    expect(sem.pendingCount).toBe(1);

    r1();
    const r3 = await p3;
    expect(third).toBe(true);
    expect(sem.activeCount).toBe(2);

    r2();
    r3();
    expect(sem.activeCount).toBe(0);
  });

  it('dispatches queued waiters in FIFO order', async () => {
    const sem = new Semaphore(1);
    const r1 = await sem.acquire();
    const order: number[] = [];
    const p2 = sem.acquire().then((rel) => {
      order.push(2);
      return rel;
    });
    const p3 = sem.acquire().then((rel) => {
      order.push(3);
      return rel;
    });
    await tick();
    expect(order).toEqual([]);

    r1();
    const r2 = await p2;
    r2();
    const r3 = await p3;
    r3();
    expect(order).toEqual([2, 3]);
  });

  it('rejects acquire when the signal is already aborted', async () => {
    const sem = new Semaphore(1);
    const controller = new AbortController();
    controller.abort();
    await expect(sem.acquire(controller.signal)).rejects.toBeDefined();
    expect(sem.activeCount).toBe(0);
  });

  it('rejects a waiting acquire when aborted and removes it from the queue', async () => {
    const sem = new Semaphore(1);
    const r1 = await sem.acquire();
    const controller = new AbortController();
    const waiting = sem.acquire(controller.signal);
    await tick();
    expect(sem.pendingCount).toBe(1);

    controller.abort();
    await expect(waiting).rejects.toBeDefined();
    expect(sem.pendingCount).toBe(0);

    // The slot held by r1 is still ours; releasing it returns to zero.
    r1();
    expect(sem.activeCount).toBe(0);
  });

  it('releases the slot when runExclusive throws', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.runExclusive(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(sem.activeCount).toBe(0);

    // Still usable afterwards.
    const release = await sem.acquire();
    expect(sem.activeCount).toBe(1);
    release();
  });

  it('treats a double release as a no-op', async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    release();
    release();
    expect(sem.activeCount).toBe(0);
  });
});
