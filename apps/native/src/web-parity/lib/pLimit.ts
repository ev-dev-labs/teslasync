// Native parity port of web/src/lib/pLimit.ts.
//
// Pure, DOM-free promise-concurrency limiter. No browser, React, Recharts,
// Leaflet, or web UI dependency — the logic relies only on the standard
// Promise microtask queue, which behaves identically under React Native's
// Hermes/JSC engines. This is a faithful 1:1 logic/type port; only native
// prettier formatting (arrowParens:'avoid', printWidth-80 parameter wrapping)
// differs from the web source.

/**
 * pLimit — minimal promise-concurrency limiter.
 *
 * Used by signal-history fan-out fetches (`Promise.all` over N selected
 * signals) so a "select all 80 signals" click doesn't fire 80 parallel
 * requests at the backend. Browsers cap HTTP/1.1 at ~6 per host but
 * HTTP/2 can multiplex hundreds; bounding the in-flight count at the
 * application layer makes both behaviours well-defined.
 *
 * No external dep — the popular `p-limit` npm package adds 4 KB +
 * peerDeps for what is effectively this 30-line function.
 *
 * Usage:
 *
 *     const limit = pLimit(4);
 *     const results = await Promise.all(
 *       items.map((it) => limit(() => fetchOne(it)))
 *     );
 */

export interface PLimitFn {
  <T>(task: () => Promise<T>): Promise<T>;
  /** Number of tasks currently executing. */
  readonly activeCount: number;
  /** Number of tasks queued behind the concurrency cap. */
  readonly pendingCount: number;
}

export function pLimit(concurrency: number): PLimitFn {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError('pLimit: concurrency must be a positive integer');
  }
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (job) job();
  };

  const run = <T>(
    task: () => Promise<T>,
    resolve: (v: T) => void,
    reject: (e: unknown) => void,
  ) => {
    active++;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };

  function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const enqueue = () => run(task, resolve, reject);
      if (active < concurrency) enqueue();
      else queue.push(enqueue);
    });
  }

  Object.defineProperties(limit, {
    activeCount: {get: () => active},
    pendingCount: {get: () => queue.length},
  });

  return limit as PLimitFn;
}
