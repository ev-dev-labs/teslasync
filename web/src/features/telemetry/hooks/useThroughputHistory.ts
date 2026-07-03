/**
 * useThroughputHistory — samples a live "signals / sec" rate into a rolling
 * time-series so the Live Signal Monitor can chart throughput over time.
 *
 * This is NOT a data-loading hook — it only accumulates values that are
 * already being streamed by `useLiveSignalStream`. It reads the latest rate
 * from a ref and appends one sample per `intervalMs` so a flat (zero) line is
 * still drawn while the vehicle is idle. The buffer is capped at `maxPoints`
 * and cleared whenever `resetKey` changes (e.g. on vehicle switch).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ThroughputPoint {
  /** ISO timestamp of the sample — formatted at the display boundary. */
  ts: string;
  /** Signals-per-second observed in the sampled window. */
  rate: number;
}

export interface UseThroughputHistoryOptions {
  /** Pause sampling when false (e.g. stream disabled). Default true. */
  enabled?: boolean;
  /** Rolling window length in samples. Default 60 (≈ last minute at 1 Hz). */
  maxPoints?: number;
  /** Sampling cadence in milliseconds. Default 1000. */
  intervalMs?: number;
  /** Changing this value clears the series (e.g. the selected vehicle id). */
  resetKey?: unknown;
}

export interface UseThroughputHistoryResult {
  /** Rolling series, oldest first, capped at `maxPoints`. */
  history: ThroughputPoint[];
  /** Peak rate observed within the current window. */
  peak: number;
  /** Manually clear the series. */
  reset: () => void;
}

export function useThroughputHistory(
  rate: number,
  { enabled = true, maxPoints = 60, intervalMs = 1000, resetKey }: UseThroughputHistoryOptions = {},
): UseThroughputHistoryResult {
  const [history, setHistory] = useState<ThroughputPoint[]>([]);

  // Keep the latest rate in a ref so the sampling interval stays stable.
  const rateRef = useRef(rate);
  rateRef.current = Number.isFinite(rate) ? rate : 0;

  const reset = useCallback(() => setHistory([]), []);

  // Clear the series whenever the reset key (vehicle) changes.
  useEffect(() => {
    setHistory([]);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      setHistory((prev) => {
        const next = [...prev, { ts: new Date().toISOString(), rate: rateRef.current }];
        return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, maxPoints, intervalMs]);

  const peak = history.reduce((m, p) => (p.rate > m ? p.rate : m), 0);

  return { history, peak, reset };
}
