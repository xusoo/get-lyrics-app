/**
 * A generic serial request queue.
 *
 * Guarantees:
 * - Concurrency of 1 — at most one job runs at any time.
 * - Deduplication by key — enqueuing an existing key returns the same promise.
 * - Priority — higher-priority pending jobs run first; a strictly-higher-priority
 *   enqueue preempts (aborts) the currently running lower-priority job.
 * - Cancellation — a pending job is dropped; a running job is aborted via its signal.
 *
 * Each job's `run` receives an AbortSignal it must honour so cancellation/preemption
 * can actually stop in-flight work.
 */

interface Job {
  key: string;
  priority: number;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  promise: Promise<unknown>;
  running: boolean;
}

export class SerialQueue {
  private jobs = new Map<string, Job>();
  private pending: string[] = [];
  private activeKey: string | null = null;

  /** Number of jobs currently executing (0 or 1). */
  get activeCount(): number {
    return this.activeKey === null ? 0 : 1;
  }

  /** Number of jobs waiting to run. */
  get pendingCount(): number {
    return this.pending.length;
  }

  has(key: string): boolean {
    return this.jobs.has(key);
  }

  isActive(key: string): boolean {
    return this.activeKey === key;
  }

  /**
   * Enqueue (or join) a job. If `key` already exists the existing promise is
   * returned; if it hasn't started yet and the new priority is higher, it is
   * promoted. A strictly-higher-priority enqueue preempts a running lower job.
   */
  enqueue<T>(key: string, priority: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const existing = this.jobs.get(key);
    if (existing) {
      if (!existing.running && priority > existing.priority) {
        existing.priority = priority;
        this.sortPending();
      }
      return existing.promise as Promise<T>;
    }

    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const job: Job = {
      key,
      priority,
      controller: new AbortController(),
      run: run as (signal: AbortSignal) => Promise<unknown>,
      resolve,
      reject,
      promise,
      running: false,
    };

    this.jobs.set(key, job);
    this.pending.push(key);
    this.sortPending();

    // Preempt a strictly-lower-priority running job so this one can start sooner.
    if (this.activeKey !== null) {
      const active = this.jobs.get(this.activeKey);
      if (active && priority > active.priority) {
        this.cancel(this.activeKey);
      }
    }

    this.pump();
    return promise as Promise<T>;
  }

  /** Cancel a pending or running job. Its promise rejects with an AbortError. */
  cancel(key: string): void {
    const job = this.jobs.get(key);
    if (!job) return;

    if (job.running) {
      // The running job's `run` observes the abort and rejects; the pump's
      // finally handler then cleans up and starts the next job.
      job.controller.abort();
      return;
    }

    const index = this.pending.indexOf(key);
    if (index >= 0) this.pending.splice(index, 1);
    this.jobs.delete(key);
    job.reject(new DOMException('Aborted', 'AbortError'));
  }

  /** Abort everything and clear all state. Intended for teardown/tests. */
  clear(): void {
    for (const job of this.jobs.values()) {
      job.controller.abort();
      if (!job.running) job.reject(new DOMException('Aborted', 'AbortError'));
    }
    this.jobs.clear();
    this.pending = [];
    this.activeKey = null;
  }

  private sortPending(): void {
    // Stable sort by priority descending (Array.prototype.sort is stable in ES2019+),
    // preserving insertion order among equal priorities.
    this.pending.sort((a, b) => (this.jobs.get(b)?.priority ?? 0) - (this.jobs.get(a)?.priority ?? 0));
  }

  private pump(): void {
    if (this.activeKey !== null) return; // invariant: at most one running job
    const key = this.pending.shift();
    if (key === undefined) return;

    const job = this.jobs.get(key);
    if (!job) {
      this.pump();
      return;
    }

    this.activeKey = key;
    job.running = true;

    let result: Promise<unknown>;
    try {
      result = job.run(job.controller.signal);
    } catch (err) {
      result = Promise.reject(err);
    }

    result.then(job.resolve, job.reject).finally(() => {
      this.jobs.delete(key);
      this.activeKey = null;
      this.pump();
    });
  }
}
