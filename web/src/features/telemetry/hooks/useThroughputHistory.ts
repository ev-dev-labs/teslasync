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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  // A signals/sec rate can never be negative, and NaN/Infinity would poison
  // both the chart and `peak`, so clamp to a finite, non-negative value.
  const rateRef = useRef(0);
  rateRef.current = Number.isFinite(rate) ? Math.max(0, rate) : 0;

  const reset = useCallback(() => setHistory([]), []);

  // Clear the series whenever the reset key (vehicle) changes.
  useEffect(() => {
    setHistory([]);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) return;
    // Guard against a caller passing a non-positive cadence or window: a
    // setInterval(0) busy-loops, and a cap < 1 would discard every sample so
    // the chart would never fill. Fall back to the documented defaults.
    const cadence = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 1000;
    const cap = Number.isFinite(maxPoints) && maxPoints >= 1 ? Math.floor(maxPoints) : 1;
    const id = setInterval(() => {
      setHistory((prev) => {
        const next = [...prev, { ts: new Date().toISOString(), rate: rateRef.current }];
        return next.length > cap ? next.slice(next.length - cap) : next;
      });
    }, cadence);
    return () => clearInterval(id);
  }, [enabled, maxPoints, intervalMs]);

  // Peak over the current window. Memoised so consumers can pass it into a
  // memoised chart child without re-rendering on unrelated parent updates.
  const peak = useMemo(() => history.reduce((m, p) => (p.rate > m ? p.rate : m), 0), [history]);

  return { history, peak, reset };
}
