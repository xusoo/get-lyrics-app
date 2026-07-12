import { describe, it, expect } from 'vitest';
import { SerialQueue } from './serial-queue';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('SerialQueue', () => {
  it('runs at most one job at a time', async () => {
    const q = new SerialQueue();
    let active = 0;
    let maxActive = 0;
    const deferreds: Array<Deferred<void>> = [];

    const makeJob = () => () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const d = makeDeferred<void>();
      deferreds.push(d);
      return d.promise.finally(() => { active -= 1; });
    };

    const p1 = q.enqueue('a', 0, makeJob());
    const p2 = q.enqueue('b', 0, makeJob());
    const p3 = q.enqueue('c', 0, makeJob());

    // Only the first job has started.
    expect(q.activeCount).toBe(1);
    expect(deferreds.length).toBe(1);

    deferreds[0].resolve();
    await p1;
    await flush();
    expect(deferreds.length).toBe(2);

    deferreds[1].resolve();
    await p2;
    await flush();
    expect(deferreds.length).toBe(3);

    deferreds[2].resolve();
    await p3;
    await flush();

    expect(maxActive).toBe(1);
    expect(q.activeCount).toBe(0);
  });

  it('deduplicates jobs with the same key', async () => {
    const q = new SerialQueue();
    const d = makeDeferred<string>();
    let calls = 0;
    const run = () => { calls += 1; return d.promise; };

    const p1 = q.enqueue('same', 0, run);
    const p2 = q.enqueue('same', 0, run);

    expect(p1).toBe(p2);
    expect(calls).toBe(1);

    d.resolve('done');
    expect(await p1).toBe('done');
  });

  it('preempts a lower-priority running job with a higher-priority one', async () => {
    const q = new SerialQueue();
    let lowAborted = false;
    const lowDeferred = makeDeferred<void>();
    const lowRun = (signal: AbortSignal) => {
      signal.addEventListener('abort', () => {
        lowAborted = true;
        lowDeferred.reject(new DOMException('Aborted', 'AbortError'));
      });
      return lowDeferred.promise;
    };
    const highDeferred = makeDeferred<string>();
    let highStarted = false;
    const highRun = () => { highStarted = true; return highDeferred.promise; };

    const pLow = q.enqueue('low', 0, lowRun);
    expect(q.isActive('low')).toBe(true);

    const pHigh = q.enqueue('high', 1, highRun);
    await expect(pLow).rejects.toThrow();
    await flush();

    expect(lowAborted).toBe(true);
    expect(highStarted).toBe(true);
    expect(q.isActive('high')).toBe(true);

    highDeferred.resolve('ok');
    expect(await pHigh).toBe('ok');
  });

  it('runs higher-priority pending jobs before lower-priority ones', async () => {
    const q = new SerialQueue();
    const blocker = makeDeferred<void>();
    // High priority so the later enqueues do not preempt it.
    const pBlocker = q.enqueue('blocker', 5, () => blocker.promise);

    const order: string[] = [];
    const lowDeferred = makeDeferred<void>();
    const highDeferred = makeDeferred<void>();
    const pLow = q.enqueue('low', 0, () => { order.push('low'); return lowDeferred.promise; });
    const pHigh = q.enqueue('high', 1, () => { order.push('high'); return highDeferred.promise; });

    blocker.resolve();
    await pBlocker;
    await flush();

    expect(order).toEqual(['high']);

    highDeferred.resolve();
    await pHigh;
    await flush();

    expect(order).toEqual(['high', 'low']);

    lowDeferred.resolve();
    await pLow;
  });

  it('cancels a pending job without running it', async () => {
    const q = new SerialQueue();
    const blocker = makeDeferred<void>();
    const pBlocker = q.enqueue('blocker', 0, () => blocker.promise);

    let pendingStarted = false;
    const pPending = q.enqueue('pending', 0, () => { pendingStarted = true; return makeDeferred<void>().promise; });

    q.cancel('pending');
    await expect(pPending).rejects.toThrow();
    expect(pendingStarted).toBe(false);

    blocker.resolve();
    await pBlocker;
  });

  it('cancels a running job and starts the next one', async () => {
    const q = new SerialQueue();
    let capturedSignal: AbortSignal | undefined;
    const runningDeferred = makeDeferred<void>();
    const runningRun = (signal: AbortSignal) => {
      capturedSignal = signal;
      signal.addEventListener('abort', () => runningDeferred.reject(new DOMException('Aborted', 'AbortError')));
      return runningDeferred.promise;
    };
    let nextStarted = false;
    const nextDeferred = makeDeferred<void>();
    const nextRun = () => { nextStarted = true; return nextDeferred.promise; };

    const pRun = q.enqueue('run', 0, runningRun);
    const pNext = q.enqueue('next', 0, nextRun);

    q.cancel('run');
    await expect(pRun).rejects.toThrow();
    await flush();

    expect(capturedSignal?.aborted).toBe(true);
    expect(nextStarted).toBe(true);

    nextDeferred.resolve();
    await pNext;
  });
});
