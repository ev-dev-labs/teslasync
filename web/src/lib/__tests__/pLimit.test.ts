import { describe, expect, it, vi } from 'vitest';
import { pLimit } from '../pLimit';

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('pLimit', () => {
  it('runs all tasks and returns results in order', async () => {
    const limit = pLimit(2);
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => limit(async () => n * 2)),
    );
    expect(results).toEqual([2, 4, 6, 8]);
  });

  it('caps the number of in-flight tasks at the configured concurrency', async () => {
    const limit = pLimit(3);
    let max = 0;
    let inflight = 0;
    const job = async () => {
      inflight++;
      if (inflight > max) max = inflight;
      await tick(10);
      inflight--;
    };
    await Promise.all(Array.from({ length: 12 }, () => limit(job)));
    expect(max).toBeLessThanOrEqual(3);
    expect(max).toBeGreaterThan(0);
  });

  it('propagates task rejections without stopping the queue', async () => {
    const limit = pLimit(1);
    const ok = vi.fn().mockResolvedValue('ok');
    const fail = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(limit(fail)).rejects.toThrow('boom');
    await expect(limit(ok)).resolves.toBe('ok');
    expect(ok).toHaveBeenCalledOnce();
  });

  it('rejects invalid concurrency values', () => {
    expect(() => pLimit(0)).toThrow();
    expect(() => pLimit(-1)).toThrow();
    expect(() => pLimit(1.5)).toThrow();
  });

  it('exposes activeCount and pendingCount', async () => {
    const limit = pLimit(2);
    const gate: Array<() => void> = [];
    const blocked = () => new Promise<void>((r) => gate.push(r));
    const p1 = limit(blocked);
    const p2 = limit(blocked);
    const p3 = limit(blocked);
    await tick(0);
    expect(limit.activeCount).toBe(2);
    expect(limit.pendingCount).toBe(1);
    // Drain the queue: each resolve() flushes one in-flight task and lets
    // the limiter dequeue the next blocked() call (which pushes a fresh
    // resolver onto `gate`). Loop until everything settles.
    while (gate.length > 0) {
      const r = gate.shift();
      r?.();
      await tick(0);
    }
    await Promise.all([p1, p2, p3]);
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });
});
