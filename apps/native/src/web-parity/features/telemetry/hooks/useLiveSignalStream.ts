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
 *
 * Native parity port of web/src/features/telemetry/hooks/useLiveSignalStream.ts.
 *
 * Two web app-modules have no native parity surface yet (rule 4/7), so both are
 * reproduced in-file as native-safe implementations:
 *   - `useRealtimeEvents` (@/hooks/useRealtimeEvents) is a thin wrapper over a
 *     singleton browser `sseManager` (one shared EventSource fanned out to every
 *     hook instance). React Native ships no EventSource, so — exactly like
 *     api/sseClient.ts and api/hooks/useAchievementUnlocks.ts — a host-provided
 *     global EventSource polyfill is used when present and the hook degrades to
 *     an explicit "not connected" state otherwise (REALTIME_UNAVAILABLE_REASON).
 *     A module-level singleton preserves the web "only ONE SSE connection no
 *     matter how many callers" guarantee, the `vehicle_update` event name, and
 *     the `/api/v1/events` endpoint (resolved via apiUrl('/events')).
 *   - `SignalEntry` (@/types/telemetry) is inlined byte-for-byte ({id, timestamp,
 *     name, value, type}) since web/src/types/telemetry.ts is not yet ported.
 *
 * Everything else (chart buffers, throttled flush, rolling window, stats, the
 * 1 Hz tail-rate counter, cold/tables/signals tail parsing) is pure TS and is
 * ported verbatim — no DOM, Recharts, Leaflet, or web UI components are imported.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiUrl } from '../../../api/client';

/**
 * Tail entry shape, inlined from web/src/types/telemetry.ts (SignalEntry) which
 * has no native parity port yet. Kept byte-for-byte so the result contract and
 * any future consumers match the web type exactly.
 */
export interface SignalEntry {
  id: number;
  timestamp: string;
  name: string;
  value: string;
  type: 'number' | 'string' | 'boolean';
}

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

// ── Native-safe realtime SSE subscriber ─────────────────────────────
//
// Native parity for @/hooks/useRealtimeEvents (a wrapper over the singleton
// browser `sseManager`). A module-level singleton owns a single EventSource so
// every hook instance shares one connection, matching the web guarantee.

type RealtimeState = 'connected' | 'reconnecting';

type VehicleUpdateListener = (data: unknown) => void;
type RealtimeStateListener = (state: RealtimeState) => void;

type NativeEventSourceEvent = { readonly data?: unknown };
type NativeEventSourceListener = (event: NativeEventSourceEvent) => void;

interface NativeEventSource {
  addEventListener(event: string, listener: NativeEventSourceListener): void;
  removeEventListener?(
    event: string,
    listener: NativeEventSourceListener,
  ): void;
  close(): void;
}

type NativeEventSourceConstructor = new (url: string) => NativeEventSource;

const REALTIME_EVENTS_PATH = '/events';
const VEHICLE_UPDATE_EVENT = 'vehicle_update';
const CONNECTED_EVENT = 'connected';

export const REALTIME_UNAVAILABLE_REASON =
  'React Native does not provide EventSource by default; install a compatible polyfill to receive vehicle_update SSE events.';

function getEventSourceConstructor(): NativeEventSourceConstructor | null {
  const candidate = (globalThis as typeof globalThis & { EventSource?: unknown })
    .EventSource;
  return typeof candidate === 'function'
    ? (candidate as NativeEventSourceConstructor)
    : null;
}

const vehicleUpdateListeners = new Set<VehicleUpdateListener>();
const realtimeStateListeners = new Set<RealtimeStateListener>();
let realtimeSource: NativeEventSource | null = null;
let realtimeState: RealtimeState = 'reconnecting';

function setRealtimeState(next: RealtimeState): void {
  if (realtimeState === next) return;
  realtimeState = next;
  for (const listener of Array.from(realtimeStateListeners)) listener(next);
}

function handleVehicleUpdateEvent(event: NativeEventSourceEvent): void {
  const raw = event.data;
  let data: unknown = null;
  if (typeof raw === 'string') {
    if (raw.length === 0) return;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
  } else if (raw != null) {
    data = raw;
  }
  for (const listener of Array.from(vehicleUpdateListeners)) listener(data);
}

function handleRealtimeOpen(): void {
  setRealtimeState('connected');
}

function handleRealtimeError(): void {
  setRealtimeState('reconnecting');
}

function openRealtimeSource(): void {
  if (realtimeSource != null) return;
  const EventSourceCtor = getEventSourceConstructor();
  if (EventSourceCtor == null) {
    // Explicit unavailable state — no EventSource polyfill installed.
    setRealtimeState('reconnecting');
    return;
  }
  realtimeSource = new EventSourceCtor(apiUrl(REALTIME_EVENTS_PATH));
  realtimeSource.addEventListener('open', handleRealtimeOpen);
  realtimeSource.addEventListener(CONNECTED_EVENT, handleRealtimeOpen);
  realtimeSource.addEventListener(VEHICLE_UPDATE_EVENT, handleVehicleUpdateEvent);
  realtimeSource.addEventListener('error', handleRealtimeError);
}

function closeRealtimeSourceIfIdle(): void {
  if (vehicleUpdateListeners.size > 0 || realtimeStateListeners.size > 0) return;
  if (realtimeSource == null) return;
  realtimeSource.removeEventListener?.('open', handleRealtimeOpen);
  realtimeSource.removeEventListener?.(CONNECTED_EVENT, handleRealtimeOpen);
  realtimeSource.removeEventListener?.(
    VEHICLE_UPDATE_EVENT,
    handleVehicleUpdateEvent,
  );
  realtimeSource.removeEventListener?.('error', handleRealtimeError);
  realtimeSource.close();
  realtimeSource = null;
  realtimeState = 'reconnecting';
}

export interface UseRealtimeEventsOptions {
  onVehicleUpdate?: (data: unknown) => void;
  enabled?: boolean;
}

/**
 * Native-safe equivalent of @/hooks/useRealtimeEvents — exposes only the
 * `vehicle_update` channel + `connected` flag that useLiveSignalStream consumes.
 */
export function useRealtimeEvents(options: UseRealtimeEventsOptions = {}): {
  connected: boolean;
} {
  const { enabled = true } = options;
  const [state, setState] = useState<RealtimeState>(() => realtimeState);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  useEffect(() => {
    if (!enabled) return;

    const onVehicleUpdate = (data: unknown) =>
      callbacksRef.current.onVehicleUpdate?.(data);
    const onState = (next: RealtimeState) => setState(next);

    vehicleUpdateListeners.add(onVehicleUpdate);
    realtimeStateListeners.add(onState);
    openRealtimeSource();
    setState(realtimeState);

    return () => {
      vehicleUpdateListeners.delete(onVehicleUpdate);
      realtimeStateListeners.delete(onState);
      closeRealtimeSourceIfIdle();
    };
  }, [enabled]);

  return { connected: state === 'connected' };
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
  const chartAccRef = useRef<Map<string, number[]>>(new Map());
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
            const arr = chartAccRef.current.get(sig) ?? [];
            arr.push(num);
            chartAccRef.current.set(sig, arr);
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
          for (const [signal, values] of chartAccRef.current) {
            if (values.length === 0) continue;
            stats.push({
              signal,
              min: Math.min(...values),
              max: Math.max(...values),
              avg: values.reduce((a, b) => a + b, 0) / values.length,
              count: values.length,
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
