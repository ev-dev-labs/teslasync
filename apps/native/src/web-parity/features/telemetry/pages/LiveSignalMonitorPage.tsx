// Native parity port of
// web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx.
//
// The web page is a thin wrapper that wires the shared `useLiveSignalStream`
// hook (SSE firehose -> tail buffer + rate + pause/clear controls) into the
// shared `LiveSignalTail` table, with a `VehicleSelect` scope picker + a
// connection `Badge` in the PageContainer `actions` slot. Neither the hook nor
// the tail component has been ported to native parity yet, so — following the
// self-contained-page precedent (VampireDrainPage / ChargingHeatmapPage) — both
// are reproduced here as native-safe local implementations that preserve every
// web behaviour, state name, API path, unit-handling rule and i18n key.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - `@/components/layout` PageContainer (title/subtitle/actions/children) has
//     no native parity component, so a local ScrollView scaffold reproduces the
//     header (title + subtitle) + the right-aligned `actions` row.
//   - `@/components/ui` Badge (with `dot`) -> the ported native StatusPill
//     (dot + label); success -> 'online', danger -> 'offline'. The verbatim
//     Connected/Disconnected i18n copy is preserved.
//   - `@/components/forms` VehicleSelect (a `<Select>` bound to the global
//     `useSelectedVehicle` store) -> a local NativeSelect bound to the ported
//     `useVehicles()` + a local `useSelectedVehicle` shim (first-vehicle default,
//     web parity: renders for fleets of >=1, hidden only when the fleet is
//     empty). The web router/store URL-precedence is browser-only and dropped.
//   - `../hooks/useLiveSignalStream` (SSE via the browser-only `sseManager`/
//     `EventSource`) -> an inlined faithful port whose transport is the sanctioned
//     native EventSource-polyfill probe (the sseClient / useAchievementUnlocks
//     precedent). When the host provides no EventSource polyfill the hook reports
//     an explicit `unavailableReason`, `connected` stays false and no events are
//     buffered (the page then renders Disconnected + the Waiting empty state with
//     a muted unavailable note) instead of pretending realtime is live.
//   - `../components/LiveSignalTail` (a DOM DataTable + Input + Buttons) -> an
//     inlined native LiveSignalTail (TextInput filter, pause/auto-scroll/clear
//     control chips, four StatCards, and a bounded inner-ScrollView row list with
//     Time/Signal/Value/Type/Freshness columns + Waiting/No-match empty states).
//     The web DataTable client pagination (pageSize 50) collapses to a single
//     scrolling list capped by the tail buffer; the web `maxHeight: '65vh'`
//     (viewport units) becomes a native numeric max height.
//   - `@/components/data-display` StatCard / FreshnessIndicator -> the ported
//     native StatCard + an inlined FreshnessIndicator (colour dot + relative-age
//     label, same 120s/600s thresholds; the web per-row 10s tick interval is
//     dropped since the tail re-renders on every streamed entry).
//   - `@/components/motion` FadeIn -> a reduced-motion-aware inlined FadeIn.
//   - `@/lib/dateFormat` formatTime -> an inlined HH:MM formatter (toLocaleTime,
//     '\u2014' for null/invalid) mirroring the web default branch.
//   - `@/lib/cn` (clsx + tailwind-merge) is dropped; class merging becomes
//     StyleSheet style arrays.
//   - react-i18next `useTranslation` -> a local t(key, default?, vars?) shim
//     mirroring i18next's flexible signature; every web key + English copy is
//     preserved verbatim (the default IS the visible string).
//   - `@/hooks/usePageTitle` (document.title) -> a native no-op shim.
//   - lucide-react icons (Radio/Activity/Pause/Play/ArrowDown/ArrowUpDown/Trash2)
//     are decorative; rendered as Unicode glyphs in AppText (the established
//     MQTTStatusWidget / VehicleHero glyph convention).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {StatusPill} from '../../../../components/ui/StatusPill';
import {colors, spacing} from '../../../../theme/tokens';
import {apiUrl} from '../../../api/client';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {StatCard} from '../../../components/data-display/StatCard';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── Tail buffer cap (web `const TAIL_MAX = 500`) ─────────────────────────── */

const TAIL_MAX = 500;

/* ─── Types (web `@/types/telemetry` SignalEntry / hook SignalStat) ─────────── */

type SignalValueType = 'number' | 'string' | 'boolean';

export interface SignalEntry {
  id: number;
  timestamp: string;
  name: string;
  value: string;
  type: SignalValueType;
}

export interface SignalStat {
  signal: string;
  min: number;
  max: number;
  avg: number;
  count: number;
}

/* ─── i18n shim (web `react-i18next` is unavailable in native parity) ──────── */

type TranslationVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  defaultValueOrVars?: string | TranslationVars,
  maybeVars?: TranslationVars,
) => string;

function interpolate(template: string, vars?: TranslationVars): string {
  if (vars == null) {
    return template;
  }
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}

// Mirrors i18next's flexible signature: t('k', 'Default') returns the default
// (which IS the visible English copy), and either form interpolates {{vars}}.
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (
      key: string,
      defaultValueOrVars?: string | TranslationVars,
      maybeVars?: TranslationVars,
    ) => {
      if (typeof defaultValueOrVars === 'string') {
        return interpolate(defaultValueOrVars, maybeVars);
      }
      return interpolate(key, defaultValueOrVars);
    },
    [],
  );
}

/* ─── usePageTitle (web sets document.title; native has no document) ───────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── native-safe time formatting (web `@/lib/dateFormat` formatTime) ──────── */

const EM_DASH = '\u2014';

// web `formatTime` default branch -> a short HH:MM clock tick.
function formatTime(iso: string | null | undefined): string {
  if (!iso) {
    return EM_DASH;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return EM_DASH;
  }
  return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

/* ─── FreshnessIndicator (web `@/components/data-display`) ──────────────────── */

type FreshnessStatus = 'fresh' | 'stale' | 'offline' | 'unknown';

function computeAge(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }
  const ms = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(ms)) {
    return null;
  }
  return Math.max(0, Math.floor(ms / 1000));
}

function freshnessStatus(
  age: number | null,
  staleThreshold: number,
  offlineThreshold: number,
): FreshnessStatus {
  if (age === null) {
    return 'unknown';
  }
  if (age < staleThreshold) {
    return 'fresh';
  }
  if (age < offlineThreshold) {
    return 'stale';
  }
  return 'offline';
}

function formatAge(age: number | null): string {
  if (age === null) {
    return EM_DASH;
  }
  if (age < 10) {
    return 'just now';
  }
  if (age < 60) {
    return `${age}s ago`;
  }
  if (age < 3600) {
    return `${Math.floor(age / 60)}m ago`;
  }
  return `${Math.floor(age / 3600)}h ago`;
}

function FreshnessIndicator({timestamp}: {timestamp: string | null | undefined}) {
  // The web component re-renders every 10s to keep the relative label fresh;
  // the tail re-renders on every streamed entry, so the age is computed at
  // render time here without a per-row interval (avoids open handles).
  const age = computeAge(timestamp);
  const status = freshnessStatus(age, 120, 600);
  const label = formatAge(age);

  return (
    <View style={styles.freshnessRow}>
      <View style={[styles.freshnessDot, freshnessDotStyles[status]]} />
      <AppText style={styles.freshnessLabel} tone="muted">
        {label}
      </AppText>
    </View>
  );
}

FreshnessIndicator.displayName = 'FreshnessIndicator';

/* ─── FadeIn (web `@/components/motion` FadeIn) ─────────────────────────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      duration: 320,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {translateY: progress.interpolate({inputRange: [0, 1], outputRange: [8, 0]})},
    ],
  };

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

FadeIn.displayName = 'FadeIn';

/* ─── PulseView (web Tailwind `animate-pulse`, optional title glyph) ────────── */

function PulseView({children}: {children: ReactNode}) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 0.4,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);

  return <Animated.View style={{opacity: pulse}}>{children}</Animated.View>;
}

PulseView.displayName = 'PulseView';

/* ─── TypeBadge (web `<Badge variant=info|warning|success size=sm>`) ────────── */

function TypeBadge({type}: {type: SignalValueType}) {
  const variant = type === 'number' ? 'info' : type === 'boolean' ? 'warning' : 'success';
  return (
    <View style={[styles.typeBadge, typeBadgeStyles[variant]]}>
      <AppText
        style={[styles.typeBadgeText, {color: typeBadgeTextColor[variant]}]}
        variant="caption"
        weight="semibold">
        {type}
      </AppText>
    </View>
  );
}

TypeBadge.displayName = 'TypeBadge';

/* ─── NativeSelect + useSelectedVehicle + VehicleSelect ─────────────────────── */

interface SelectOption {
  value: string;
  label: string;
}

function NativeSelect({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  accessibilityLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <View style={styles.select}>
      <Pressable
        accessibilityHint="Opens the option list"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}>
        <AppText numberOfLines={1} style={styles.selectValue}>
          {selected ? selected.label : EM_DASH}
        </AppText>
        <AppText style={styles.selectChevron} tone="muted">
          {open ? '\u25B4' : '\u25BE'}
        </AppText>
      </Pressable>
      {open ? (
        <View style={styles.selectList}>
          {options.map(option => {
            const isSelected = option.value === value;
            return (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="button"
                accessibilityState={{selected: isSelected}}
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({pressed}) => [
                  styles.selectOption,
                  isSelected && styles.selectOptionSelected,
                  pressed && styles.pressed,
                ]}>
                <AppText numberOfLines={1} tone={isSelected ? 'accent' : 'primary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

NativeSelect.displayName = 'NativeSelect';

interface SelectedVehicleState {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Native-safe replacement for the web `useSelectedVehicle`: the list comes from
// the ported `useVehicles()` and the selection is local state seeded to the
// first vehicle the moment the fleet loads (the web hook's final fallback).
function useSelectedVehicle(): SelectedVehicleState {
  const {data: vehicles = []} = useVehicles();
  const [internalId, setInternalId] = useState<number | null>(null);

  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (internalId == null && firstVehicleId != null) {
      setInternalId(firstVehicleId);
    }
  }, [internalId, firstVehicleId]);

  const vehicleId = internalId ?? firstVehicleId;
  return {vehicleId, vehicles, setVehicleId: setInternalId};
}

// web `VehicleSelect`: renders nothing when the fleet is empty, otherwise a
// scope picker bound to the selected-vehicle state (shown even for one car).
function VehicleSelect({
  t,
  vehicleId,
  vehicles,
  setVehicleId,
}: {
  t: NativeTFunction;
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}) {
  if (vehicles.length === 0) {
    return null;
  }
  const options: SelectOption[] = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));
  return (
    <NativeSelect
      accessibilityLabel={t('vehicleSelect.aria', 'Select vehicle')}
      onChange={value => {
        const next = Number(value);
        setVehicleId(Number.isFinite(next) && next > 0 ? next : null);
      }}
      options={options}
      value={vehicleId != null ? String(vehicleId) : ''}
    />
  );
}

VehicleSelect.displayName = 'VehicleSelect';

/* ─── native-safe SSE transport (web `sseManager` / browser EventSource) ───── */

const SSE_EVENTS_PATH = '/events';
const VEHICLE_UPDATE_EVENT = 'vehicle_update';
export const LIVE_SIGNAL_STREAM_UNAVAILABLE_REASON =
  'React Native does not provide EventSource by default; install a compatible polyfill to receive live vehicle signal events.';

type NativeEventSourceEvent = {readonly data?: unknown};
type NativeEventSourceListener = (event: NativeEventSourceEvent) => void;

interface NativeEventSource {
  addEventListener(event: string, listener: NativeEventSourceListener): void;
  removeEventListener?(event: string, listener: NativeEventSourceListener): void;
  close(): void;
}

type NativeEventSourceConstructor = new (url: string) => NativeEventSource;

function getEventSourceConstructor(): NativeEventSourceConstructor | null {
  const candidate = (globalThis as typeof globalThis & {EventSource?: unknown})
    .EventSource;
  return typeof candidate === 'function'
    ? (candidate as NativeEventSourceConstructor)
    : null;
}

/* ─── useLiveSignalStream (faithful port of the web hook) ───────────────────── */

const LIVE_WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window for live chart
const LIVE_THROTTLE_MS = 500; // 2 Hz chart updates
const DEFAULT_TAIL_MAX = 500;

export interface UseLiveSignalStreamOptions {
  enabled: boolean;
  vehicleId: number | null;
  chartSignals: string[];
  tailMax?: number;
}

export interface UseLiveSignalStreamResult {
  connected: boolean;
  /** Set when the host provides no EventSource polyfill (native-only). */
  unavailableReason: string | null;
  chartData: Record<string, unknown>[];
  chartStats: SignalStat[];
  chartPointCount: number;
  tailEntries: SignalEntry[];
  tailRate: number;
  tailPaused: boolean;
  setTailPaused: (v: boolean | ((prev: boolean) => boolean)) => void;
  clearTail: () => void;
  resetChart: () => void;
}

function detectType(value: unknown): SignalValueType {
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  return 'string';
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

  // ── Connection state ─────────────────────────────────────────
  const [connected, setConnected] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

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
    if (!enabled) {
      resetChart();
    }
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
    if (!enabledRef.current) {
      return;
    }
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
      if (typeof eventVehicleId === 'number' && eventVehicleId !== selected) {
        return;
      }
      if (typeof eventVehicleId === 'string' && Number(eventVehicleId) !== selected) {
        return;
      }
    }

    const now = Date.now();
    const ts = data.timestamp ?? new Date().toISOString();

    // ── (a) Chart slice — selected signals only, throttled flush ──
    const sigs = chartSignalsRef.current;
    if (sigs.length > 0 && data.signals) {
      const point: Record<string, unknown> = {timestamp: ts};
      let hasValue = false;
      for (const sig of sigs) {
        const val = data.signals[sig];
        if (val !== undefined && val !== null) {
          const num =
            typeof val === 'number'
              ? val
              : typeof val === 'boolean'
              ? val
                ? 1
                : 0
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
    }

    // ── (b) Tail slice — full firehose, pause-aware ──────────────
    if (tailMaxRef.current === 0) {
      return;
    }
    if (tailPausedRef.current) {
      return;
    }

    const newEntries: SignalEntry[] = [];
    const cold = data?.cold;
    if (Array.isArray(cold)) {
      for (const item of cold) {
        if (item && typeof item === 'object' && 'name' in item && 'value' in item) {
          const {name, value} = item as {name: string; value: unknown};
          tailIdRef.current += 1;
          newEntries.push({
            id: tailIdRef.current,
            timestamp: ts,
            name,
            value: String(value),
            type: detectType(value),
          });
        }
      }
    }
    const tables = data?.tables;
    if (tables && typeof tables === 'object') {
      for (const [, columns] of Object.entries(tables as Record<string, unknown>)) {
        if (columns && typeof columns === 'object') {
          for (const [colName, colValue] of Object.entries(
            columns as Record<string, unknown>,
          )) {
            tailIdRef.current += 1;
            newEntries.push({
              id: tailIdRef.current,
              timestamp: ts,
              name: colName,
              value: String(colValue),
              type: detectType(colValue),
            });
          }
        }
      }
    }
    if (!cold && !tables) {
      const signals = (data?.signals ?? data) as Record<string, unknown> | undefined;
      if (signals && typeof signals === 'object') {
        for (const [name, value] of Object.entries(signals)) {
          if (name === 'timestamp' || name === 'vehicle_id' || name === 'ts') {
            continue;
          }
          if (typeof value === 'object' && value !== null) {
            continue;
          }
          tailIdRef.current += 1;
          newEntries.push({
            id: tailIdRef.current,
            timestamp: ts,
            name,
            value: String(value),
            type: detectType(value),
          });
        }
      }
    }
    if (newEntries.length > 0) {
      tailRateRef.current.push(newEntries.length);
      setTailEntries(prev => [...newEntries, ...prev].slice(0, tailMaxRef.current));
    }
  }, []);

  // ── Native-safe SSE subscription (replaces the web sseManager singleton) ──
  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    const EventSourceCtor = getEventSourceConstructor();
    if (EventSourceCtor == null) {
      setUnavailableReason(LIVE_SIGNAL_STREAM_UNAVAILABLE_REASON);
      setConnected(false);
      return;
    }
    setUnavailableReason(null);
    const source = new EventSourceCtor(apiUrl(SSE_EVENTS_PATH));

    const onUpdate = (event: NativeEventSourceEvent) => {
      const data = typeof event.data === 'string' ? event.data : String(event.data ?? '');
      try {
        handleVehicleUpdate(data ? JSON.parse(data) : null);
      } catch {
        // Malformed payloads are ignored (the web sseManager swallows parse errors).
      }
    };
    const onOpen = () => setConnected(true);
    const onError = () => setConnected(false);

    source.addEventListener(VEHICLE_UPDATE_EVENT, onUpdate);
    source.addEventListener('open', onOpen);
    source.addEventListener('error', onError);

    return () => {
      source.removeEventListener?.(VEHICLE_UPDATE_EVENT, onUpdate);
      source.removeEventListener?.('open', onOpen);
      source.removeEventListener?.('error', onError);
      source.close();
      setConnected(false);
    };
  }, [enabled, handleVehicleUpdate]);

  return {
    connected,
    unavailableReason,
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

/* ─── control chip (web `@/components/ui` Button, sm) ───────────────────────── */

function ControlButton({
  label,
  glyph,
  onPress,
  tone = 'secondary',
  active = false,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  tone?: 'secondary' | 'danger';
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      onPress={onPress}
      style={({pressed}) => [
        styles.control,
        tone === 'danger' ? styles.controlDanger : styles.controlSecondary,
        active && styles.controlActive,
        pressed && styles.pressed,
      ]}>
      <AppText
        style={[
          styles.controlText,
          tone === 'danger' && styles.controlTextDanger,
          active && styles.controlTextActive,
        ]}
        variant="caption"
        weight="semibold">
        {`${glyph} ${label}`}
      </AppText>
    </Pressable>
  );
}

ControlButton.displayName = 'ControlButton';

/* ─── value-text colours (web TYPE_VALUE_COLOR) ─────────────────────────────── */

const GLYPH_ACTIVITY = '\u223F'; // sine wave (lucide Activity)
const GLYPH_RADIO = '\u25C9'; // dot-in-ring (lucide Radio)
const GLYPH_PAUSE = '\u23F8'; // (lucide Pause)
const GLYPH_PLAY = '\u25B6'; // (lucide Play)
const GLYPH_ARROW_DOWN = '\u2193'; // (lucide ArrowDown)
const GLYPH_TRASH = '\u2717'; // (lucide Trash2)

const DEFAULT_TAIL_HEIGHT = 460; // web `maxHeight: '65vh'` -> native numeric cap.

/* ─── LiveSignalTail (web `../components/LiveSignalTail`) ───────────────────── */

export interface LiveSignalTailProps {
  entries: SignalEntry[];
  rate: number;
  paused: boolean;
  onPauseToggle: () => void;
  onClear: () => void;
  bufferMax: number;
  showStats?: boolean;
  title?: string;
  headerExtra?: ReactNode;
  /** Max height for the scrolling row list (web default '65vh'). */
  maxHeight?: number;
  /** Native-only: muted note shown when realtime is unavailable. */
  realtimeNote?: string | null;
  t: NativeTFunction;
}

export function LiveSignalTail({
  entries,
  rate,
  paused,
  onPauseToggle,
  onClear,
  bufferMax,
  showStats = true,
  title,
  headerExtra,
  maxHeight = DEFAULT_TAIL_HEIGHT,
  realtimeNote,
  t,
}: LiveSignalTailProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const filtered = useMemo(
    () =>
      filter
        ? entries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()))
        : entries,
    [entries, filter],
  );

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTo({y: 0, animated: false});
    }
  }, [entries, autoScroll]);

  const uniqueSignals = useMemo(
    () => new Set(entries.map(e => e.name)).size,
    [entries],
  );

  return (
    <FadeIn>
      <GlassPanel padding="md" style={styles.tailPanel}>
        <View style={styles.tailHeader}>
          {title ? (
            <View style={styles.titleRow}>
              <PulseView>
                <AppText style={styles.titleGlyph}>{GLYPH_RADIO}</AppText>
              </PulseView>
              <AppText style={styles.sectionTitle} weight="semibold">
                {title}
              </AppText>
            </View>
          ) : null}
          <TextInput
            accessibilityLabel={t('liveMonitor.filterLabel', 'Filter signals')}
            onChangeText={setFilter}
            placeholder={t('liveMonitor.filterPlaceholder', 'Filter by signal name...')}
            placeholderTextColor={colors.textMuted}
            style={styles.filterInput}
            value={filter}
          />
          <View style={styles.controlsRow}>
            {headerExtra}
            <ControlButton
              glyph={paused ? GLYPH_PLAY : GLYPH_PAUSE}
              label={paused ? t('liveMonitor.resume', 'Resume') : t('liveMonitor.pause', 'Pause')}
              onPress={onPauseToggle}
            />
            <ControlButton
              active={autoScroll}
              glyph={GLYPH_ARROW_DOWN}
              label={t('liveMonitor.autoScroll', 'Auto-scroll')}
              onPress={() => setAutoScroll(a => !a)}
            />
            <ControlButton
              glyph={GLYPH_TRASH}
              label={t('liveMonitor.clear', 'Clear')}
              onPress={onClear}
              tone="danger"
            />
          </View>
        </View>

        {showStats ? (
          <View style={styles.statsGrid}>
            <View style={styles.statCell}>
              <StatCard
                icon={<AppText style={styles.statGlyph}>{GLYPH_ACTIVITY}</AppText>}
                label={t('liveMonitor.sigPerSec', 'Signals / sec')}
                value={rate}
              />
            </View>
            <View style={styles.statCell}>
              <StatCard
                icon={<AppText style={styles.statGlyph}>{'\u21C5'}</AppText>}
                label={t('liveMonitor.bufferSize', 'Buffer Size')}
                unit={`/ ${bufferMax}`}
                value={entries.length}
              />
            </View>
            <View style={styles.statCell}>
              <StatCard
                icon={<AppText style={styles.statGlyph}>{GLYPH_ACTIVITY}</AppText>}
                label={t('liveMonitor.uniqueSignals', 'Unique Signals')}
                value={uniqueSignals}
              />
            </View>
            <View style={styles.statCell}>
              <StatCard
                icon={<AppText style={styles.statGlyph}>{GLYPH_ACTIVITY}</AppText>}
                label={t('liveMonitor.filtered', 'Filtered')}
                value={filtered.length}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.tableShell}>
          <View style={styles.tableHeaderRow}>
            <AppText style={[styles.colTime, styles.headerCell]} tone="muted" variant="caption">
              {t('liveMonitor.time', 'Time')}
            </AppText>
            <AppText style={[styles.colSignal, styles.headerCell]} tone="muted" variant="caption">
              {t('liveMonitor.signal', 'Signal')}
            </AppText>
            <AppText style={[styles.colValue, styles.headerCell]} tone="muted" variant="caption">
              {t('liveMonitor.value', 'Value')}
            </AppText>
            <AppText style={[styles.colType, styles.headerCell]} tone="muted" variant="caption">
              {t('liveMonitor.type', 'Type')}
            </AppText>
            <AppText style={[styles.colFreshness, styles.headerCell]} tone="muted" variant="caption">
              {t('liveMonitor.freshness', 'Freshness')}
            </AppText>
          </View>

          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <AppText tone="muted">
                {entries.length === 0
                  ? t('liveMonitor.waiting', 'Waiting for signals\u2026')
                  : t('liveMonitor.noMatch', 'No signals match filter')}
              </AppText>
              {realtimeNote && entries.length === 0 ? (
                <AppText style={styles.realtimeNote} tone="muted" variant="caption">
                  {realtimeNote}
                </AppText>
              ) : null}
            </View>
          ) : (
            <ScrollView
              nestedScrollEnabled
              ref={scrollRef}
              style={[styles.tableBody, {maxHeight}]}>
              {filtered.map(entry => (
                <View key={entry.id} style={styles.row}>
                  <AppText style={[styles.colTime, styles.cellMonoMuted]} variant="caption">
                    {formatTime(entry.timestamp)}
                  </AppText>
                  <AppText
                    numberOfLines={1}
                    style={[styles.colSignal, styles.cellMono]}
                    variant="caption">
                    {entry.name}
                  </AppText>
                  <AppText
                    numberOfLines={1}
                    style={[styles.colValue, styles.cellMono, valueColorStyles[entry.type]]}
                    variant="caption">
                    {entry.value}
                  </AppText>
                  <View style={styles.colType}>
                    <TypeBadge type={entry.type} />
                  </View>
                  <View style={styles.colFreshness}>
                    <FreshnessIndicator timestamp={entry.timestamp} />
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

LiveSignalTail.displayName = 'LiveSignalTail';

/* ─── PageContainer scaffold (web `@/components/layout` PageContainer) ──────── */

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
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="telemetry-live-signal-monitor">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {children}
    </ScrollView>
  );
}

PageContainer.displayName = 'PageContainer';

/* ─── LiveSignalMonitorPage (web default export) ────────────────────────────── */

export default function LiveSignalMonitorPage() {
  const t = useNativeTranslation();
  usePageTitle(t('liveMonitor.title', 'Live Monitor'));

  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();

  const live = useLiveSignalStream({
    enabled: true,
    vehicleId: vehicleId ?? null,
    chartSignals: [],
    tailMax: TAIL_MAX,
  });

  return (
    <PageContainer
      title={t('liveMonitor.title', 'Live Signal Monitor')}
      subtitle={t(
        'liveMonitor.subtitle',
        'Real-time scrolling view of incoming vehicle signals',
      )}
      actions={
        <View style={styles.actionsRow}>
          <VehicleSelect
            setVehicleId={setVehicleId}
            t={t}
            vehicleId={vehicleId}
            vehicles={vehicles}
          />
          <StatusPill
            label={
              live.connected
                ? t('liveMonitor.connected', 'Connected')
                : t('liveMonitor.disconnected', 'Disconnected')
            }
            state={live.connected ? 'online' : 'offline'}
          />
        </View>
      }>
      <LiveSignalTail
        bufferMax={TAIL_MAX}
        entries={live.tailEntries}
        onClear={live.clearTail}
        onPauseToggle={() => live.setTailPaused(p => !p)}
        paused={live.tailPaused}
        rate={live.tailRate}
        realtimeNote={live.unavailableReason}
        t={t}
      />
    </PageContainer>
  );
}

LiveSignalMonitorPage.displayName = 'LiveSignalMonitorPage';

/* ─── styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  actions: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  cellMono: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
  },
  cellMonoMuted: {
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  colFreshness: {
    flex: 1.4,
  },
  colSignal: {
    flex: 2,
  },
  colTime: {
    flex: 1.2,
  },
  colType: {
    flex: 1,
  },
  colValue: {
    flex: 1.6,
  },
  control: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  controlActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  controlDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  controlSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  controlText: {
    color: colors.textSecondary,
  },
  controlTextActive: {
    color: colors.accent,
  },
  controlTextDanger: {
    color: colors.danger,
  },
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
  },
  filterInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessLabel: {
    fontSize: 10,
  },
  freshnessRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerCell: {
    fontWeight: '600',
  },
  headerCopy: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  pageSubtitle: {
    maxWidth: 520,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pressed: {
    opacity: 0.82,
  },
  realtimeNote: {
    fontSize: 10,
    maxWidth: 360,
    textAlign: 'center',
  },
  row: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    letterSpacing: -0.2,
  },
  select: {
    minWidth: 200,
    position: 'relative',
    zIndex: 10,
  },
  selectChevron: {
    marginLeft: spacing.sm,
  },
  selectList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  selectOption: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  selectValue: {
    color: colors.textPrimary,
    flex: 1,
  },
  statCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  statGlyph: {
    color: colors.textMuted,
    fontSize: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tableBody: {
    paddingHorizontal: spacing.sm,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  tableShell: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: spacing.sm,
  },
  tailHeader: {
    gap: spacing.md,
  },
  tailPanel: {
    gap: spacing.md,
  },
  titleGlyph: {
    color: colors.danger,
    fontSize: 16,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  typeBadgeText: {
    fontSize: 10,
  },
});

const freshnessDotStyles = StyleSheet.create<Record<FreshnessStatus, ViewStyle>>({
  fresh: {backgroundColor: colors.success},
  offline: {backgroundColor: colors.danger},
  stale: {backgroundColor: colors.warning},
  unknown: {backgroundColor: colors.textMuted},
});

const valueColorStyles = StyleSheet.create<Record<SignalValueType, TextStyle>>({
  boolean: {color: colors.warning},
  number: {color: colors.accent},
  string: {color: colors.success},
});

type TypeBadgeVariant = 'info' | 'warning' | 'success';

const typeBadgeStyles = StyleSheet.create<Record<TypeBadgeVariant, ViewStyle>>({
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const typeBadgeTextColor: Record<TypeBadgeVariant, string> = {
  info: colors.accent,
  success: colors.success,
  warning: colors.warning,
};
