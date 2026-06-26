// Native parity port of
// web/src/features/telemetry/pages/SignalExplorerPage.tsx.
//
// The web page is the Telemetry > Signal Explorer workspace: a `PageContainer`
// (title + subtitle + a header `VehicleSelect` action and, in live mode, a
// connected/disconnected Badge) whose body composes a controls `GlassPanel`
// (a `SignalSelector` multi-select, a time-range `RangePicker`, a per-page
// `Select`, an `Explore` button, a `Live` toggle button, and a help tooltip),
// the opt-in `AISignalExplorerNlFilter`, and — once the user has explored or
// gone live — a `SignalStatsPanel`, a `SignalChartPanel`, and a
// `SignalHistoryTable`. It drives `vehicleId` from `useSelectedVehicle`,
// fetches per-signal history from `/signals/{vehicleId}/{sig}/history`, and
// folds the rows into chart data + per-signal stats. Live mode swaps the
// historical buffers for an SSE-driven live stream.
//
// This port reproduces the identical state, derived names, API path, the
// MAX_SIGNALS=5 cap, the PER_PAGE option set, the explore/live flow, the
// chart-data / historical-stats / pagination memos, the AI-draft apply
// callback, and the i18n key/fallback intent — using React Native primitives
// and the already-ported native pieces.
//
// Reused already-ported native modules:
//   * `SignalHistoryTable` + `SignalLogEntry` (../components/SignalHistoryTable).
//   * `AISignalExplorerNlFilter` + `SignalFilterDraft`
//     (../../../components/ai/AISignalExplorerNlFilter) — already withAiFeature-
//     gated (renders null in ai_mode='off'), so the page wires it identically.
//   * `ComboboxMulti` (../../../components/forms/ComboboxMulti) backs the
//     native `SignalSelector` (same API the web `SignalSelector` used).
//   * Data layer: `useSignals` + `request` + `SignalHistoryResp`/
//     `SignalHistoryPoint` + `useVehicles`/`Vehicle`.
//   * Shared primitives: `GlassPanel`, `AppText`, `SemanticIcon`, `EmptyState`,
//     theme tokens.
//
// Native substitutions (no DOM, lucide-react, Recharts, Leaflet, framer-motion,
// react-router, or web UI components are imported):
//   * `PageContainer` (@/components/layout) -> a native ScrollView layout with
//     the same title/subtitle/actions header.
//   * `useSelectedVehicle` (global store + react-router URL scope) + the global
//     `<VehicleSelect>` -> `useNativeSelectedVehicle` (first-vehicle default +
//     local override) + a native pressable-chip `VehicleSelect`. The store/URL
//     precedence is browser-only (documented in the sidecar).
//   * `usePageTitle` (document.title) -> `useNativePageTitle` no-op; the header
//     still renders the title.
//   * `useUrlArray` / `useUrlNumber` (URLSearchParams-backed) -> plain `useState`
//     (native has no URL query string); the state names/contracts are preserved.
//   * `useRangeState` (URL + localStorage + RangePicker) -> `useNativeRangeState`
//     (local preset state); the six preset ids the page passes
//     (today/yesterday/7d/30d/90d/all) are resolved with the same local-calendar
//     math as @/lib/datePresets. The calendar/localStorage/URL plumbing is
//     browser-only and documented in the sidecar.
//   * `RangePicker` (@/components/forms) -> a native preset-chip row (the only
//     props the page used were value + onChange + presetIds).
//   * `Button` / `Badge` / `Select` / `HelpTooltip` / `AlertBanner`
//     (@/components/ui + @/components/feedback) -> self-contained native
//     equivalents mirroring their variant/disabled/loading/dot/icon surfaces.
//   * `EmptyState` (@/components/feedback) -> the native EmptyState wrapped with
//     a SemanticIcon to preserve the web `icon` prop intent.
//   * lucide `Activity`/`AlertCircle`/`Database`/`Radio` -> SemanticIcon glyphs
//     (`activity`/`alertCircle`/`database`/`radio`).
//   * `SignalSelector` / `SignalStatsPanel` / `SignalChartPanel` (sibling
//     feature components — their dedicated native files are not ported yet in
//     this file-by-file loop) -> inlined native-safe local components that
//     preserve the same props/logic. `SignalChartPanel` is the one genuinely
//     browser-only piece: its Recharts multi-line SVG chart cannot use native
//     primitives, so the native panel keeps the same header annotations and
//     empty/waiting states and renders a per-signal legend with each signal's
//     latest sample instead of the interactive time-series (explicit
//     unavailable state, documented in the sidecar).
//   * `useLiveSignalStream` (../hooks) -> `useNativeLiveSignalStream`: the
//     web hook subscribes via `useRealtimeEvents` (browser SSE/EventSource),
//     which is not yet ported to native, so this returns the same result shape
//     in an explicit "disconnected / no live points" state. Live mode therefore
//     renders the faithful degraded surface (Disconnected badge + "Waiting for
//     signal data…"); the historical path is fully functional.
//   * `adaptSignalHistoryResp` + `SignalLogEntry` (@/components/SignalQueryControls)
//     -> `adaptSignalHistoryResp` inlined field-for-field; `SignalLogEntry` is
//     imported from the ported native `SignalHistoryTable`.
//   * `getErrorMessage` (@/lib/errorMessage), `fmtInt`/`fmtNumber`
//     (@/lib/numberFormat), `CHART_COLORS` (@/lib/colors) -> inlined verbatim.
//   * react-i18next `t` -> a self-contained fallback returning `fallback ?? key`
//     with `{{var}}` interpolation, preserving every i18n key/fallback.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {SemanticIcon, type SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useSignals} from '../../../api/hooks/useTelemetry';
import {useVehicles} from '../../../api/hooks/useVehicles';
import type {SignalHistoryPoint, SignalHistoryResp} from '../../../api/types';
import {ComboboxMulti} from '../../../components/forms/ComboboxMulti';
import {
  AISignalExplorerNlFilter,
  type SignalFilterDraft,
} from '../../../components/ai/AISignalExplorerNlFilter';
import {SignalHistoryTable, type SignalLogEntry} from '../components/SignalHistoryTable';

/* ── Constants (verbatim from the web source) ───────────────────────────── */

const MAX_SIGNALS = 5;

const PER_PAGE_OPTIONS = [
  {value: '25', label: '25'},
  {value: '50', label: '50'},
  {value: '100', label: '100'},
  {value: '500', label: '500'},
] as const;

// Inlined @/lib/colors `CHART_COLORS` (the bare export resolves to the CB-safe
// Okabe-Ito palette). Used to colour-code signals in the stats panel + legend.
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

const DEFAULT_LOCALE = 'en-US';

/* ── Inlined @/lib/numberFormat helpers ─────────────────────────────────── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtInt(value: number): string {
  const safe = safeNumber(value);
  try {
    return safe.toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(safe));
  }
}

function fmtNumber(value: unknown, decimals = 2): string {
  const safe = safeNumber(value);
  try {
    return safe.toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safe.toFixed(decimals);
  }
}

/* ── Inlined @/lib/errorMessage `getErrorMessage` ───────────────────────── */

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ── Inlined @/components/SignalQueryControls adapter + type ─────────────── */

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
  return resp.data.map(point => adaptSignalHistoryPoint(point, signal));
}

/* ── Inlined ../hooks/useLiveSignalStream `SignalStat` ───────────────────── */

export interface SignalStat {
  signal: string;
  min: number;
  max: number;
  avg: number;
  count: number;
}

/* ── i18n swap ──────────────────────────────────────────────────────────── */

type TVars = Record<string, string | number>;
type NativeTFallback = string | {defaultValue?: string};
type NativeT = (key: string, fallback?: NativeTFallback, vars?: TVars) => string;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(value));
  }
  return out;
}

// react-i18next swap: the page calls `t(key)`, `t(key, fallback)`,
// `t(key, fallback, vars)`, and `t(key, {defaultValue})`. The key is also the
// English string for the bare-key calls, so this returns the resolved English
// copy with `{{var}}` interpolation, preserving every label/copy.
function useNativeT(): NativeT {
  return useCallback<NativeT>((key, fallback, vars) => {
    let base = key;
    if (typeof fallback === 'string') {
      base = fallback;
    } else if (
      fallback &&
      typeof fallback === 'object' &&
      typeof fallback.defaultValue === 'string'
    ) {
      base = fallback.defaultValue;
    }
    return interpolate(base, vars);
  }, []);
}

// Native no-op for web `usePageTitle` (which set document.title). There is no
// document on native; the page header still renders the title.
function useNativePageTitle(_title: string): void {
  // Intentionally empty — see note above.
}

/* ── useUrlArray / useUrlNumber swap (native has no URL query string) ────── */

function useUrlArray(_key: string) {
  return useState<string[]>([]);
}

function useUrlNumber(_key: string, initial: number) {
  return useState<number>(initial);
}

/* ── useRangeState swap (local preset state) ────────────────────────────── */

interface RangeValue {
  start: string;
  end: string;
}

// Format a Date as YYYY-MM-DD using LOCAL calendar fields (matches
// @/lib/datePresets.iso).
function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Resolve the preset ids the page passes (today/yesterday/7d/30d/90d/all),
// mirroring @/lib/datePresets resolve() bodies + resolveAllTimeStart baseline.
function resolvePreset(id: string, now: Date = new Date()): RangeValue {
  switch (id) {
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return {start: isoDate(y), end: isoDate(y)};
    }
    case '7d': {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return {start: isoDate(s), end: isoDate(now)};
    }
    case '30d': {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return {start: isoDate(s), end: isoDate(now)};
    }
    case '90d': {
      const s = new Date(now);
      s.setDate(s.getDate() - 89);
      return {start: isoDate(s), end: isoDate(now)};
    }
    case 'all':
      return {start: '2015-01-01', end: isoDate(now)};
    case 'today':
    default:
      return {start: isoDate(now), end: isoDate(now)};
  }
}

const RANGE_PRESET_IDS = ['today', 'yesterday', '7d', '30d', '90d', 'all'] as const;

function matchPresetId(start: string, end: string): string | undefined {
  for (const id of RANGE_PRESET_IDS) {
    const r = resolvePreset(id);
    if (r.start === start && r.end === end) {
      return id;
    }
  }
  return undefined;
}

interface UseNativeRangeStateOptions {
  defaultPresetId?: string;
  // Accepted for source parity; native has no localStorage persistence.
  persistKey?: string;
}

interface UseNativeRangeStateReturn {
  start: string;
  end: string;
  presetId: string | undefined;
  setRange: (range: RangeValue) => void;
  setPreset: (id: string) => void;
}

function useNativeRangeState(
  opts: UseNativeRangeStateOptions = {},
): UseNativeRangeStateReturn {
  const {defaultPresetId = 'today'} = opts;
  const [range, setRangeState] = useState<RangeValue>(() =>
    resolvePreset(defaultPresetId),
  );

  const setRange = useCallback((next: RangeValue) => {
    setRangeState(next);
  }, []);

  const setPreset = useCallback((id: string) => {
    setRangeState(resolvePreset(id));
  }, []);

  const presetId = useMemo(
    () => matchPresetId(range.start, range.end),
    [range.start, range.end],
  );

  return {start: range.start, end: range.end, presetId, setRange, setPreset};
}

/* ── useSelectedVehicle swap ────────────────────────────────────────────── */

interface VehicleOption {
  id: number;
  label: string;
}

// Parity for `useSelectedVehicle` + the global `<VehicleSelect>`: defaults to
// the first vehicle once the fleet loads and allows a local override (the
// store/URL precedence is browser-only). A single instance backs both the
// `vehicleId` read and the `<VehicleSelect>` action so they stay in sync.
function useNativeSelectedVehicle(): {
  vehicleId: number | null;
  options: VehicleOption[];
  setVehicleId: (id: number | null) => void;
} {
  const {data: vehicles} = useVehicles();
  const [override, setOverride] = useState<number | null>(null);
  const list = vehicles ?? [];
  const firstId = list.length > 0 ? list[0].id : null;
  const vehicleId = override ?? firstId;
  const options = list.map(v => ({
    id: v.id,
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));
  return {vehicleId, options, setVehicleId: setOverride};
}

/* ── useLiveSignalStream swap (explicit unavailable) ────────────────────── */

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
}

// The web hook subscribes via `useRealtimeEvents` (browser SSE/EventSource),
// which is not yet ported to native. This preserves the exact result shape the
// page reads (connected/chartData/chartStats/chartPointCount) as a stable,
// explicit "disconnected / no live points" constant. When the realtime bridge
// is ported, this hook is the single seam to replace.
const EMPTY_LIVE_STREAM_RESULT: UseLiveSignalStreamResult = {
  connected: false,
  chartData: [],
  chartStats: [],
  chartPointCount: 0,
};

function useNativeLiveSignalStream(
  _opts: UseLiveSignalStreamOptions,
): UseLiveSignalStreamResult {
  return EMPTY_LIVE_STREAM_RESULT;
}

/* ── Native shared-component re-implementations ─────────────────────────── */

// `<PageContainer title subtitle actions>` -> native scroll layout.
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
      style={styles.screen}
      contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.subtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      <View style={styles.body}>{children}</View>
    </ScrollView>
  );
}

// `<VehicleSelect>` — native pressable chip cycling the fleet (URL scope is
// browser-only; this mirrors the picker behaviour with a local override).
function VehicleSelect({
  value,
  options,
  onChange,
}: {
  value: number | null;
  options: VehicleOption[];
  onChange: (id: number | null) => void;
}) {
  const current = options.find(o => o.id === value);
  const label = current?.label ?? 'Vehicle';
  const onPress = () => {
    if (options.length === 0) {
      return;
    }
    const idx = options.findIndex(o => o.id === value);
    const next = options[(idx + 1) % options.length];
    onChange(next.id);
  };
  return (
    <Pressable
      accessibilityLabel={`Selected vehicle ${label}`}
      accessibilityRole="button"
      disabled={options.length <= 1}
      onPress={onPress}
      style={styles.vehicleChip}>
      <AppText tone="secondary" variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}

// `<Badge variant dot>` — native connected/disconnected pill.
function Badge({
  tone,
  children,
}: {
  tone: 'success' | 'danger';
  children: ReactNode;
}) {
  const isSuccess = tone === 'success';
  return (
    <View style={[styles.badge, isSuccess ? styles.badgeSuccess : styles.badgeDanger]}>
      <View
        style={[
          styles.badgeDot,
          isSuccess ? styles.badgeDotSuccess : styles.badgeDotDanger,
        ]}
      />
      <AppText
        style={isSuccess ? styles.badgeTextSuccess : styles.badgeTextDanger}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// `<AlertBanner variant="danger">` — native danger banner.
function AlertBanner({message}: {message: string}) {
  return (
    <View style={styles.alertBanner}>
      <SemanticIcon decorative name="alertCircle" size="sm" />
      <AppText style={styles.alertText} tone="danger">
        {message}
      </AppText>
    </View>
  );
}

type ButtonVariant = 'primary' | 'danger' | 'outline';

// `<Button variant icon loading disabled>` — native pressable button.
function Button({
  variant = 'primary',
  label,
  icon,
  onPress,
  disabled = false,
  loading = false,
}: {
  variant?: ButtonVariant;
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'outline' && styles.buttonOutline,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : icon ? (
        <View style={styles.buttonIcon}>{icon}</View>
      ) : null}
      <AppText
        style={variant === 'outline' ? styles.buttonTextOutline : styles.buttonTextSolid}
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// `<Select label value options>` — native segmented per-page control.
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{value: string; label: string}>;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.selectField}>
      <AppText style={styles.fieldLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      <View style={styles.selectOptions}>
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => onChange(opt.value)}
              style={[styles.selectOption, active && styles.selectOptionActive]}>
              <AppText
                style={active ? styles.selectOptionTextActive : undefined}
                tone={active ? 'primary' : 'muted'}
                variant="caption"
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

// `<HelpTooltip>` — native help affordance (the rich hover popover is
// browser-only; the default copy is surfaced via accessibility).
function HelpTooltip({ariaLabel, hint}: {ariaLabel: string; hint: string}) {
  return (
    <SemanticIcon
      accessibilityLabel={`${ariaLabel}. ${hint}`}
      name="helpCircle"
      size="sm"
    />
  );
}

// Native EmptyState + a SemanticIcon to preserve the web `icon` prop intent.
function IconEmptyState({
  icon,
  title,
  message,
}: {
  icon: SemanticIconName;
  title: string;
  message: string;
}) {
  return (
    <View style={styles.emptyStateWrap}>
      <SemanticIcon name={icon} size="lg" />
      <EmptyState message={message} title={title} />
    </View>
  );
}

/* ── SignalSelector (native; wraps the ported ComboboxMulti) ────────────── */

const SIGNAL_LAYER_HELP =
  'TeslaSync exposes three live-state layers: L1 (in-process), L2 (Redis shared), and log (TimescaleDB history).';

function SignalSelector({
  options,
  value,
  onChange,
  max = 5,
  showLayerHelp = true,
  labelOverride,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  max?: number | null;
  showLayerHelp?: boolean;
  labelOverride?: string;
}) {
  const t = useNativeT();
  const cap = max ?? Number.POSITIVE_INFINITY;
  const label =
    labelOverride ??
    (max != null
      ? `${t('Signals')} (${value.length} / ${max})`
      : `${t('Signals')} (${value.length})`);

  return (
    <View style={styles.selectorRoot}>
      <View style={styles.selectorLabelRow}>
        <AppText style={styles.fieldLabel} tone="muted" variant="caption">
          {label}
        </AppText>
        {showLayerHelp ? (
          <HelpTooltip
            ariaLabel={t('help.signal.layers.aria', {
              defaultValue: 'More info about signal layers (L1, L2, log)',
            })}
            hint={SIGNAL_LAYER_HELP}
          />
        ) : null}
      </View>
      <ComboboxMulti<string>
        getOptionKey={s => s}
        getOptionLabel={s => s}
        hideLabel
        label={t('Signals')}
        maxItems={Number.isFinite(cap) ? (cap as number) : undefined}
        onChange={next =>
          onChange(Number.isFinite(cap) ? next.slice(0, cap as number) : next)
        }
        options={options}
        placeholder={t('Search signals…')}
        value={value}
      />
    </View>
  );
}

/* ── SignalStatsPanel (native) ──────────────────────────────────────────── */

function emptyStatRow(signal: string): SignalStat {
  return {signal, min: NaN, max: NaN, avg: NaN, count: 0};
}

function isEmptyStat(stat: SignalStat): boolean {
  return stat.count === 0;
}

function statNumberLabel(n: number): string {
  return Number.isNaN(n) || !Number.isFinite(n) ? '—' : fmtNumber(n);
}

function SignalStatsPanel({
  stats,
  selectedSignals,
  loading = false,
  title,
  signalIndex,
}: {
  stats: SignalStat[];
  selectedSignals?: string[];
  loading?: boolean;
  title?: string;
  signalIndex?: Record<string, number>;
}) {
  const t = useNativeT();
  const [hideEmpty, setHideEmpty] = useState(false);

  const displayStats = useMemo<SignalStat[]>(() => {
    if (!selectedSignals?.length) {
      return stats;
    }
    const byName = new Map(stats.map(s => [s.signal, s]));
    return selectedSignals.map(sig => byName.get(sig) ?? emptyStatRow(sig));
  }, [stats, selectedSignals]);

  const emptyCount = useMemo(
    () => displayStats.reduce((n, s) => (isEmptyStat(s) ? n + 1 : n), 0),
    [displayStats],
  );
  const visibleStats = useMemo(
    () => (hideEmpty ? displayStats.filter(s => !isEmptyStat(s)) : displayStats),
    [displayStats, hideEmpty],
  );

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.panelHeaderRow}>
        <AppText style={styles.sectionTitle} weight="semibold">
          {title ?? t('Stats Summary')}
        </AppText>
        {emptyCount > 0 ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{checked: hideEmpty}}
            onPress={() => setHideEmpty(prev => !prev)}
            style={[styles.toggle, hideEmpty && styles.toggleOn]}>
            <AppText tone={hideEmpty ? 'accent' : 'muted'} variant="caption">
              {t('signalStats.hideEmpty', 'Hide empty ({{count}})', {
                count: emptyCount,
              })}
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.statsSkeletonGrid}>
          {[1, 2, 3, 4].map(i => (
            <View key={i} style={styles.statsSkeletonCell} />
          ))}
        </View>
      ) : visibleStats.length > 0 ? (
        <View style={styles.statsTable}>
          <View style={[styles.statsRow, styles.statsHeaderRow]}>
            <AppText
              style={[styles.statsHeaderText, styles.statsCellSignal]}
              tone="muted"
              variant="caption">
              {t('Signal')}
            </AppText>
            <AppText
              style={[styles.statsHeaderText, styles.statsCellNum]}
              tone="muted"
              variant="caption">
              {t('Min')}
            </AppText>
            <AppText
              style={[styles.statsHeaderText, styles.statsCellNum]}
              tone="muted"
              variant="caption">
              {t('Max')}
            </AppText>
            <AppText
              style={[styles.statsHeaderText, styles.statsCellNum]}
              tone="muted"
              variant="caption">
              {t('Avg')}
            </AppText>
            <AppText
              style={[styles.statsHeaderText, styles.statsCellNum]}
              tone="muted"
              variant="caption">
              {t('Count')}
            </AppText>
          </View>
          {visibleStats.map(s => {
            const idx = signalIndex?.[s.signal] ?? displayStats.indexOf(s);
            const color = CHART_COLORS[Math.max(0, idx) % CHART_COLORS.length];
            const avgFinite = !Number.isNaN(s.avg) && Number.isFinite(s.avg);
            return (
              <View key={s.signal} style={styles.statsRow}>
                <View style={styles.statsCellSignal}>
                  <AppText
                    numberOfLines={1}
                    style={[styles.statsSignalName, {color}]}
                    weight="semibold">
                    {s.signal}
                  </AppText>
                  {isEmptyStat(s) ? (
                    <AppText style={styles.statsNoData} tone="muted" variant="caption">
                      {t('signalStats.noDataInRange', 'No data in range')}
                    </AppText>
                  ) : null}
                </View>
                <AppText style={styles.statsCellNum} tone="secondary" variant="caption">
                  {statNumberLabel(s.min)}
                </AppText>
                <AppText style={styles.statsCellNum} tone="secondary" variant="caption">
                  {statNumberLabel(s.max)}
                </AppText>
                <AppText
                  style={styles.statsCellNum}
                  tone={avgFinite ? 'primary' : 'muted'}
                  variant="caption">
                  {avgFinite ? fmtNumber(s.avg) : '—'}
                </AppText>
                <AppText style={styles.statsCellNum} tone="muted" variant="caption">
                  {fmtInt(s.count)}
                </AppText>
              </View>
            );
          })}
        </View>
      ) : (
        <AppText tone="muted" variant="caption">
          {t('No stats available')}
        </AppText>
      )}
    </GlassPanel>
  );
}

/* ── SignalChartPanel (native-safe; legend stands in for the SVG chart) ──── */

function SignalChartPanel({
  selectedSignals,
  data,
  isLive = false,
  loading = false,
  pointsLoaded,
  liveEventCount,
  title,
  height = 350,
}: {
  selectedSignals: string[];
  data: Record<string, unknown>[];
  stats: SignalStat[];
  isLive?: boolean;
  loading?: boolean;
  pointsLoaded?: number;
  liveEventCount?: number;
  title?: string;
  height?: number;
}) {
  const t = useNativeT();
  const resolvedTitle =
    title ?? (isLive ? t('Live Signal Stream') : t('Signal Chart'));

  const latest = data.length > 0 ? data[data.length - 1] : undefined;

  const bodyStyle: StyleProp<ViewStyle> = [styles.chartBody, {minHeight: height}];

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.panelHeaderRow}>
        <View style={styles.chartTitleGroup}>
          <SemanticIcon decorative name={isLive ? 'radio' : 'analytics'} size="sm" />
          <AppText style={styles.sectionTitle} weight="semibold">
            {resolvedTitle}
          </AppText>
        </View>
        {isLive ? (
          <View style={styles.chartLiveMeta}>
            <View style={styles.chartLiveDot} />
            <AppText style={styles.chartMetaDanger} variant="caption">
              {`${fmtInt(liveEventCount ?? 0)} ${t('events')} · ${fmtInt(
                data.length,
              )} ${t('points')}`}
            </AppText>
          </View>
        ) : data.length > 0 && pointsLoaded != null ? (
          <AppText tone="muted" variant="caption">
            {`${fmtInt(pointsLoaded)} ${t('points loaded')}`}
          </AppText>
        ) : null}
      </View>

      {loading && !isLive ? (
        <View style={[styles.chartSkeleton, {height}]} />
      ) : data.length > 0 ? (
        <View style={bodyStyle}>
          <View style={styles.legend}>
            {selectedSignals.map((sig, i) => {
              const color = CHART_COLORS[i % CHART_COLORS.length];
              const value = latest?.[sig];
              const valueLabel =
                typeof value === 'number' && Number.isFinite(value)
                  ? fmtNumber(value)
                  : '—';
              return (
                <View key={sig} style={styles.legendItem}>
                  <View style={[styles.legendDot, {backgroundColor: color}]} />
                  <AppText
                    numberOfLines={1}
                    style={[styles.legendName, {color}]}
                    variant="caption"
                    weight="semibold">
                    {sig}
                  </AppText>
                  <AppText style={styles.legendValue} tone="secondary" variant="caption">
                    {valueLabel}
                  </AppText>
                </View>
              );
            })}
          </View>
          <AppText style={styles.chartNote} tone="muted" variant="caption">
            {`${fmtInt(data.length)} ${t('points')} · ${t(
              'chart.nativeLegendNote',
              'Latest sample shown; the interactive time-series chart renders on web.',
            )}`}
          </AppText>
        </View>
      ) : isLive ? (
        <View style={[styles.chartCenter, {minHeight: height}]}>
          <SemanticIcon decorative name="radio" size="sm" />
          <AppText style={styles.chartCenterText} tone="muted">
            {t('Waiting for signal data…')}
          </AppText>
        </View>
      ) : (
        <View style={[styles.chartCenter, {minHeight: height}]}>
          <SemanticIcon decorative name="activity" size="sm" />
          <AppText style={styles.chartCenterText} tone="muted">
            {t('No data for this time range')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

/* ── Time-range preset chips (RangePicker swap) ─────────────────────────── */

const RANGE_PICKER_PRESETS: ReadonlyArray<{id: string; label: string}> = [
  {id: 'today', label: 'Today'},
  {id: 'yesterday', label: 'Yesterday'},
  {id: '7d', label: '7d'},
  {id: '30d', label: '30d'},
  {id: '90d', label: '90d'},
  {id: 'all', label: 'All'},
];

function RangePicker({
  start,
  end,
  activePresetId,
  onPreset,
}: {
  start: string;
  end: string;
  activePresetId: string | undefined;
  onPreset: (id: string) => void;
}) {
  return (
    <View style={styles.rangePicker}>
      <View style={styles.rangeChips}>
        {RANGE_PICKER_PRESETS.map(preset => {
          const active = activePresetId === preset.id;
          return (
            <Pressable
              key={preset.id}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => onPreset(preset.id)}
              style={[styles.rangeChip, active && styles.rangeChipActive]}>
              <AppText
                tone={active ? 'primary' : 'muted'}
                variant="caption"
                weight={active ? 'semibold' : 'regular'}>
                {preset.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <AppText style={styles.rangeValue} tone="muted" variant="caption">
        {start === end ? start : `${start} → ${end}`}
      </AppText>
    </View>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function SignalExplorerPage() {
  const t = useNativeT();
  useNativePageTitle(t('Signal Explorer'));

  const {
    vehicleId: storeVehicleId,
    options: vehicleOptions,
    setVehicleId,
  } = useNativeSelectedVehicle();
  const vehicleId = storeVehicleId ?? 0;

  const {data: availableSignals, error: signalsError} = useSignals(vehicleId);
  const [selectedSignals, setSelectedSignals] = useUrlArray('signals');

  const {start, end, presetId, setRange, setPreset} = useNativeRangeState({
    persistKey: 'signal-explorer.range',
    defaultPresetId: 'today',
  });

  const [exploreKey, setExploreKey] = useState<number | null>(null);
  const [page, setPage] = useUrlNumber('page', 1);
  const [perPage, setPerPage] = useUrlNumber('size', 25);
  const [isLive, setIsLive] = useState(false);

  const fromIso = useMemo(
    () => (start ? new Date(`${start}T00:00:00`).toISOString() : ''),
    [start],
  );
  const toIso = useMemo(
    () => (end ? new Date(`${end}T23:59:59.999`).toISOString() : ''),
    [end],
  );

  const canExplore =
    selectedSignals.length > 0 && !!start && !!end && vehicleId > 0;
  const handleExplore = useCallback(() => {
    if (!canExplore) {
      return;
    }
    setIsLive(false);
    setPage(1);
    setExploreKey(Date.now());
  }, [canExplore, setPage]);

  const toggleLive = useCallback(() => {
    setIsLive(prev => !prev);
  }, []);

  // Wipe history when switching vehicles to avoid intermixing.
  useEffect(() => {
    setExploreKey(null);
  }, [vehicleId]);

  const {
    data: historicalRows,
    isLoading: historicalLoading,
    isFetching,
    error: historicalError,
  } = useQuery<SignalLogEntry[]>({
    queryKey: ['signal-explorer', vehicleId, exploreKey],
    queryFn: async () => {
      const results = await Promise.all(
        selectedSignals.map(sig =>
          request<SignalHistoryResp>(
            `/signals/${vehicleId}/${sig}/history?from=${fromIso}&to=${toIso}&limit=${
              perPage * 10
            }`,
          ),
        ),
      );
      return results
        .flatMap(resp => adaptSignalHistoryResp(resp))
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
    },
    enabled: !isLive && exploreKey !== null,
  });

  const live = useNativeLiveSignalStream({
    enabled: isLive,
    vehicleId: vehicleId > 0 ? vehicleId : null,
    chartSignals: selectedSignals,
    tailMax: 0,
  });

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
        row.value_num ??
        (row.value_bool === true ? 1 : row.value_bool === false ? 0 : null);
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        new Date(a.timestamp as string).getTime() -
        new Date(b.timestamp as string).getTime(),
    );
  }, [historicalRows]);

  const historicalStats = useMemo<SignalStat[]>(() => {
    if (!historicalRows?.length) {
      return [];
    }
    const bySignal = new Map<string, number[]>();
    for (const row of historicalRows) {
      if (row.value_num === null || row.value_num === undefined) {
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

  const totalRecords = (historicalRows ?? []).length;
  const paginatedRows = useMemo(() => {
    const startIdx = (page - 1) * perPage;
    return (historicalRows ?? []).slice(startIdx, startIdx + perPage);
  }, [historicalRows, page, perPage]);

  const activeChart = isLive ? live.chartData : chartData;
  const activeStats = isLive ? live.chartStats : historicalStats;
  const hasHistorical = exploreKey !== null;
  const anyError = (signalsError ?? historicalError) as Error | undefined;

  // Wires the optional AI natural-language filter into deterministic page state.
  // The AI section is opt-in and absent in off mode. The LLM never writes; this
  // callback runs only when the user taps "Apply to filters" on a typed proposal.
  const handleApplyAiDraft = useCallback(
    (draft: SignalFilterDraft) => {
      const next = draft.signals
        .filter(s => typeof s === 'string' && s.length > 0)
        .slice(0, MAX_SIGNALS);
      if (next.length > 0) {
        setSelectedSignals(next);
      }
      if (draft.range_preset) {
        setPreset(draft.range_preset);
      }
      if (draft.per_page > 0) {
        setPerPage(draft.per_page);
        setPage(1);
      }
    },
    [setSelectedSignals, setPreset, setPerPage, setPage],
  );

  return (
    <PageContainer
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect
            onChange={setVehicleId}
            options={vehicleOptions}
            value={vehicleId > 0 ? vehicleId : null}
          />
          {isLive ? (
            <Badge tone={live.connected ? 'success' : 'danger'}>
              {live.connected
                ? t('liveMonitor.connected', 'Connected')
                : t('liveMonitor.disconnected', 'Disconnected')}
            </Badge>
          ) : null}
        </View>
      }
      subtitle={t(
        'Visualise signal history with chart and stats — or stream live',
      )}
      title={t('Signal Explorer')}>
      {anyError ? (
        <AlertBanner
          message={`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(
            anyError,
          )}`}
        />
      ) : null}

      {vehicleId === 0 ? (
        // no-action: vehicle picker is in the page header; no inline CTA needed.
        <IconEmptyState
          icon="activity"
          message={t(
            'signalExplorer.noVehicleDesc',
            'Pick a vehicle from the picker above to explore its signals.',
          )}
          title={t('signalExplorer.noVehicle', 'Select a vehicle to begin')}
        />
      ) : (
        <>
          <GlassPanel style={styles.controlsPanel}>
            <SignalSelector
              max={MAX_SIGNALS}
              onChange={next => setSelectedSignals(next.slice(0, MAX_SIGNALS))}
              options={availableSignals ?? []}
              value={selectedSignals}
            />

            <View style={styles.controlsRow}>
              <View style={styles.rangeField}>
                <AppText style={styles.fieldLabel} tone="muted" variant="caption">
                  {t('Time Range')}
                </AppText>
                <RangePicker
                  activePresetId={presetId}
                  end={end}
                  onPreset={id => {
                    if (id === 'custom') {
                      setRange({start, end});
                    } else {
                      setPreset(id);
                    }
                  }}
                  start={start}
                />
              </View>
              <View style={styles.controlsActions}>
                {!isLive ? (
                  <Select
                    label={t('Per Page')}
                    onChange={v => {
                      setPerPage(Number(v));
                      setPage(1);
                    }}
                    options={PER_PAGE_OPTIONS}
                    value={String(perPage)}
                  />
                ) : null}
                {!isLive ? (
                  <Button
                    disabled={!canExplore}
                    icon={<SemanticIcon decorative name="database" size="sm" />}
                    label={t('Explore')}
                    loading={isFetching}
                    onPress={handleExplore}
                    variant="primary"
                  />
                ) : null}
                <Button
                  disabled={selectedSignals.length === 0 && !isLive}
                  icon={<SemanticIcon decorative name="radio" size="sm" />}
                  label={
                    isLive
                      ? t('signalExplorer.stopLive', 'Stop live')
                      : t('signalExplorer.live', 'Live')
                  }
                  onPress={toggleLive}
                  variant={isLive ? 'danger' : 'outline'}
                />
                <HelpTooltip
                  ariaLabel={t('help.signal.live.aria', {
                    defaultValue: 'More info about live signal streaming',
                  })}
                  hint="Live mode streams real-time signal values via SSE. Maintains a rolling 5-minute window throttled to 2 Hz updates."
                />
              </View>
            </View>
          </GlassPanel>

          <AISignalExplorerNlFilter
            onApply={handleApplyAiDraft}
            vehicleId={vehicleId}
          />

          {!hasHistorical && !isLive ? (
            // no-action: signal picker, range, and Explore/Live controls are directly above this state.
            <IconEmptyState
              icon="database"
              message={t(
                'Choose up to 5 signals, set a date range, then hit Explore — or toggle Live to stream in real time.',
              )}
              title={t('Pick signals and click Explore')}
            />
          ) : (
            <>
              {activeStats.length > 0 ? (
                <SignalStatsPanel
                  loading={historicalLoading && !isLive}
                  stats={activeStats}
                />
              ) : null}

              <SignalChartPanel
                data={activeChart}
                isLive={isLive}
                liveEventCount={live.chartPointCount}
                loading={historicalLoading && !isLive}
                pointsLoaded={historicalRows?.length}
                selectedSignals={selectedSignals}
                stats={activeStats}
              />

              {!isLive && hasHistorical ? (
                <SignalHistoryTable
                  loading={historicalLoading}
                  onPageChange={setPage}
                  page={page}
                  pageSize={perPage}
                  rows={paginatedRows}
                  selectedSignals={selectedSignals}
                  totalRows={totalRecords}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  alertBanner: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  alertText: {
    flexShrink: 1,
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  badgeDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  badgeDotDanger: {
    backgroundColor: colors.danger,
  },
  badgeDotSuccess: {
    backgroundColor: colors.success,
  },
  badgeSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  badgeTextDanger: {
    color: colors.danger,
  },
  badgeTextSuccess: {
    color: colors.success,
  },
  body: {
    gap: spacing.lg,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonDanger: {
    backgroundColor: colors.danger,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonIcon: {
    marginRight: 2,
  },
  buttonOutline: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonTextOutline: {
    color: colors.textPrimary,
  },
  buttonTextSolid: {
    color: colors.background,
  },
  chartBody: {
    gap: spacing.sm,
  },
  chartCenter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  chartCenterText: {
    flexShrink: 1,
  },
  chartLiveDot: {
    backgroundColor: colors.danger,
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  chartLiveMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  chartMetaDanger: {
    color: colors.danger,
  },
  chartNote: {
    marginTop: spacing.xs,
  },
  chartSkeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    width: '100%',
  },
  chartTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  controlsActions: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  controlsPanel: {
    gap: spacing.md,
    padding: spacing.md,
  },
  controlsRow: {
    gap: spacing.md,
  },
  emptyStateWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  fieldLabel: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  headerText: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  legendDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  legendItem: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  legendName: {
    maxWidth: 160,
  },
  legendValue: {
    fontVariant: ['tabular-nums'],
  },
  panel: {
    gap: spacing.md,
    padding: spacing.md,
  },
  panelHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  rangeChip: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  rangeChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  rangeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  rangeField: {
    gap: spacing.xs,
  },
  rangePicker: {
    gap: spacing.xs,
  },
  rangeValue: {
    fontVariant: ['tabular-nums'],
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
    flexShrink: 1,
    fontSize: 16,
  },
  selectField: {
    gap: spacing.xs,
  },
  selectOption: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  selectOptionActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  selectOptionTextActive: {
    color: colors.textPrimary,
  },
  selectOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  selectorLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  selectorRoot: {
    gap: spacing.xs,
  },
  statsCellNum: {
    flex: 1,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  statsCellSignal: {
    flex: 2,
  },
  statsHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingBottom: spacing.xs,
  },
  statsHeaderText: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statsNoData: {
    marginTop: 2,
  },
  statsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  statsSignalName: {
    fontSize: 13,
  },
  statsSkeletonCell: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexBasis: '47%',
    flexGrow: 1,
    height: 64,
  },
  statsSkeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statsTable: {
    gap: 2,
  },
  subtitle: {
    marginTop: spacing.xs,
  },
  toggle: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  toggleOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  vehicleChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
