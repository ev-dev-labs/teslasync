/**
 * useLiveSignalStream — shared SSE subscriber for the signals workspace.
 *
 * Drives both the live chart (selected-signals only, 2 Hz throttled) and
 * the live tail (full firehose, vehicle-scoped) from a single SSE
 * subscription so callers don't double-subscribe.
 *
 * Used by:
 *   - SignalsWorkspacePage    (chart + tail)
 *   - LiveSignalMonitorPage   (tail only — pass empty chartSignals)
 *   - SignalExplorerPage      (chart only — pass tailMax: 0)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import type { SignalEntry } from '@/types/telemetry';

const LIVE_WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window for live chart
const LIVE_THROTTLE_MS = 500;          // 2 Hz chart updates
const DEFAULT_TAIL_MAX = 500;

export interface SignalStat {
  signal: string;
  min: number;
  max: number;
  avg: number;
  count: number;
}

export interface UseLiveSignalStreamOptions {
  /** Master switch — disables both subscription and buffer accumulation when false. */
  enabled: boolean;
  /** Vehicle to scope events to. Pass null to receive all (system) events. */
  vehicleId: number | null;
  /** Subset of signals to chart. Empty array disables the chart slice. */
  chartSignals: string[];
  /** Max tail buffer size. Default 500. Pass 0 to disable tail collection. */
  tailMax?: number;
}

export interface UseLiveSignalStreamResult {
  /** SSE connection state (mirrors useRealtimeEvents). */
  connected: boolean;

  // ── Chart slice ───────────────────────────────────────────────
  chartData: Record<string, unknown>[];
  chartStats: SignalStat[];
  /** Total live points received since last reset (live counter for the UI). */
  chartPointCount: number;

  // ── Tail slice ────────────────────────────────────────────────
  tailEntries: SignalEntry[];
  /** Signals/sec averaged over the last second. */
  tailRate: number;

  // ── Tail controls ─────────────────────────────────────────────
  tailPaused: boolean;
  setTailPaused: (v: boolean | ((prev: boolean) => boolean)) => void;
  clearTail: () => void;

  /** Reset chart buffers (called automatically on vehicleId change). */
  resetChart: () => void;
}

function detectType(value: unknown): 'number' | 'string' | 'boolean' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

/**
 * Running per-signal aggregate for the chart stats slice. Stored instead of a
 * raw number[] so a long live session (2 Hz for hours) stays O(1) in memory
 * and never risks the `Math.min(...values)` spread blowing the call-stack once
 * the buffer grows past the JS argument limit. Values are identical to the
 * previous array-backed min/max/avg/count.
 */
interface ChartAgg {
  min: number;
  max: number;
  sum: number;
  count: number;
}

export function useLiveSignalStream({
  enabled,
  vehicleId,
  chartSignals,
  tailMax = DEFAULT_TAIL_MAX,
}: UseLiveSignalStreamOptions): UseLiveSignalStreamResult {
  // ── Chart buffers ────────────────────────────────────────────
  const [chartData, setChartData] = useState<Record<string, unknown>[]>([]);
  const [chartStats, setChartStats] = useState<SignalStat[]>([]);
  const chartBufferRef = useRef<Record<string, unknown>[]>([]);
  const chartAccRef = useRef<Map<string, ChartAgg>>(new Map());
  const lastFlushRef = useRef(0);
  const chartPointCountRef = useRef(0);
  const [chartPointCount, setChartPointCount] = useState(0);

  // ── Tail buffers ─────────────────────────────────────────────
  const [tailEntries, setTailEntries] = useState<SignalEntry[]>([]);
  const [tailPaused, setTailPaused] = useState(false);
  const [tailRate, setTailRate] = useState(0);
  const tailIdRef = useRef(0);
  const tailRateRef = useRef<number[]>([]);
  const tailPausedRef = useRef(false);
  tailPausedRef.current = tailPaused;

  // ── Latest props in refs (so the SSE handler stays stable) ──
  const vehicleIdRef = useRef<number | null>(vehicleId);
  vehicleIdRef.current = vehicleId;
  const chartSignalsRef = useRef<string[]>(chartSignals);
  chartSignalsRef.current = chartSignals;
  const tailMaxRef = useRef(tailMax);
  tailMaxRef.current = tailMax;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const resetChart = useCallback(() => {
    chartBufferRef.current = [];
    chartAccRef.current = new Map();
    chartPointCountRef.current = 0;
    setChartData([]);
    setChartStats([]);
    setChartPointCount(0);
  }, []);

  const clearTail = useCallback(() => {
    setTailEntries([]);
    tailIdRef.current = 0;
  }, []);

  // Reset all buffers on vehicle switch — never intermix vehicles.
  useEffect(() => {
    resetChart();
    clearTail();
    tailRateRef.current = [];
  }, [vehicleId, resetChart, clearTail]);

  // Reset chart buffers when toggling enabled off or selection changes.
  useEffect(() => {
    if (!enabled) resetChart();
  }, [enabled, chartSignals, resetChart]);

  // 1Hz rate counter for the tail.
  useEffect(() => {
    if (!enabled) {
      setTailRate(0);
      return;
    }
    const id = setInterval(() => {
      setTailRate(tailRateRef.current.reduce((a, b) => a + b, 0));
      tailRateRef.current = [];
    }, 1000);
    return () => clearInterval(id);
  }, [enabled]);

  // ── SSE handler — drives both chart and tail off one subscription ──
  const handleVehicleUpdate = useCallback((raw: unknown) => {
    if (!enabledRef.current) return;
    // A malformed SSE frame (JSON null, a bare string/number, etc.) must
    // never throw inside this shared handler — that would bubble through
    // sseManager and tear down the single subscription both slices ride on.
    if (raw === null || typeof raw !== 'object') return;
    const data = raw as {
      signals?: Record<string, unknown>;
      cold?: unknown;
      tables?: unknown;
      timestamp?: string;
      vehicle_id?: unknown;
    };

    // Vehicle-scope filter (system events without vehicle_id pass through).
    const selected = vehicleIdRef.current;
    const eventVehicleId = data?.vehicle_id;
    if (selected != null && selected > 0) {
      if (typeof eventVehicleId === 'number' && eventVehicleId !== selected) return;
      if (typeof eventVehicleId === 'string' && Number(eventVehicleId) !== selected) return;
    }

    const now = Date.now();
    const ts = data.timestamp ?? new Date().toISOString();

    // ── (a) Chart slice — selected signals only, throttled flush ──
    const sigs = chartSignalsRef.current;
    if (sigs.length > 0 && data.signals) {
      const point: Record<string, unknown> = { timestamp: ts };
      let hasValue = false;
      for (const sig of sigs) {
        const val = data.signals[sig];
        if (val !== undefined && val !== null) {
          const num = typeof val === 'number'
            ? val
            : typeof val === 'boolean'
              ? (val ? 1 : 0)
              : parseFloat(String(val));
          if (!Number.isNaN(num)) {
            point[sig] = num;
            hasValue = true;
            const agg = chartAccRef.current.get(sig);
            if (agg) {
              if (num < agg.min) agg.min = num;
              if (num > agg.max) agg.max = num;
              agg.sum += num;
              agg.count += 1;
            } else {
              chartAccRef.current.set(sig, { min: num, max: num, sum: num, count: 1 });
            }
          }
        }
      }
      if (hasValue) {
        chartBufferRef.current.push(point);
        chartPointCountRef.current++;
        const cutoff = new Date(now - LIVE_WINDOW_MS).toISOString();
        while (
          chartBufferRef.current.length > 0 &&
          (chartBufferRef.current[0].timestamp as string) < cutoff
        ) {
          chartBufferRef.current.shift();
        }
        if (now - lastFlushRef.current >= LIVE_THROTTLE_MS) {
          lastFlushRef.current = now;
          setChartData([...chartBufferRef.current]);
          setChartPointCount(chartPointCountRef.current);
          const stats: SignalStat[] = [];
          for (const [signal, agg] of chartAccRef.current) {
            if (agg.count === 0) continue;
            stats.push({
              signal,
              min: agg.min,
              max: agg.max,
              avg: agg.sum / agg.count,
              count: agg.count,
            });
          }
          setChartStats(stats);
        }
      }
    }

    // ── (b) Tail slice — full firehose, pause-aware ──────────────
    if (tailMaxRef.current === 0) return;
    if (tailPausedRef.current) return;

    const newEntries: SignalEntry[] = [];
    const cold = data?.cold;
    if (Array.isArray(cold)) {
      for (const item of cold) {
        if (item && typeof item === 'object' && 'name' in item && 'value' in item) {
          const { name, value } = item as { name: string; value: unknown };
          tailIdRef.current += 1;
          newEntries.push({ id: tailIdRef.current, timestamp: ts, name, value: String(value), type: detectType(value) });
        }
      }
    }
    const tables = data?.tables;
    if (tables && typeof tables === 'object') {
      for (const [, columns] of Object.entries(tables as Record<string, unknown>)) {
        if (columns && typeof columns === 'object') {
          for (const [colName, colValue] of Object.entries(columns as Record<string, unknown>)) {
            tailIdRef.current += 1;
            newEntries.push({ id: tailIdRef.current, timestamp: ts, name: colName, value: String(colValue), type: detectType(colValue) });
          }
        }
      }
    }
    if (!cold && !tables) {
      const signals = (data?.signals ?? data) as Record<string, unknown> | undefined;
      if (signals && typeof signals === 'object') {
        for (const [name, value] of Object.entries(signals)) {
          if (name === 'timestamp' || name === 'vehicle_id' || name === 'ts') continue;
          if (typeof value === 'object' && value !== null) continue;
          tailIdRef.current += 1;
          newEntries.push({ id: tailIdRef.current, timestamp: ts, name, value: String(value), type: detectType(value) });
        }
      }
    }
    if (newEntries.length > 0) {
      tailRateRef.current.push(newEntries.length);
      setTailEntries((prev) => [...newEntries, ...prev].slice(0, tailMaxRef.current));
    }
  }, []);

  const { connected } = useRealtimeEvents({
    enabled,
    onVehicleUpdate: handleVehicleUpdate,
  });

  return {
    connected,
    chartData,
    chartStats,
    chartPointCount,
    tailEntries,
    tailRate,
    tailPaused,
    setTailPaused,
    clearTail,
    resetChart,
  };
}
