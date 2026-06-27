// Native parity port of
// web/src/features/telemetry/pages/SignalsWorkspacePage.tsx.
//
// The web module is the unified `/signals` workspace: a thin orchestrator that
// composes seven shared telemetry components (SignalCategoryTree picker,
// SignalChartPanel, SignalStatsPanel, SignalHistoryTable, LiveSignalTail,
// SignalCompareControls, SignalDiffTable) plus the useLiveSignalStream SSE hook.
// Two mutually-exclusive mode toggles (Live / Compare) drive the right column;
// toggling neither leaves a historical view. Selection / catalog / chart-mode /
// range / pagination / compare-window state are all URL-synced on web and every
// view is deep-linkable.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, default?, values?) returns the English fallback (or key) and
//     supports `{{count}}` interpolation, preserving every key at the call site.
//   • @/hooks/usePageTitle -> a native no-op (no document.title in RN).
//   • react-router-dom useNavigate -> a native no-op navigate(to) (the alert
//     hand-off target string is still composed verbatim).
//   • @/hooks/useSelectedVehicle -> an inlined hook over the ported useVehicles()
//     that defaults to the first vehicle (the web hook's final precedence tier);
//     the web's prop-less <VehicleSelect/> is threaded vehicleId/vehicles/onChange.
//   • @/hooks/useUrlState (useUrlArray/String/Number/Boolean) + useRangeState +
//     useSavedViewUrl -> in-memory useState (RN has no browser URL/search params);
//     every state name + default is preserved and still drives the same logic.
//     The permalink (window.location-based) collapses to '' so its Share button
//     never renders, exactly like the web `typeof window === 'undefined'` guard.
//   • @/api/client request + @/api/hooks (useSignals, useSignalDiffServer,
//     usePinned, useTogglePin, useVehicles) -> the already-ported native hooks;
//     every API path + query key is preserved (snake_case query params kept).
//   • @/lib/{numberFormat,errorMessage,csvExport,pLimit} -> inlined verbatim;
//     downloadCSV has no RN filesystem analog so it degrades to a documented
//     no-op (the CSV string is still built by objectsToCSV).
//   • The compare utils (CATEGORY_PREFIXES, isoOrEmpty, toLocalDatetimeInput,
//     DIFF_PRESETS) and the SignalQueryControls adaptSignalHistoryResp +
//     SignalLogEntry shape are inlined verbatim.
//   • useLiveSignalStream -> a native-safe re-implementation driven by the ported
//     sseClient.subscribeSignals typed `signal_change` channel (one subscription
//     feeds both the live chart slice + the tail). When the host ships no
//     EventSource the stream stays `connected:false` (surfaced through the
//     existing Disconnected badge) — the explicit unavailable state.
//   • The seven sibling components are inlined as native-safe local components
//     accepting the exact same props (SignalStatsPanel is imported from its
//     already-converted sibling). The shared web UI kit (PageContainer, GlassPanel,
//     StatCard, Badge, Button, Select, TabNav, HelpTooltip, VehicleSelect,
//     SavedViewMenu, CopyButton) collapses to inlined native equivalents / the
//     ported AppText + GlassPanel + RangePicker + Accordion + BulkActionsToolbar +
//     EmptyState + AlertBanner + Skeleton + FadeIn.
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {request} from '../../../api/client';
import {
  useSignals,
  useSignalDiffServer,
  type SignalDiffRow,
} from '../../../api/hooks/useTelemetry';
import {usePinned, useTogglePin} from '../../../api/hooks/usePinned';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import type {SignalHistoryResp, SignalHistoryPoint} from '../../../api/types';
import {
  subscribeSignals,
  getSignalsSSERealtimeStatus,
  type SignalEnvelope,
  type SIValue,
} from '../../../api/sseClient';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {AlertBanner} from '../../../components/feedback/AlertBanner';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {FadeIn} from '../../../components/motion/FadeIn';
import {RangePicker} from '../../../components/forms/RangePicker';
import {Accordion} from '../../../components/ui/Accordion';
import {
  BulkActionsToolbar,
  type BulkAction,
} from '../../../components/data-display/BulkActionsToolbar';
import {SignalStatsPanel} from '../components/SignalStatsPanel';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TranslationValues = Record<string, string | number | undefined>;
type TFunc = (
  key: string,
  defaultValue?: string,
  values?: TranslationValues,
) => string;

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the (interpolated) English fallback while
// preserving every key + the `{{count}}` token at the call site.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>(
    (key, defaultValue, values) => interpolate(defaultValue ?? key, values),
    [],
  );
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

// Web react-router-dom useNavigate; RN routing lives in the navigation stack, so
// the bulk "add as alert rule" hand-off composes its target string verbatim and
// hands it to a no-op (documented in the sidecar).
function useNavigate(): (to: string) => void {
  return useCallback((_to: string) => {}, []);
}

/* ─── inlined @/lib/numberFormat fmtInt ────────────────────────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber(value, decimals?) -> locale-aware fixed-decimal (non-finite -> 0,
// en-US default); fmtInt(value) = fmtNumber(value, 0).
function fmtNumber(v: unknown, decimals = 2): string {
  const d = Math.max(0, Math.min(20, Math.floor(decimals)));
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── inlined @/lib/errorMessage getErrorMessage ───────────────────────── */

function getErrorMessage(err: unknown): string {
  if (err == null) {
    return '';
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  if (typeof err === 'object' && 'message' in err) {
    const message = (err as {message: unknown}).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return String(err);
}

/* ─── inlined @/lib/csvExport objectsToCSV + downloadCSV ───────────────── */

function csvEscape(value: unknown): string {
  const str = value == null ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// web objectsToCSV: header row from the first object's keys, then one row per
// object with quote-escaping. Preserved verbatim so the diff CSV bytes match.
function objectsToCSV(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return '';
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

// web downloadCSV triggers a browser anchor download; RN has no filesystem /
// anchor analog, so this is an explicit documented no-op. The CSV string is
// still produced by objectsToCSV so a future Share sheet can consume it.
function downloadCSV(_filename: string, _csv: string): void {
  // intentionally empty — no browser download in React Native.
}

/* ─── inlined @/lib/pLimit ─────────────────────────────────────────────── */

// Bounded-concurrency runner: at most `concurrency` tasks run at once. Matches
// the web pLimit contract used to cap parallel signal-history fetches.
function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active -= 1;
    if (queue.length > 0) {
      const run = queue.shift();
      if (run) {
        run();
      }
    }
  };
  return <T,>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active += 1;
        fn().then(resolve, reject).finally(next);
      };
      if (active < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
}

/* ─── inlined SignalCompareControls utils (CATEGORY_PREFIXES, presets) ──── */

interface CategoryPrefix {
  id: string;
  labelKey: string;
  defaultLabel: string;
  matches: (name: string) => boolean;
}

const CATEGORY_PREFIXES: CategoryPrefix[] = [
  {id: 'battery', labelKey: 'signalDiff.cat.battery', defaultLabel: 'Battery', matches: n => /battery|charge|soc|range|kwh/i.test(n)},
  {id: 'drive', labelKey: 'signalDiff.cat.drive', defaultLabel: 'Drive', matches: n => /speed|odometer|gear|drive|brake|throttle|steering/i.test(n)},
  {id: 'climate', labelKey: 'signalDiff.cat.climate', defaultLabel: 'Climate', matches: n => /climate|hvac|cabin|seat|temp/i.test(n)},
  {id: 'security', labelKey: 'signalDiff.cat.security', defaultLabel: 'Security', matches: n => /lock|sentry|alarm|valet|guard/i.test(n)},
  {id: 'motor', labelKey: 'signalDiff.cat.motor', defaultLabel: 'Motor', matches: n => /motor|inverter|torque|rpm/i.test(n)},
  {id: 'tire', labelKey: 'signalDiff.cat.tire', defaultLabel: 'Tire', matches: n => /tpms|tire|pressure/i.test(n)},
  {id: 'media', labelKey: 'signalDiff.cat.media', defaultLabel: 'Media', matches: n => /media|audio|volume|playback/i.test(n)},
  {id: 'safety', labelKey: 'signalDiff.cat.safety', defaultLabel: 'Safety', matches: n => /airbag|seatbelt|fcw|aeb|safety/i.test(n)},
];

type DiffPresetId =
  | 'now-vs-1h'
  | 'now-vs-1d'
  | 'last-drive'
  | 'before-after-charge'
  | 'today-vs-yesterday';

interface DiffPreset {
  id: DiffPresetId;
  labelKey: string;
  defaultLabel: string;
  compute: () => {atA: Date; atB: Date};
}

const DIFF_PRESETS: DiffPreset[] = [
  {id: 'now-vs-1h', labelKey: 'signalDiff.preset.nowVs1h', defaultLabel: 'Now vs 1h ago', compute: () => {const n = new Date(); return {atA: new Date(n.getTime() - 3600 * 1000), atB: n};}},
  {id: 'now-vs-1d', labelKey: 'signalDiff.preset.nowVs1d', defaultLabel: 'Now vs 1 day ago', compute: () => {const n = new Date(); return {atA: new Date(n.getTime() - 86400 * 1000), atB: n};}},
  {id: 'before-after-charge', labelKey: 'signalDiff.preset.beforeAfterCharge', defaultLabel: 'Before vs after last charge', compute: () => {const n = new Date(); return {atA: new Date(n.getTime() - 4 * 3600 * 1000), atB: n};}},
  {id: 'last-drive', labelKey: 'signalDiff.preset.lastDrive', defaultLabel: 'Last drive start vs end', compute: () => {const n = new Date(); return {atA: new Date(n.getTime() - 90 * 60 * 1000), atB: new Date(n.getTime() - 5 * 60 * 1000)};}},
  {id: 'today-vs-yesterday', labelKey: 'signalDiff.preset.todayVsYesterday', defaultLabel: 'Today vs yesterday (same time)', compute: () => {const n = new Date(); return {atA: new Date(n.getTime() - 86400 * 1000), atB: n};}},
];

function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoOrEmpty(localValue: string): string {
  if (!localValue) {
    return '';
  }
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/* ─── inlined SignalQueryControls SignalLogEntry + adapter ─────────────── */

interface SignalLogEntry {
  created_at: string;
  signal: string;
  value_num?: number | null;
  value_str?: string | null;
  value_bool?: boolean | null;
}

function adaptSignalHistoryPoint(
  point: SignalHistoryPoint,
  signal: string,
): SignalLogEntry {
  const entry: SignalLogEntry = {
    created_at: point.ts,
    signal,
    value_num: null,
    value_str: null,
    value_bool: null,
  };
  switch (typeof point.value) {
    case 'number':
      entry.value_num = Number.isFinite(point.value) ? point.value : null;
      break;
    case 'boolean':
      entry.value_bool = point.value;
      break;
    case 'string':
      entry.value_str = point.value;
      break;
    default:
      break;
  }
  return entry;
}

function adaptSignalHistoryResp(
  resp: SignalHistoryResp | null | undefined,
): SignalLogEntry[] {
  if (!resp || !Array.isArray(resp.data)) {
    return [];
  }
  const signal = resp.signal ?? '';
  return resp.data.map(p => adaptSignalHistoryPoint(p, signal));
}

function formatValue(entry: SignalLogEntry): string {
  if (entry.value_num != null) {
    return String(entry.value_num);
  }
  if (entry.value_str != null) {
    return entry.value_str;
  }
  if (entry.value_bool != null) {
    return entry.value_bool ? 'true' : 'false';
  }
  return '—';
}

function valueType(row: SignalLogEntry): 'number' | 'string' | 'boolean' {
  if (row.value_num != null) {
    return 'number';
  }
  if (row.value_bool != null) {
    return 'boolean';
  }
  return 'string';
}

/* ─── inlined useLiveSignalStream (native SSE via subscribeSignals) ─────── */

interface SignalStat {
  signal: string;
  min: number;
  max: number;
  avg: number;
  count: number;
}

interface SignalEntry {
  id: number;
  timestamp: string;
  name: string;
  value: string;
  type: 'number' | 'string' | 'boolean';
}

interface UseLiveSignalStreamOptions {
  enabled: boolean;
  vehicleId: number | null;
  chartSignals: string[];
  tailMax?: number;
}

interface UseLiveSignalStreamResult {
  connected: boolean;
  chartData: Record<string, unknown>[];
  chartStats: SignalStat[];
  chartPointCount: number;
  tailEntries: SignalEntry[];
  tailRate: number;
  tailPaused: boolean;
  setTailPaused: Dispatch<SetStateAction<boolean>>;
  clearTail: () => void;
  resetChart: () => void;
}

const LIVE_WINDOW_MS = 5 * 60 * 1000;
const LIVE_THROTTLE_MS = 500;
const DEFAULT_TAIL_MAX = 500;

function siValueToNumber(v: SIValue): number | null {
  switch (v.kind) {
    case 'number':
      return Number.isFinite(v.value) ? v.value : null;
    case 'bool':
      return v.value ? 1 : 0;
    case 'string':
    case 'time': {
      const n = parseFloat(v.value);
      return Number.isNaN(n) ? null : n;
    }
    default:
      return null;
  }
}

function siValueToString(v: SIValue): string {
  switch (v.kind) {
    case 'number':
      return String(v.value);
    case 'bool':
      return v.value ? 'true' : 'false';
    case 'string':
    case 'time':
      return v.value;
    default:
      return '';
  }
}

function siKindToEntryType(v: SIValue): 'number' | 'string' | 'boolean' {
  if (v.kind === 'bool') {
    return 'boolean';
  }
  if (v.kind === 'number') {
    return 'number';
  }
  return 'string';
}

// Native re-implementation of the web SSE subscriber. The web hook consumes the
// `{signals, cold, tables}` firehose via useRealtimeEvents; the native ported
// sseClient delivers one typed `signal_change` envelope per field, so each
// envelope is treated as a single signal sample. One subscription drives both
// the throttled live chart slice (selected signals only) and the full tail.
function useLiveSignalStream({
  enabled,
  vehicleId,
  chartSignals,
  tailMax = DEFAULT_TAIL_MAX,
}: UseLiveSignalStreamOptions): UseLiveSignalStreamResult {
  const [chartData, setChartData] = useState<Record<string, unknown>[]>([]);
  const [chartStats, setChartStats] = useState<SignalStat[]>([]);
  const chartBufferRef = useRef<Record<string, unknown>[]>([]);
  const chartAccRef = useRef<Map<string, number[]>>(new Map());
  const lastFlushRef = useRef(0);
  const chartPointCountRef = useRef(0);
  const [chartPointCount, setChartPointCount] = useState(0);

  const [tailEntries, setTailEntries] = useState<SignalEntry[]>([]);
  const [tailPaused, setTailPaused] = useState(false);
  const [tailRate, setTailRate] = useState(0);
  const [connected, setConnected] = useState(false);
  const tailIdRef = useRef(0);
  const tailRateRef = useRef<number[]>([]);
  const tailPausedRef = useRef(false);
  tailPausedRef.current = tailPaused;

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

  useEffect(() => {
    resetChart();
    clearTail();
    tailRateRef.current = [];
  }, [vehicleId, resetChart, clearTail]);

  useEffect(() => {
    if (!enabled) {
      resetChart();
    }
  }, [enabled, chartSignals, resetChart]);

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

  const handleEnvelope = useCallback((env: SignalEnvelope) => {
    if (!enabledRef.current) {
      return;
    }
    const selected = vehicleIdRef.current;
    if (selected != null && selected > 0 && env.vehicle_id !== selected) {
      return;
    }
    const now = Date.now();
    const ts = env.ts || new Date().toISOString();
    const field = env.field;
    const num = siValueToNumber(env.value);

    const sigs = chartSignalsRef.current;
    if (sigs.length > 0 && sigs.includes(field) && num != null) {
      const point: Record<string, unknown> = {timestamp: ts};
      point[field] = num;
      const arr = chartAccRef.current.get(field) ?? [];
      arr.push(num);
      chartAccRef.current.set(field, arr);
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
          if (values.length === 0) {
            continue;
          }
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

    if (tailMaxRef.current === 0) {
      return;
    }
    if (tailPausedRef.current) {
      return;
    }
    tailIdRef.current += 1;
    const entry: SignalEntry = {
      id: tailIdRef.current,
      timestamp: ts,
      name: field,
      value: siValueToString(env.value),
      type: siKindToEntryType(env.value),
    };
    tailRateRef.current.push(1);
    setTailEntries(prev => [entry, ...prev].slice(0, tailMaxRef.current));
  }, []);

  useEffect(() => {
    if (!enabled || vehicleId == null || vehicleId <= 0) {
      setConnected(false);
      return;
    }
    const status = getSignalsSSERealtimeStatus();
    const unsubscribe = subscribeSignals(vehicleId, [], handleEnvelope, () =>
      setConnected(false),
    );
    setConnected(status === 'subscribed');
    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [enabled, vehicleId, handleEnvelope]);

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

/* ─── inlined page-level hooks (URL state -> in-memory) ────────────────── */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Native useSelectedVehicle: RN has no router path/query precedence or persisted
// store, so the selection lives in local state, defaulting to the first vehicle
// the moment the fleet loads (the web hook's final precedence tier).
function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const [stored, setVehicleId] = useState<number | null>(null);
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId]);
  return {vehicleId: stored ?? firstVehicleId, vehicles, setVehicleId};
}

// web useUrlArray/String/Number/Boolean persist into the querystring; RN has no
// URL so they collapse to plain useState seeded with the same defaults. State
// names and the value|updater setter contract are preserved.
function useUrlArray(_key: string): [string[], Dispatch<SetStateAction<string[]>>] {
  return useState<string[]>([]);
}

function useUrlString(
  _key: string,
  initial: string,
): [string, Dispatch<SetStateAction<string>>] {
  return useState<string>(initial);
}

function useUrlNumber(
  _key: string,
  initial: number,
): [number, Dispatch<SetStateAction<number>>] {
  return useState<number>(initial);
}

function useUrlBoolean(
  _key: string,
  initial: boolean,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  return useState<boolean>(initial);
}

interface RangeValue {
  start: string;
  end: string;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// web useRangeState persists the picked range under a key + seeds from a preset;
// RN keeps it in memory, defaulting the 'today' preset to today's date.
function useRangeState(_opts: {persistKey: string; defaultPresetId: string}): {
  start: string;
  end: string;
  setRange: (value: RangeValue, presetId?: string) => void;
} {
  const today = useMemo(() => todayIso(), []);
  const [range, setRangeState] = useState<RangeValue>({start: today, end: today});
  const setRange = useCallback((value: RangeValue, _presetId?: string) => {
    setRangeState({start: value.start, end: value.end});
  }, []);
  return {start: range.start, end: range.end, setRange};
}

// web useSavedViewUrl wires the browser querystring into <SavedViewMenu>; RN has
// no URL, so the current query is always empty and apply() is a no-op.
function useSavedViewUrl(): {currentQuery: string; apply: (query: string) => void} {
  const apply = useCallback((_query: string) => {}, []);
  return {currentQuery: '', apply};
}

/* ─── inlined @/lib/colors CHART_COLORS (CB-safe Okabe-Ito default) ─────── */

const CHART_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

function colorForIndex(idx: number): string {
  return CHART_COLORS[Math.max(0, idx) % CHART_COLORS.length];
}

/* ─── inlined shared web UI kit (native equivalents) ───────────────────── */

type BadgeVariant = 'success' | 'danger' | 'info' | 'neutral' | 'warning';

const BADGE_TINT: Record<BadgeVariant, {fg: string; bg: string; border: string}> = {
  success: {fg: colors.success, bg: colors.successSurface, border: colors.successBorder},
  danger: {fg: colors.danger, bg: colors.dangerSurface, border: colors.dangerBorder},
  info: {fg: colors.accent, bg: colors.accentSoft, border: colors.borderAccent},
  warning: {fg: colors.warning, bg: colors.warningSurface, border: colors.warningBorder},
  neutral: {fg: colors.textMuted, bg: colors.surfaceRaised, border: colors.border},
};

function Badge({
  variant = 'neutral',
  size = 'md',
  dot = false,
  children,
}: {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
  children: ReactNode;
}) {
  const tint = BADGE_TINT[variant];
  return (
    <View
      style={[
        styles.badge,
        size === 'sm' ? styles.badgeSm : null,
        {backgroundColor: tint.bg, borderColor: tint.border},
      ]}>
      {dot ? <View style={[styles.badgeDot, {backgroundColor: tint.fg}]} /> : null}
      <AppText style={[styles.badgeText, {color: tint.fg}]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

type ButtonVariant = 'primary' | 'danger' | 'outline' | 'secondary' | 'ghost';

function Button({
  variant = 'secondary',
  icon,
  loading = false,
  disabled = false,
  onPress,
  children,
}: {
  variant?: ButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const isFilled = variant === 'primary' || variant === 'danger';
  const fill =
    variant === 'primary'
      ? colors.accentSoft
      : variant === 'danger'
        ? colors.dangerSurface
        : variant === 'secondary'
          ? colors.surfaceRaised
          : 'transparent';
  const fg =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? colors.danger
        : colors.textPrimary;
  const border =
    variant === 'outline'
      ? colors.border
      : variant === 'primary'
        ? colors.borderAccent
        : variant === 'danger'
          ? colors.dangerBorder
          : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: disabled || loading}}
      disabled={disabled || loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        {backgroundColor: fill, borderColor: border},
        isFilled ? styles.buttonFilled : null,
        (disabled || loading) ? styles.buttonDisabled : null,
        pressed ? styles.buttonPressed : null,
      ]}>
      {loading ? (
        <AppText style={[styles.buttonGlyph, {color: fg}]}>…</AppText>
      ) : icon ? (
        <View style={styles.buttonIcon}>{icon}</View>
      ) : null}
      <AppText style={[styles.buttonLabel, {color: fg}]} weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

function Select({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View>
      {label ? (
        <AppText style={styles.fieldLabel} tone="muted">
          {label}
        </AppText>
      ) : null}
      <View style={styles.optionRow}>
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => onChange(opt.value)}
              style={({pressed}) => [
                styles.option,
                active ? styles.optionActive : null,
                pressed ? styles.optionPressed : null,
              ]}>
              <AppText
                numberOfLines={1}
                style={active ? styles.optionTextActive : styles.optionText}
                weight={active ? 'semibold' : 'regular'}>
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TabNav<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{key: K; label: string}>;
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <View style={styles.tabNav}>
      {tabs.map(tab => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{selected: isActive}}
            onPress={() => onChange(tab.key)}
            style={({pressed}) => [
              styles.tab,
              isActive ? styles.tabActive : null,
              pressed ? styles.optionPressed : null,
            ]}>
            <AppText
              style={isActive ? styles.tabTextActive : styles.tabText}
              weight={isActive ? 'semibold' : 'regular'}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// web <HelpTooltip> (hover/keyboard tooltip). Native collapses to a "?" chip that
// toggles an inline caption; the i18nKey + defaultValue are preserved.
function HelpTooltip({
  i18nKey,
  defaultValue,
  ariaLabel,
}: {
  i18nKey: string;
  defaultValue: string;
  ariaLabel: string;
}) {
  const {t} = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.helpWrap}>
      <Pressable
        accessibilityLabel={ariaLabel}
        accessibilityRole="button"
        onPress={() => setOpen(prev => !prev)}
        style={styles.helpChip}>
        <AppText style={styles.helpGlyph} weight="bold">
          ?
        </AppText>
      </Pressable>
      {open ? (
        <AppText style={styles.helpNote} tone="muted" variant="caption">
          {t(i18nKey, defaultValue)}
        </AppText>
      ) : null}
    </View>
  );
}

// web <StatCard label value icon>: a label, a bold value, and an optional glyph.
function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statRow}>
        <View style={styles.statBody}>
          <AppText numberOfLines={1} style={styles.statLabel} tone="muted">
            {label}
          </AppText>
          <AppText numberOfLines={1} style={styles.statValue} weight="bold">
            {value}
          </AppText>
        </View>
        {icon ? <View style={styles.statIcon}>{icon}</View> : null}
      </View>
    </View>
  );
}

// web prop-less <VehicleSelect/> shares selection via a store; RN threads the
// page-owned useSelectedVehicle slice into an option-chip select.
function VehicleSelect({
  vehicleId,
  vehicles,
  onChange,
}: {
  vehicleId: number | null;
  vehicles: Vehicle[];
  onChange: (id: number | null) => void;
}) {
  const {t} = useTranslation();
  if (vehicles.length === 0) {
    return (
      <AppText style={styles.vehiclePlaceholder} tone="muted" variant="caption">
        {t('vehicleSelect.empty', 'No vehicles')}
      </AppText>
    );
  }
  return (
    <Select
      options={vehicles.map(v => ({
        value: String(v.id),
        label: v.display_name || `Vehicle ${v.id}`,
      }))}
      value={vehicleId != null ? String(vehicleId) : ''}
      onChange={val => onChange(val ? Number(val) : null)}
    />
  );
}

// web <SavedViewMenu> serialises the page querystring into shareable saved views.
// RN has no browser URL to serialise, so the native menu surfaces an explicit
// unavailable notice on press.
function SavedViewMenu({
  route,
  currentQuery: _currentQuery,
  onApply: _onApply,
}: {
  route: string;
  currentQuery: string;
  onApply: (query: string) => void;
}) {
  const {t} = useTranslation();
  const [notice, setNotice] = useState(false);
  return (
    <View style={styles.savedViewWrap}>
      <Pressable
        accessibilityLabel={t('savedViews.menu', 'Saved views')}
        accessibilityRole="button"
        onPress={() => setNotice(prev => !prev)}
        style={({pressed}) => [styles.iconChip, pressed ? styles.buttonPressed : null]}>
        <AppText style={styles.iconChipGlyph} weight="bold">
          ☰
        </AppText>
      </Pressable>
      {notice ? (
        <AppText
          accessibilityLabel={`${route}`}
          style={styles.savedViewNotice}
          tone="muted"
          variant="caption">
          {t(
            'savedViews.unavailable',
            'Saved views require a browser URL and are unavailable in native.',
          )}
        </AppText>
      ) : null}
    </View>
  );
}

// web <CopyButton> copies text to the clipboard. RN ships no clipboard in the
// parity bundle, so the native button surfaces an explicit unavailable notice.
// Only rendered when a permalink exists, which never happens in RN (no URL).
function CopyButton({
  text: _text,
  label,
}: {
  text: string;
  label: string;
  size?: 'sm' | 'md';
}) {
  const [notice, setNotice] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={() => setNotice(prev => !prev)}
      style={({pressed}) => [styles.iconChip, pressed ? styles.buttonPressed : null]}>
      <AppText style={styles.iconChipGlyph} weight="semibold">
        {notice ? '✓' : label}
      </AppText>
    </Pressable>
  );
}

// web <PageContainer title subtitle actions> -> ScrollView with a header block.
function PageContainer({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {children}
    </ScrollView>
  );
}

// A compact native sparkline: a row of value-scaled bars. Stands in for the web
// multi-line chart series within RN constraints.
function Sparkline({values, color}: {values: number[]; color: string}) {
  const finite = values.filter(v => Number.isFinite(v));
  if (finite.length === 0) {
    return null;
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const sample = finite.slice(-40);
  return (
    <View accessibilityRole="image" style={styles.sparkline}>
      {sample.map((v, i) => {
        const h = 4 + Math.round(((v - min) / span) * 24);
        return (
          <View
            key={i}
            style={[styles.sparkBar, {height: h, backgroundColor: color}]}
          />
        );
      })}
    </View>
  );
}

/* ─── SignalCategoryTree (native) ──────────────────────────────────────── */

function SignalCategoryTree({
  vehicleId,
  selectedSignals,
  onChange,
  searchValue,
  onSearchChange,
  expandedGroupIds,
  onExpandedChange,
}: {
  vehicleId: number;
  selectedSignals: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  searchValue: string;
  onSearchChange: (next: string) => void;
  expandedGroupIds: string[];
  onExpandedChange: (next: string[]) => void;
  maxHeightClassName?: string;
}) {
  const {t} = useTranslation();
  const {data} = useSignals(vehicleId);
  const available = useMemo(() => data ?? [], [data]);

  const groups = useMemo(() => {
    const needle = searchValue.trim().toLowerCase();
    const filtered = needle
      ? available.filter(s => s.toLowerCase().includes(needle))
      : available;
    const buckets = new Map<string, string[]>();
    for (const sig of filtered) {
      const prefix = CATEGORY_PREFIXES.find(c => c.matches(sig));
      const id = prefix?.id ?? 'other';
      const arr = buckets.get(id) ?? [];
      arr.push(sig);
      buckets.set(id, arr);
    }
    const ordered: Array<{id: string; label: string; signals: string[]}> = [];
    for (const c of CATEGORY_PREFIXES) {
      const sigs = buckets.get(c.id);
      if (sigs && sigs.length > 0) {
        ordered.push({id: c.id, label: t(c.labelKey, c.defaultLabel), signals: sigs.sort()});
      }
    }
    const other = buckets.get('other');
    if (other && other.length > 0) {
      ordered.push({id: 'other', label: t('signalDiff.cat.other', 'Other'), signals: other.sort()});
    }
    return ordered;
  }, [available, searchValue, t]);

  const toggleGroup = useCallback(
    (id: string) => {
      onExpandedChange(
        expandedGroupIds.includes(id)
          ? expandedGroupIds.filter(g => g !== id)
          : [...expandedGroupIds, id],
      );
    },
    [expandedGroupIds, onExpandedChange],
  );

  const toggleSignal = useCallback(
    (name: string) => {
      onChange(prev =>
        prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name],
      );
    },
    [onChange],
  );

  return (
    <View>
      <TextInput
        accessibilityLabel={t('signals.searchCatalog', 'Search signals')}
        onChangeText={onSearchChange}
        placeholder={t('signals.searchCatalog', 'Search signals…')}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={searchValue}
      />
      {available.length === 0 ? (
        <AppText style={styles.mutedNote} tone="muted" variant="caption">
          {t('signals.catalogEmpty', 'No signals available for this vehicle yet.')}
        </AppText>
      ) : (
        <ScrollView style={styles.treeScroll}>
          {groups.map(group => {
            const expanded = expandedGroupIds.includes(group.id);
            const selectedInGroup = group.signals.filter(s =>
              selectedSignals.includes(s),
            ).length;
            return (
              <View key={group.id} style={styles.treeGroup}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{expanded}}
                  onPress={() => toggleGroup(group.id)}
                  style={styles.treeGroupHeader}>
                  <AppText style={styles.treeChevron} tone="muted">
                    {expanded ? '▾' : '▸'}
                  </AppText>
                  <AppText style={styles.treeGroupLabel} weight="semibold">
                    {group.label}
                  </AppText>
                  <Badge size="sm" variant={selectedInGroup > 0 ? 'info' : 'neutral'}>
                    {`${selectedInGroup}/${group.signals.length}`}
                  </Badge>
                </Pressable>
                {expanded
                  ? group.signals.map(sig => {
                      const selected = selectedSignals.includes(sig);
                      return (
                        <Pressable
                          key={sig}
                          accessibilityRole="checkbox"
                          accessibilityState={{checked: selected}}
                          onPress={() => toggleSignal(sig)}
                          style={({pressed}) => [
                            styles.treeLeaf,
                            selected ? styles.treeLeafSelected : null,
                            pressed ? styles.optionPressed : null,
                          ]}>
                          <AppText
                            style={[
                              styles.treeCheckbox,
                              {color: selected ? colors.accent : colors.textMuted},
                            ]}>
                            {selected ? '☑' : '☐'}
                          </AppText>
                          <AppText
                            numberOfLines={1}
                            style={styles.treeLeafLabel}
                            tone={selected ? 'primary' : 'secondary'}>
                            {sig}
                          </AppText>
                        </Pressable>
                      );
                    })
                  : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

/* ─── SignalChartPanel (native) ────────────────────────────────────────── */

type SignalChartMode = 'overlay' | 'grid' | 'auto';

function SignalChartPanel({
  selectedSignals,
  data,
  stats,
  isLive = false,
  loading = false,
  pointsLoaded,
  liveEventCount,
}: {
  selectedSignals: string[];
  data: Record<string, unknown>[];
  stats: SignalStat[];
  isLive?: boolean;
  loading?: boolean;
  pointsLoaded?: number;
  liveEventCount?: number;
  chartMode: SignalChartMode;
}) {
  const {t} = useTranslation();
  const statBySignal = useMemo(() => {
    const map = new Map<string, SignalStat>();
    for (const s of stats) {
      map.set(s.signal, s);
    }
    return map;
  }, [stats]);

  const seriesValues = useCallback(
    (sig: string): number[] => {
      const out: number[] = [];
      for (const row of data) {
        const v = row[sig];
        if (typeof v === 'number' && Number.isFinite(v)) {
          out.push(v);
        }
      }
      return out;
    },
    [data],
  );

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelHeaderTitle}>
            {isLive ? (
              <View style={[styles.livePulse, {backgroundColor: colors.danger}]} />
            ) : null}
            <AppText style={styles.sectionTitle} weight="semibold">
              {isLive
                ? t('signalChart.liveTitle', 'Live chart')
                : t('signalChart.title', 'Signal chart')}
            </AppText>
          </View>
          <AppText style={styles.panelMeta} tone="muted" variant="caption">
            {isLive
              ? t('signalChart.events', '{{count}} events', {
                  count: liveEventCount ?? 0,
                })
              : t('signalChart.points', '{{count}} points', {
                  count: pointsLoaded ?? 0,
                })}
          </AppText>
        </View>

        {loading && !isLive ? (
          <View style={styles.stackGap}>
            <Skeleton height={120} />
          </View>
        ) : selectedSignals.length === 0 ? (
          <AppText style={styles.mutedNote} tone="muted" variant="caption">
            {t('signalChart.noSignals', 'No signals selected.')}
          </AppText>
        ) : (
          <View style={styles.stackGap}>
            {selectedSignals.map((sig, idx) => {
              const color = colorForIndex(idx);
              const stat = statBySignal.get(sig);
              const values = seriesValues(sig);
              const last = values.length > 0 ? values[values.length - 1] : null;
              return (
                <View key={sig} style={styles.chartRow}>
                  <View style={styles.chartRowHead}>
                    <AppText
                      numberOfLines={1}
                      style={[styles.chartSeriesName, {color}]}
                      weight="semibold">
                      {sig}
                    </AppText>
                    <AppText style={styles.chartSeriesMeta} tone="muted" variant="caption">
                      {stat
                        ? `${fmtNumber(stat.min)} / ${fmtNumber(stat.avg)} / ${fmtNumber(stat.max)}`
                        : last != null
                          ? fmtNumber(last)
                          : '—'}
                    </AppText>
                  </View>
                  <Sparkline color={color} values={values} />
                </View>
              );
            })}
          </View>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── SignalHistoryTable (native) ──────────────────────────────────────── */

const TYPE_BADGE_VARIANT: Record<string, BadgeVariant> = {
  number: 'info',
  string: 'success',
  boolean: 'warning',
};

const TYPE_VALUE_COLOR: Record<string, string> = {
  number: '#67e8f9',
  string: '#6ee7b7',
  boolean: '#fcd34d',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US');
}

function SignalHistoryTable({
  rows,
  selectedSignals,
  page,
  pageSize,
  totalRows,
  onPageChange,
  loading = false,
  title,
}: {
  rows: SignalLogEntry[];
  selectedSignals: string[];
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: Dispatch<SetStateAction<number>>;
  loading?: boolean;
  title?: string;
}) {
  const {t} = useTranslation();
  const totalPages = Math.max(1, Math.ceil(totalRows / Math.max(1, pageSize)));
  const signalIndex = useMemo(() => {
    const map = new Map<string, number>();
    selectedSignals.forEach((s, i) => map.set(s, i));
    return map;
  }, [selectedSignals]);

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <View style={styles.panelHeader}>
          <AppText style={styles.sectionTitle} weight="semibold">
            {title ?? t('signalHistory.title', 'Signal history')}
          </AppText>
          <Badge size="sm" variant="neutral">
            {t('signalHistory.meta', 'Page {{page}} · {{total}} total', {
              page,
              total: totalRows,
            })}
          </Badge>
        </View>

        {loading ? (
          <View style={styles.stackGap}>
            {Array.from({length: 6}).map((_, i) => (
              <Skeleton key={i} height={28} />
            ))}
          </View>
        ) : rows.length === 0 ? (
          <EmptyState
            message={t('signalHistory.empty', 'No history rows for this query.')}
            title={t('signalHistory.emptyTitle', 'No data')}
          />
        ) : (
          <View>
            <View style={styles.tableHeaderRow}>
              <AppText style={[styles.cellTime, styles.tableHeadText]} tone="muted" variant="caption">
                {t('signalHistory.col.time', 'Time')}
              </AppText>
              <AppText style={[styles.cellSignal, styles.tableHeadText]} tone="muted" variant="caption">
                {t('signalHistory.col.signal', 'Signal')}
              </AppText>
              <AppText style={[styles.cellValue, styles.tableHeadText]} tone="muted" variant="caption">
                {t('signalHistory.col.value', 'Value')}
              </AppText>
              <AppText style={[styles.cellType, styles.tableHeadText]} tone="muted" variant="caption">
                {t('signalHistory.col.type', 'Type')}
              </AppText>
            </View>
            {rows.map((row, i) => {
              const type = valueType(row);
              const idx = signalIndex.get(row.signal) ?? 0;
              return (
                <View key={`${row.created_at}-${row.signal}-${i}`} style={styles.tableRow}>
                  <AppText numberOfLines={1} style={[styles.cellTime, styles.monoText]} tone="muted" variant="caption">
                    {formatTime(row.created_at)}
                  </AppText>
                  <AppText
                    numberOfLines={1}
                    style={[styles.cellSignal, styles.monoText, {color: colorForIndex(idx)}]}
                    variant="caption">
                    {row.signal}
                  </AppText>
                  <AppText
                    numberOfLines={1}
                    style={[styles.cellValue, styles.monoText, {color: TYPE_VALUE_COLOR[type]}]}
                    variant="caption">
                    {formatValue(row)}
                  </AppText>
                  <View style={styles.cellType}>
                    <Badge size="sm" variant={TYPE_BADGE_VARIANT[type]}>
                      {type}
                    </Badge>
                  </View>
                </View>
              );
            })}
            {totalPages > 1 ? (
              <View style={styles.pager}>
                <Button
                  disabled={page <= 1}
                  onPress={() => onPageChange(p => Math.max(1, p - 1))}
                  variant="outline">
                  {t('pagination.prev', 'Prev')}
                </Button>
                <AppText style={styles.pagerLabel} tone="muted" variant="caption">
                  {t('pagination.pageOf', '{{page}} / {{total}}', {
                    page,
                    total: totalPages,
                  })}
                </AppText>
                <Button
                  disabled={page >= totalPages}
                  onPress={() => onPageChange(p => Math.min(totalPages, p + 1))}
                  variant="outline">
                  {t('pagination.next', 'Next')}
                </Button>
              </View>
            ) : null}
          </View>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── LiveSignalTail (native) ──────────────────────────────────────────── */

function LiveSignalTail({
  entries,
  rate,
  paused,
  onPauseToggle,
  onClear,
  bufferMax,
  title,
}: {
  entries: SignalEntry[];
  rate: number;
  paused: boolean;
  onPauseToggle: () => void;
  onClear: () => void;
  bufferMax: number;
  title?: string;
  maxHeight?: string;
}) {
  const {t} = useTranslation();
  const uniqueSignals = useMemo(
    () => new Set(entries.map(e => e.name)).size,
    [entries],
  );
  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <View style={styles.panelHeader}>
          <AppText style={styles.sectionTitle} weight="semibold">
            {title ?? t('liveMonitor.title', 'Live tail')}
          </AppText>
          <View style={styles.tailControls}>
            <Badge variant={paused ? 'warning' : 'success'}>
              {`${fmtInt(rate)} /s`}
            </Badge>
            <Button onPress={onPauseToggle} variant="outline">
              {paused
                ? t('liveMonitor.resume', 'Resume')
                : t('liveMonitor.pause', 'Pause')}
            </Button>
            <Button onPress={onClear} variant="outline">
              {t('liveMonitor.clear', 'Clear')}
            </Button>
          </View>
        </View>

        <View style={styles.statGrid}>
          <StatCard label={t('liveMonitor.rate', 'Rate')} value={`${fmtInt(rate)} /s`} />
          <StatCard label={t('liveMonitor.buffer', 'Buffer')} value={`${fmtInt(entries.length)}/${fmtInt(bufferMax)}`} />
          <StatCard label={t('liveMonitor.unique', 'Unique')} value={fmtInt(uniqueSignals)} />
          <StatCard label={t('liveMonitor.total', 'Total')} value={fmtInt(entries.length)} />
        </View>

        {entries.length === 0 ? (
          <AppText style={styles.mutedNote} tone="muted" variant="caption">
            {t('liveMonitor.waiting', 'Waiting for live signal events…')}
          </AppText>
        ) : (
          <ScrollView style={styles.tailScroll}>
            {entries.map(entry => (
              <View key={entry.id} style={styles.tableRow}>
                <AppText numberOfLines={1} style={[styles.cellTime, styles.monoText]} tone="muted" variant="caption">
                  {formatTime(entry.timestamp)}
                </AppText>
                <AppText numberOfLines={1} style={[styles.cellSignal, styles.monoText]} variant="caption">
                  {entry.name}
                </AppText>
                <AppText
                  numberOfLines={1}
                  style={[styles.cellValue, styles.monoText, {color: TYPE_VALUE_COLOR[entry.type]}]}
                  variant="caption">
                  {entry.value}
                </AppText>
              </View>
            ))}
          </ScrollView>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── SignalCompareControls (native) ───────────────────────────────────── */

function SignalCompareControls({
  atA,
  atB,
  onChangeA,
  onChangeB,
  search,
  onSearchChange,
  category,
  onCategoryChange,
}: {
  atA: string;
  atB: string;
  onChangeA: (value: string) => void;
  onChangeB: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  category: string | null;
  onCategoryChange: (next: string | null) => void;
}) {
  const {t} = useTranslation();
  const applyPreset = useCallback(
    (id: DiffPresetId) => {
      const preset = DIFF_PRESETS.find(p => p.id === id);
      if (!preset) {
        return;
      }
      const {atA: a, atB: b} = preset.compute();
      onChangeA(toLocalDatetimeInput(a));
      onChangeB(toLocalDatetimeInput(b));
    },
    [onChangeA, onChangeB],
  );

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <View style={styles.compareWindows}>
          <View style={styles.compareWindow}>
            <View style={styles.compareLabelRow}>
              <AppText style={[styles.fieldLabel, {color: '#67e8f9'}]}>
                {t('signalDiff.windowA', 'Window A')}
              </AppText>
              <HelpTooltip
                ariaLabel={t('help.signal.snapshot.aria', 'More info about signal snapshots')}
                defaultValue="A snapshot is a point-in-time view of every signal value at a single timestamp. Falls back to signal_log within the last 30 days when the live layer doesn't have it."
                i18nKey="help.signal.snapshot"
              />
            </View>
            <TextInput
              accessibilityLabel={t('signalDiff.windowA', 'Window A')}
              onChangeText={onChangeA}
              placeholder="YYYY-MM-DDTHH:mm"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={atA}
            />
          </View>
          <View style={styles.compareWindow}>
            <View style={styles.compareLabelRow}>
              <AppText style={[styles.fieldLabel, {color: '#fcd34d'}]}>
                {t('signalDiff.windowB', 'Window B')}
              </AppText>
              <HelpTooltip
                ariaLabel={t('help.signal.diff.aria', 'More info about signal diffs')}
                defaultValue="Server-side comparison between two snapshots. Unchanged signals are omitted from the result to reduce noise."
                i18nKey="help.signal.diff"
              />
            </View>
            <TextInput
              accessibilityLabel={t('signalDiff.windowB', 'Window B')}
              onChangeText={onChangeB}
              placeholder="YYYY-MM-DDTHH:mm"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={atB}
            />
          </View>
        </View>

        <View style={styles.presetRow}>
          <AppText style={styles.fieldLabel} tone="muted">
            {t('signalDiff.presetsLabel', 'Quick presets:')}
          </AppText>
          {DIFF_PRESETS.map(p => (
            <Button key={p.id} onPress={() => applyPreset(p.id)} variant="secondary">
              {t(p.labelKey, p.defaultLabel)}
            </Button>
          ))}
        </View>

        <View style={styles.compareFilterRow}>
          <TextInput
            accessibilityLabel={t('signalDiff.filterPlaceholder', 'Filter signals…')}
            onChangeText={onSearchChange}
            placeholder={t('signalDiff.filterPlaceholder', 'Filter signals…')}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.filterInput]}
            value={search}
          />
          <View style={styles.categoryChips}>
            {CATEGORY_PREFIXES.map(c => {
              const active = category === c.id;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityState={{selected: active}}
                  onPress={() => onCategoryChange(active ? null : c.id)}
                  style={({pressed}) => [
                    styles.categoryChip,
                    active ? styles.categoryChipActive : null,
                    pressed ? styles.optionPressed : null,
                  ]}>
                  <AppText
                    style={active ? styles.categoryChipTextActive : styles.categoryChipText}
                    variant="caption">
                    {t(c.labelKey, c.defaultLabel)}
                  </AppText>
                </Pressable>
              );
            })}
            {category ? (
              <Button onPress={() => onCategoryChange(null)} variant="ghost">
                {t('signalDiff.clearCategory', 'Clear')}
              </Button>
            ) : null}
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── SignalDiffTable (native) ─────────────────────────────────────────── */

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === 'string') {
    const parsed = Number(v);
    if (Number.isFinite(parsed) && v.trim() !== '') {
      return parsed;
    }
  }
  if (typeof v === 'boolean') {
    return v ? 1 : 0;
  }
  return null;
}

function formatRaw(v: unknown): string {
  if (v == null) {
    return '—';
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? fmtNumber(v) : '—';
  }
  if (typeof v === 'boolean') {
    return v ? 'true' : 'false';
  }
  if (typeof v === 'string') {
    return v;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function deltaText(a: unknown, b: unknown): string {
  const numA = asNumber(a);
  const numB = asNumber(b);
  if (numA != null && numB != null) {
    const delta = numB - numA;
    const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
    return `${arrow} ${fmtNumber(delta)}`;
  }
  return formatRaw(a) === formatRaw(b) ? '=' : '≠';
}

function SignalDiffTable({
  rows,
  loading = false,
  filterActive = false,
  selectedSignals,
  onSelectionChange,
  pinnedSignals,
}: {
  rows: SignalDiffRow[];
  vehicleId: number;
  loading?: boolean;
  filterActive?: boolean;
  selectedSignals: string[];
  onSelectionChange: (signals: string[]) => void;
  pinnedSignals: Set<string>;
}) {
  const {t} = useTranslation();
  const toggle = useCallback(
    (name: string) => {
      onSelectionChange(
        selectedSignals.includes(name)
          ? selectedSignals.filter(s => s !== name)
          : [...selectedSignals, name],
      );
    },
    [onSelectionChange, selectedSignals],
  );

  if (loading) {
    return (
      <View style={styles.stackGap}>
        {Array.from({length: 6}).map((_, i) => (
          <Skeleton key={i} height={32} />
        ))}
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        message={
          filterActive
            ? t('signalDiff.noMatch', 'No signals match the active filter.')
            : t('signalDiff.noChanges', 'No signals changed between the two snapshots')
        }
        title={t('signalDiff.emptyTitle', 'No changes')}
      />
    );
  }

  return (
    <View>
      <View style={styles.tableHeaderRow}>
        <AppText style={[styles.cellCheck, styles.tableHeadText]} tone="muted" variant="caption">
          {' '}
        </AppText>
        <AppText style={[styles.cellSignal, styles.tableHeadText]} tone="muted" variant="caption">
          {t('signalDiff.col.signal', 'Signal')}
        </AppText>
        <AppText style={[styles.cellDiffVal, styles.tableHeadText]} tone="muted" variant="caption">
          {t('signalDiff.col.a', 'A')}
        </AppText>
        <AppText style={[styles.cellDiffVal, styles.tableHeadText]} tone="muted" variant="caption">
          {t('signalDiff.col.b', 'B')}
        </AppText>
        <AppText style={[styles.cellDelta, styles.tableHeadText]} tone="muted" variant="caption">
          {t('signalDiff.col.delta', 'Δ')}
        </AppText>
      </View>
      {rows.map(row => {
        const checked = selectedSignals.includes(row.name);
        const pinned = pinnedSignals.has(row.name);
        return (
          <Pressable
            key={row.name}
            accessibilityRole="checkbox"
            accessibilityState={{checked}}
            onPress={() => toggle(row.name)}
            style={styles.tableRow}>
            <AppText style={[styles.cellCheck, {color: checked ? colors.accent : colors.textMuted}]}>
              {checked ? '☑' : '☐'}
            </AppText>
            <View style={styles.cellSignal}>
              <AppText numberOfLines={1} style={styles.monoText} variant="caption">
                {pinned ? '★ ' : ''}
                {row.name}
              </AppText>
              {row.source_a || row.source_b ? (
                <AppText style={styles.diffSource} tone="muted" variant="caption">
                  {`${row.source_a ?? '—'} → ${row.source_b ?? '—'}`}
                </AppText>
              ) : null}
            </View>
            <AppText numberOfLines={1} style={[styles.cellDiffVal, styles.monoText]} variant="caption">
              {formatRaw(row.value_a)}
            </AppText>
            <AppText numberOfLines={1} style={[styles.cellDiffVal, styles.monoText]} variant="caption">
              {formatRaw(row.value_b)}
            </AppText>
            <AppText numberOfLines={1} style={[styles.cellDelta, styles.monoText]} tone="secondary" variant="caption">
              {deltaText(row.value_a, row.value_b)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── workspace constants (verbatim) ───────────────────────────────────── */

// Bound the parallel signal-history fetches so a "select all" can't fire one
// request per signal at the backend.
const HISTORY_FETCH_CONCURRENCY = 6;
const HISTORY_PER_SIGNAL_LIMIT_MAX = 1000;
const LIVE_TAIL_MAX = 500;

const PER_PAGE_OPTIONS: SelectOption[] = [
  {value: '25', label: '25'},
  {value: '50', label: '50'},
  {value: '100', label: '100'},
  {value: '500', label: '500'},
];

type CombinedHistoryRow = SignalLogEntry;

export default function SignalsWorkspacePage() {
  const {t} = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('signalsWorkspace.title', 'Signals'));

  // ── Vehicle context ───────────────────────────────────────────
  const {vehicleId: storeVehicleId, vehicles, setVehicleId} = useSelectedVehicle();
  const vehicleId = storeVehicleId ?? 0;

  // ── Saved views & permalink ──────────────────────────────────
  const {currentQuery, apply} = useSavedViewUrl();

  // ── Selection state (URL-synced on web; in-memory here) ──────
  const [selectedSignals, setSelectedSignals] = useUrlArray('signals');
  const {data: availableSignals, error: signalsError} = useSignals(vehicleId);

  // ── Catalog tree state ───────────────────────────────────────
  const [catalogSearch, setCatalogSearch] = useUrlString('catq', '');
  const [expandedCategories, setExpandedCategories] = useUrlArray('cats');
  const [catalogOpen, setCatalogOpen] = useUrlBoolean('catopen', false);

  // ── Chart display mode ───────────────────────────────────────
  const [chartModeRaw, setChartModeRaw] = useUrlString('chart', 'auto');
  const chartMode: SignalChartMode =
    chartModeRaw === 'overlay' || chartModeRaw === 'grid' ? chartModeRaw : 'auto';
  const setChartMode = useCallback(
    (next: SignalChartMode) => setChartModeRaw(next),
    [setChartModeRaw],
  );

  // ── Time range ───────────────────────────────────────────────
  const {start, end, setRange} = useRangeState({
    persistKey: 'signals-workspace.range',
    defaultPresetId: 'today',
  });
  const fromIso = useMemo(() => (start ? new Date(`${start}T00:00:00`).toISOString() : ''), [start]);
  const toIso = useMemo(() => (end ? new Date(`${end}T23:59:59.999`).toISOString() : ''), [end]);

  // ── Pagination ───────────────────────────────────────────────
  const [page, setPage] = useUrlNumber('page', 1);
  const [perPage, setPerPage] = useUrlNumber('size', 25);

  // ── Mode toggles (Live / Compare are mutually exclusive) ─────
  const [isLive, setIsLive] = useState(false);
  const [isCompare, setIsCompare] = useState(false);
  const toggleLive = useCallback(() => {
    setIsLive(prev => {
      const next = !prev;
      if (next) {
        setIsCompare(false);
      }
      return next;
    });
  }, []);
  const toggleCompare = useCallback(() => {
    setIsCompare(prev => {
      const next = !prev;
      if (next) {
        setIsLive(false);
      }
      return next;
    });
  }, []);

  // ── Compare-mode state ───────────────────────────────────────
  const defaultAtA = useMemo(() => toLocalDatetimeInput(new Date(Date.now() - 3600 * 1000)), []);
  const defaultAtB = useMemo(() => toLocalDatetimeInput(new Date()), []);
  const [atA, setAtA] = useUrlString('a', defaultAtA);
  const [atB, setAtB] = useUrlString('b', defaultAtB);
  const [diffSearch, setDiffSearch] = useUrlString('q', '');
  const [diffCategoryRaw, setDiffCategoryRaw] = useUrlString('cat', '');
  const diffCategory = diffCategoryRaw || null;

  const pinContext = `signal-diff:vehicle:${vehicleId}`;
  const {data: pinnedItems = []} = usePinned('widget', pinContext);
  const pinnedSignals = useMemo(() => {
    const set = new Set<string>();
    for (const p of pinnedItems) {
      if (p.item_id?.startsWith('signal:')) {
        set.add(p.item_id.slice('signal:'.length));
      }
    }
    return set;
  }, [pinnedItems]);
  const togglePin = useTogglePin('widget');

  const [diffBulkSelection, setDiffBulkSelection] = useState<string[]>([]);

  const atAIso = isoOrEmpty(atA);
  const atBIso = isoOrEmpty(atB);
  const signalsCsv = useMemo(
    () => (availableSignals && availableSignals.length > 0 ? availableSignals.join(',') : ''),
    [availableSignals],
  );
  const {data: diffResp, isLoading: diffLoading, error: diffError} = useSignalDiffServer(
    vehicleId,
    atAIso,
    atBIso,
    signalsCsv,
    {enabled: isCompare && vehicleId > 0 && Boolean(atAIso) && Boolean(atBIso)},
  );
  const diffAllRows: SignalDiffRow[] = useMemo(() => diffResp?.data ?? [], [diffResp]);
  const diffFilteredRows = useMemo(() => {
    let rows = diffAllRows;
    if (diffSearch.trim()) {
      const needle = diffSearch.trim().toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(needle));
    }
    if (diffCategory) {
      const cat = CATEGORY_PREFIXES.find(c => c.id === diffCategory);
      if (cat) {
        rows = rows.filter(r => cat.matches(r.name));
      }
    }
    return rows;
  }, [diffAllRows, diffSearch, diffCategory]);
  const diffFilterActive = diffSearch.trim().length > 0 || diffCategory != null;

  // ── Historical fetch (manual trigger via Run button) ─────────
  const [exploreKey, setExploreKey] = useState<number | null>(null);
  const canExplore = selectedSignals.length > 0 && !!start && !!end && vehicleId > 0;
  const handleRun = useCallback(() => {
    if (!canExplore) {
      return;
    }
    setPage(1);
    setExploreKey(Date.now());
  }, [canExplore, setPage]);

  const {
    data: historicalRows,
    isLoading: historicalLoading,
    isFetching: historicalFetching,
    error: historicalError,
  } = useQuery<CombinedHistoryRow[]>({
    queryKey: ['signals-workspace-history', vehicleId, exploreKey],
    queryFn: async () => {
      const limit = pLimit(HISTORY_FETCH_CONCURRENCY);
      const perSignalLimit = Math.min(perPage * 10, HISTORY_PER_SIGNAL_LIMIT_MAX);
      const results = await Promise.all(
        selectedSignals.map(sig =>
          limit(() =>
            request<SignalHistoryResp>(
              `/signals/${vehicleId}/${sig}/history?from=${fromIso}&to=${toIso}&limit=${perSignalLimit}`,
            ),
          ),
        ),
      );
      return results
        .flatMap(resp => adaptSignalHistoryResp(resp))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
    enabled: !isLive && !isCompare && exploreKey !== null,
  });

  // ── Live SSE — chart + tail share one subscription ───────────
  const live = useLiveSignalStream({
    enabled: isLive,
    vehicleId: vehicleId > 0 ? vehicleId : null,
    chartSignals: selectedSignals,
    tailMax: LIVE_TAIL_MAX,
  });

  // Wipe history when switching vehicles to avoid intermixing.
  useEffect(() => {
    setExploreKey(null);
  }, [vehicleId]);

  // ── Historical chart / stats / paginated table ──────────────
  const chartData = useMemo(() => {
    if (!historicalRows?.length) {
      return [] as Record<string, unknown>[];
    }
    const map = new Map<string, Record<string, unknown>>();
    for (const row of historicalRows) {
      let entry = map.get(row.created_at);
      if (!entry) {
        entry = {timestamp: row.created_at};
        map.set(row.created_at, entry);
      }
      entry[row.signal] =
        row.value_num ?? (row.value_bool === true ? 1 : row.value_bool === false ? 0 : null);
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.timestamp as string).getTime() - new Date(b.timestamp as string).getTime(),
    );
  }, [historicalRows]);

  const historicalStats = useMemo<SignalStat[]>(() => {
    if (!historicalRows?.length) {
      return [];
    }
    const bySignal = new Map<string, number[]>();
    for (const row of historicalRows) {
      if (row.value_num == null) {
        continue;
      }
      const arr = bySignal.get(row.signal) ?? [];
      arr.push(row.value_num);
      bySignal.set(row.signal, arr);
    }
    return Array.from(bySignal.entries()).map(([signal, values]) => ({
      signal,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      count: values.length,
    }));
  }, [historicalRows]);

  const tableRows = useMemo(() => historicalRows ?? [], [historicalRows]);
  const totalTableRows = tableRows.length;
  const paginatedRows = useMemo(() => {
    const startIdx = (page - 1) * perPage;
    return tableRows.slice(startIdx, startIdx + perPage);
  }, [tableRows, page, perPage]);

  const activeChart = isLive ? live.chartData : chartData;
  const activeStats = isLive ? live.chartStats : historicalStats;

  // ── Diff bulk actions ────────────────────────────────────────
  const diffBulkActions: BulkAction[] = useMemo(
    () => [
      {
        id: 'pin',
        label: t('signalDiff.bulk.pin', 'Pin selected'),
        onClick: async ids => {
          for (const id of ids) {
            const name = String(id);
            if (pinnedSignals.has(name)) {
              continue;
            }
            await togglePin.mutateAsync({itemId: `signal:${name}`, context: pinContext, pin: true});
          }
        },
      },
      {
        id: 'unpin',
        label: t('signalDiff.bulk.unpin', 'Unpin selected'),
        onClick: async ids => {
          for (const id of ids) {
            const name = String(id);
            if (!pinnedSignals.has(name)) {
              continue;
            }
            await togglePin.mutateAsync({itemId: `signal:${name}`, context: pinContext, pin: false});
          }
        },
      },
      {
        id: 'csv',
        label: t('signalDiff.bulk.csv', 'Copy CSV'),
        onClick: async ids => {
          const idSet = new Set(ids.map(String));
          const rowsToExport = diffFilteredRows.filter(r => idSet.has(r.name));
          const csv = objectsToCSV(
            rowsToExport.map(r => ({
              signal: r.name,
              window_a: String(r.value_a ?? ''),
              window_b: String(r.value_b ?? ''),
              source_a: String(r.source_a ?? ''),
              source_b: String(r.source_b ?? ''),
            })),
          );
          downloadCSV(`signal-diff-vehicle-${vehicleId}.csv`, csv);
        },
      },
      {
        id: 'alert',
        label: t('signalDiff.bulk.addAlert', 'Add as alert rule'),
        onClick: async ids => {
          const csv = ids.map(String).join(',');
          navigate(`/alert-studio?signals=${encodeURIComponent(csv)}&from=signal-diff`);
        },
      },
    ],
    [diffFilteredRows, navigate, pinContext, pinnedSignals, togglePin, vehicleId, t],
  );

  // ── Permalink (native has no browser URL) ────────────────────
  const permalinkUrl = '';

  const anyError = signalsError ?? historicalError ?? diffError;
  const hasHistorical = exploreKey !== null;

  return (
    <PageContainer
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect onChange={setVehicleId} vehicleId={storeVehicleId} vehicles={vehicles} />
          {isLive ? (
            <Badge dot variant={live.connected ? 'success' : 'danger'}>
              {live.connected
                ? t('liveMonitor.connected', 'Connected')
                : t('liveMonitor.disconnected', 'Disconnected')}
            </Badge>
          ) : null}
          <SavedViewMenu currentQuery={currentQuery} onApply={apply} route="/signals" />
          {permalinkUrl ? (
            <CopyButton label={t('signalsWorkspace.share', 'Share')} size="sm" text={permalinkUrl} />
          ) : null}
        </View>
      }
      subtitle={t(
        'signalsWorkspace.subtitle',
        'Browse the live catalog, inspect history, monitor live, or compare snapshots — all in one place.',
      )}
      title={t('signalsWorkspace.title', 'Signals')}>
      {anyError ? (
        <AlertBanner variant="danger">
          {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(anyError)}`}
        </AlertBanner>
      ) : null}

      {vehicleId === 0 ? (
        <EmptyState
          message={t(
            'signalsWorkspace.noVehicleDesc',
            'Pick a vehicle from the picker above to see its signals.',
          )}
          title={t('signalsWorkspace.noVehicle', 'Select a vehicle to begin')}
        />
      ) : null}

      {/* ── Headline strip ─────────────────────────────────────── */}
      <FadeIn>
        <View style={styles.metricsGrid}>
          <StatCard
            icon={<AppText style={styles.statGlyph}>⇅</AppText>}
            label={t('signalsWorkspace.selected', 'Selected')}
            value={fmtInt(selectedSignals.length)}
          />
          <StatCard
            icon={<AppText style={styles.statGlyph}>{isCompare ? '⇄' : isLive ? '◉' : '▤'}</AppText>}
            label={t('signalsWorkspace.mode', 'Mode')}
            value={
              isCompare
                ? t('signalsWorkspace.compare', 'Compare')
                : isLive
                  ? t('signalsWorkspace.live', 'Live')
                  : t('signalsWorkspace.historical', 'Historical')
            }
          />
          <StatCard
            icon={<AppText style={styles.statGlyph}>↯</AppText>}
            label={t('signalsWorkspace.liveRate', 'Live rate')}
            value={isLive ? `${fmtInt(live.tailRate)} /s` : '—'}
          />
          <StatCard
            icon={<AppText style={styles.statGlyph}>★</AppText>}
            label={t('signalsWorkspace.pinned', 'Pinned signals')}
            value={fmtInt(pinnedSignals.size)}
          />
        </View>
      </FadeIn>

      {/* ── Master / detail layout ─────────────────────────────── */}
      <View style={styles.workspaceStack}>
        {/* Catalog — collapsible "Add signals" disclosure */}
        <Accordion
          badge={
            <Badge size="sm" variant={selectedSignals.length > 0 ? 'info' : 'neutral'}>
              {selectedSignals.length > 0
                ? t('signalsWorkspace.signalsSelected', '{{count}} selected', {
                    count: selectedSignals.length,
                  })
                : t('signalsWorkspace.noneSelected', 'None selected')}
            </Badge>
          }
          icon={<AppText style={styles.statGlyph}>≡</AppText>}
          onOpenChange={setCatalogOpen}
          open={catalogOpen}
          title={t('signalsWorkspace.addSignals', 'Add signals')}>
          <SignalCategoryTree
            expandedGroupIds={expandedCategories}
            maxHeightClassName="max-h-[55vh]"
            onChange={setSelectedSignals}
            onExpandedChange={setExpandedCategories}
            onSearchChange={setCatalogSearch}
            searchValue={catalogSearch}
            selectedSignals={selectedSignals}
            vehicleId={vehicleId}
          />
        </Accordion>

        {/* Workspace toolbar — Time range / Per page / Run / Live / Compare. */}
        <GlassPanel style={styles.panel}>
          <View style={styles.toolbar}>
            <View style={styles.toolbarGroup}>
              {!isCompare ? (
                <View>
                  <AppText style={styles.fieldLabel} tone="muted">
                    {t('Time Range')}
                  </AppText>
                  <RangePicker
                    align="start"
                    onChange={setRange}
                    presetIds={['today', 'yesterday', '7d', '30d', '90d', 'all']}
                    triggerTestId="signals-workspace-range"
                    value={{start, end}}
                  />
                </View>
              ) : null}
            </View>
            <View style={styles.toolbarGroup}>
              {!isLive && !isCompare ? (
                <Select
                  label={t('Per Page')}
                  onChange={value => {
                    setPerPage(Number(value));
                    setPage(1);
                  }}
                  options={PER_PAGE_OPTIONS}
                  value={String(perPage)}
                />
              ) : null}
              {!isLive && !isCompare ? (
                <Button
                  disabled={!canExplore}
                  loading={hasHistorical && historicalFetching}
                  onPress={handleRun}
                  variant="primary">
                  {t('signalsWorkspace.run', 'Run')}
                </Button>
              ) : null}
              <Button
                disabled={selectedSignals.length === 0 && !isLive}
                onPress={toggleLive}
                variant={isLive ? 'danger' : 'outline'}>
                {isLive ? t('signalsWorkspace.stopLive', 'Stop live') : t('signalsWorkspace.live', 'Live')}
              </Button>
              <Button onPress={toggleCompare} variant={isCompare ? 'primary' : 'outline'}>
                {isCompare
                  ? t('signalsWorkspace.exitCompare', 'Exit compare')
                  : t('signalsWorkspace.compare', 'Compare')}
              </Button>
              <HelpTooltip
                ariaLabel={t('help.signal.live.aria', 'More info about live and compare modes')}
                defaultValue="Live mode streams real-time signal values via SSE. Maintains a rolling 5-minute window throttled to 2 Hz updates. Compare mode swaps in two-snapshot diff."
                i18nKey="help.signal.live"
              />
            </View>
          </View>
        </GlassPanel>

        {/* COMPARE MODE */}
        {isCompare ? (
          <>
            <SignalCompareControls
              atA={atA}
              atB={atB}
              category={diffCategory}
              onCategoryChange={next => setDiffCategoryRaw(next ?? '')}
              onChangeA={setAtA}
              onChangeB={setAtB}
              onSearchChange={setDiffSearch}
              search={diffSearch}
            />

            <FadeIn delay={0.05}>
              <View style={styles.metricsGrid}>
                <StatCard
                  label={t('signalDiff.totalChanged', 'Changed signals')}
                  value={diffLoading ? '—' : String(diffAllRows.length)}
                />
                <StatCard
                  label={t('signalDiff.visible', 'Visible after filter')}
                  value={diffLoading ? '—' : String(diffFilteredRows.length)}
                />
                <StatCard label={t('signalDiff.pinnedCount', 'Pinned')} value={String(pinnedSignals.size)} />
                <StatCard
                  label={t('signalDiff.windowSpan', 'Window span')}
                  value={
                    atAIso && atBIso
                      ? `${Math.abs(new Date(atBIso).getTime() - new Date(atAIso).getTime()) / 1000} s`
                      : '—'
                  }
                />
              </View>
            </FadeIn>

            <BulkActionsToolbar
              actions={diffBulkActions}
              onClear={() => setDiffBulkSelection([])}
              selectedIds={diffBulkSelection}
              total={diffFilteredRows.length}
            />

            <FadeIn delay={0.1}>
              <GlassPanel style={styles.panel}>
                {diffLoading && !diffResp ? (
                  <View style={styles.stackGap}>
                    {Array.from({length: 6}).map((_, i) => (
                      <Skeleton height={36} key={i} />
                    ))}
                  </View>
                ) : diffAllRows.length === 0 && !diffFilterActive && atAIso && atBIso ? (
                  <View style={styles.centerNote}>
                    <AppText tone="muted" variant="caption">
                      {t('signalDiff.noChanges', 'No signals changed between the two snapshots')}
                    </AppText>
                  </View>
                ) : (
                  <SignalDiffTable
                    filterActive={diffFilterActive}
                    loading={false}
                    onSelectionChange={setDiffBulkSelection}
                    pinnedSignals={pinnedSignals}
                    rows={diffFilteredRows}
                    selectedSignals={diffBulkSelection}
                    vehicleId={vehicleId}
                  />
                )}
                {pinnedSignals.size > 0 ? (
                  <View style={styles.pinnedFooter}>
                    <AppText tone="muted" variant="caption">
                      {t('signalDiff.pinnedLabel', 'Pinned:')}
                    </AppText>
                    {Array.from(pinnedSignals)
                      .sort()
                      .map(s => (
                        <Badge key={s} variant="neutral">
                          {s}
                        </Badge>
                      ))}
                  </View>
                ) : null}
              </GlassPanel>
            </FadeIn>
          </>
        ) : null}

        {/* LIVE / HISTORICAL — chart + stats + tail or history */}
        {!isCompare ? (
          <>
            {(hasHistorical || isLive) && selectedSignals.length > 0 ? (
              <SignalStatsPanel
                loading={historicalLoading && !isLive}
                selectedSignals={selectedSignals}
                stats={activeStats}
              />
            ) : null}

            {hasHistorical || isLive ? (
              <>
                {selectedSignals.length >= 2 ? (
                  <View style={styles.chartModeRow}>
                    <AppText style={styles.fieldLabel} tone="muted">
                      {t('signalsWorkspace.chartMode', 'Chart layout')}
                    </AppText>
                    <TabNav<SignalChartMode>
                      active={chartMode}
                      onChange={k => setChartMode(k)}
                      tabs={[
                        {key: 'auto', label: t('signalsWorkspace.chartAuto', 'Auto')},
                        {key: 'overlay', label: t('signalsWorkspace.chartOverlay', 'Overlay')},
                        {key: 'grid', label: t('signalsWorkspace.chartGrid', 'Grid')},
                      ]}
                    />
                  </View>
                ) : null}
                <SignalChartPanel
                  chartMode={chartMode}
                  data={activeChart}
                  isLive={isLive}
                  liveEventCount={live.chartPointCount}
                  loading={historicalLoading && !isLive}
                  pointsLoaded={historicalRows?.length}
                  selectedSignals={selectedSignals}
                  stats={activeStats}
                />
              </>
            ) : null}

            {isLive ? (
              <LiveSignalTail
                bufferMax={LIVE_TAIL_MAX}
                entries={live.tailEntries}
                maxHeight="55vh"
                onClear={live.clearTail}
                onPauseToggle={() => live.setTailPaused(p => !p)}
                paused={live.tailPaused}
                rate={live.tailRate}
                title={t('liveMonitor.title', 'Live tail')}
              />
            ) : hasHistorical ? (
              <SignalHistoryTable
                loading={historicalLoading}
                onPageChange={setPage}
                page={page}
                pageSize={perPage}
                rows={paginatedRows}
                selectedSignals={selectedSignals}
                title={t('signalsWorkspace.historyTitle', 'Signal history')}
                totalRows={totalTableRows}
              />
            ) : (
              <FadeIn>
                <GlassPanel style={styles.panel}>
                  <EmptyState
                    message={t(
                      'signalsWorkspace.emptyDesc',
                      'Pick signals from the catalog, choose a time range, then click Run for historical data — or toggle Live to stream in real time.',
                    )}
                    title={t('signalsWorkspace.emptyTitle', 'Pick signals and run a query')}
                  />
                </GlassPanel>
              </FadeIn>
            )}
          </>
        ) : null}

        {/* Helper footer for catalog refresh tip */}
        <AppText style={styles.footerTip} tone="muted" variant="caption">
          {`↻ ${t('signalGap.refreshInterval', 'Catalog refreshes every 5s')}`}
        </AppText>
      </View>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pageHeaderText: {
    flex: 1,
    minWidth: 200,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
  },
  pageSubtitle: {
    marginTop: 4,
  },
  pageActions: {
    alignItems: 'flex-start',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  workspaceStack: {
    gap: spacing.lg,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  panelHeaderTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  panelMeta: {},
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  stackGap: {
    gap: spacing.sm,
  },
  mutedNote: {
    paddingVertical: spacing.md,
  },
  centerNote: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  footerTip: {
    textAlign: 'right',
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeDot: {
    borderRadius: 9999,
    height: 6,
    width: 6,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
  },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonFilled: {
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonGlyph: {
    fontSize: 13,
  },
  buttonIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 13,
    lineHeight: 16,
  },
  fieldLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  option: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  optionActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  optionPressed: {
    opacity: 0.7,
  },
  optionText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  optionTextActive: {
    color: colors.accent,
    fontSize: 12,
  },
  tabNav: {
    flexDirection: 'row',
    gap: 4,
  },
  tab: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tabActive: {
    backgroundColor: colors.accentSoft,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  tabTextActive: {
    color: colors.accent,
    fontSize: 12,
  },
  helpWrap: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  helpChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 9999,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  helpGlyph: {
    color: colors.textMuted,
    fontSize: 11,
  },
  helpNote: {
    flex: 1,
    maxWidth: 240,
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    padding: spacing.md,
  },
  statRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statBody: {
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    letterSpacing: 0.4,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 20,
    marginTop: 2,
  },
  statIcon: {
    marginLeft: spacing.sm,
  },
  statGlyph: {
    color: colors.accent,
    fontSize: 16,
  },
  vehiclePlaceholder: {},
  savedViewWrap: {
    alignItems: 'flex-end',
  },
  iconChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minWidth: 32,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  iconChipGlyph: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  savedViewNotice: {
    marginTop: 4,
    maxWidth: 220,
  },
  sparkline: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 2,
    height: 28,
  },
  sparkBar: {
    borderRadius: 1,
    width: 3,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  filterInput: {
    flexGrow: 1,
    maxWidth: 320,
  },
  treeScroll: {
    marginTop: spacing.sm,
    maxHeight: 360,
  },
  treeGroup: {
    marginBottom: spacing.sm,
  },
  treeGroupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  treeChevron: {
    fontSize: 12,
    width: 14,
  },
  treeGroupLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 13,
  },
  treeLeaf: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  treeLeafSelected: {
    backgroundColor: colors.accentSoft,
  },
  treeCheckbox: {
    fontSize: 14,
  },
  treeLeafLabel: {
    flex: 1,
    fontSize: 12,
  },
  livePulse: {
    borderRadius: 9999,
    height: 8,
    width: 8,
  },
  chartRow: {
    borderColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingTop: spacing.sm,
  },
  chartRowHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chartSeriesName: {
    flex: 1,
    fontSize: 12,
  },
  chartSeriesMeta: {
    marginLeft: spacing.sm,
  },
  tableHeaderRow: {
    borderColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: 6,
  },
  tableHeadText: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tableRow: {
    alignItems: 'center',
    borderColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  monoText: {
    fontSize: 11,
  },
  cellTime: {
    flex: 2,
  },
  cellSignal: {
    flex: 3,
  },
  cellValue: {
    flex: 2,
  },
  cellType: {
    alignItems: 'flex-start',
    width: 72,
  },
  cellCheck: {
    fontSize: 14,
    width: 22,
  },
  cellDiffVal: {
    flex: 2,
  },
  cellDelta: {
    flex: 1,
  },
  diffSource: {
    marginTop: 2,
  },
  pager: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    paddingTop: spacing.md,
  },
  pagerLabel: {},
  tailControls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tailScroll: {
    maxHeight: 360,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  toolbarGroup: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chartModeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  pinnedFooter: {
    alignItems: 'center',
    borderColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  compareWindows: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  compareWindow: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  compareLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  presetRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  compareFilterRow: {
    borderColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  categoryChips: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  categoryChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryChipActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: 'rgba(99, 102, 241, 0.4)',
  },
  categoryChipText: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  categoryChipTextActive: {
    color: '#a5b4fc',
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
