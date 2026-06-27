import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/analytics/pages/TimelinePage.tsx.
//
// `TimelinePage` visualises a vehicle's FSM state history. It resolves the
// active vehicle, derives a trailing `days` window from a canonical range
// picker, fetches two endpoints — `/vehicle-states/timeline?vehicle_id={id}
// &days={n}` (query key `['vehicle-timeline', activeId, days]`) and
// `/vehicle-states/summary?vehicle_id={id}&days={n}` (query key
// `['vehicle-summary', activeId, days]`), both gated on a selected vehicle —
// and renders four summary MetricCards, a proportional state-distribution bar
// with a colour legend, a daily transition-count breakdown, and a sortable
// state-transitions table. Every state name (`setUrlVehicleId`, `vehicleId`/
// `vehicles`/`setVehicleId`, `activeId`, `enabled`, `onPickVehicle`, `start`/
// `end`/`setRange`, `days`, `vehiclesError`, `timelineQuery`/`timelineData`/
// `tlLoading`/`timelineError`/`refetch`, `summaryData`/`sumLoading`/
// `summaryError`, `transitionsRaw`, `summaryRows`, `totalSeconds`, `anyError`,
// `isLoading`, `transitions`, `dailyBreakdown`, `summaryByState`,
// `totalTransitions`, `drivingSec`, `chargingSec`, `idleSec`, `sleepingSec`,
// `columns`, `vehicleOptions`, `actions`), the API paths + query gating, and
// every i18n key + English fallback are preserved verbatim. The `STATE_COLORS`
// / `STATE_BADGE` maps and the `formatHoursFromSeconds` /
// `formatDurationFromSeconds` helpers are byte-identical. The four type
// interfaces (`TransitionRecord`, `TransitionRow`, `ByStateRow`,
// `SummaryResponse`) are ported verbatim.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4-7), each documented in the parity sidecar:
//   - react-i18next `useTranslation` (L2) -> a native i18n shim. i18next returns
//     the KEY when no translation/fallback exists, so the shim resolves
//     `t(key)` -> key and `t(key, 'English')` -> the English fallback. Used
//     identically by the sibling page ports.
//   - `@tanstack/react-query` `useQuery` (L3) -> reused 1:1 (the native app ships
//     @tanstack/react-query); both timeline + summary queries keep their key,
//     queryFn (`request(...)`), and `enabled` gating verbatim.
//   - lucide-react icons (L4-7: Clock/ArrowRightLeft/Car/BatteryCharging/Moon/
//     RefreshCw/AlertCircle/BarChart3) are SVG with no native analog ->
//     decorative emoji glyphs via the local `Glyph` (accessibilityElementsHidden);
//     the adjacent label always carries the meaning.
//   - `PageContainer` from @/components/layout (L9) -> the web-parity layout
//     PageContainer (reused; `title`/`subtitle`/`actions`/`loading` match).
//   - `GlassPanel`/`Badge`/`Button`/`Select`/`DataTable`/`Column` from
//     @/components/ui (L10): GlassPanel -> the shared native GlassPanel;
//     Badge/DataTable/Column -> the web-parity ui ports (reused 1:1 — the table
//     keeps tableId/columns/data/keyExtractor/emptyMessage/pagination, the
//     badges keep variant/size). `Button` -> a local ghost-variant pressable
//     (the refresh action stays functional on native — `refetch()` works).
//     `Select` -> a local read-only chip showing the resolved vehicle label
//     (interactive option selection is UNAVAILABLE on native; `onChange`/
//     `options`/`value`/`placeholder` are accepted for source compatibility, and
//     `onPickVehicle` is wired through so the state-mutation path is preserved).
//   - `RangePicker` from @/components/forms (L11) -> a local read-only chip
//     showing the resolved start->end window; interactive calendar selection is
//     UNAVAILABLE (documented); `onChange`/`presetIds`/`presetsOnly`/`align`/
//     `triggerTestId` accepted for source compatibility (triggerTestId
//     'timeline-range' preserved as testID).
//   - `useRangeState` from @/hooks/useRangeState (L12) -> a local native-safe
//     shim holding the {start,end} window in component state, defaulting to the
//     `'7d'` preset (today-6 .. today, ISO yyyy-mm-dd) exactly as the web preset
//     resolves. URL sync + localStorage persistence are UNAVAILABLE (documented);
//     `setRange` still updates state. `persistKey`/`defaultPresetId` accepted.
//   - `MetricCard`/`DataFreshnessAuto` from @/components/data-display (L13):
//     DataFreshnessAuto -> the web-parity port (reused 1:1 with `timelineQuery`);
//     MetricCard -> a local component mirroring the web public API (label/value/
//     icon/color), where the web NeonColor set maps to the SI palette
//     (cyan->accent, green->success) and only the icon chip is tinted (the value
//     stays text-primary, exactly like the web MetricCard).
//   - `Skeleton`/`EmptyState`/`AlertBanner` from @/components/feedback (L14) ->
//     local components mirroring the web APIs: Skeleton -> a muted rounded
//     placeholder of the requested `height`; EmptyState -> a centred muted
//     `message` with an optional decorative `icon` (the shared native EmptyState
//     requires a `title` the source never supplies); AlertBanner -> a tinted
//     row (variant/icon/children; `danger` -> the SI danger palette).
//   - `FadeIn` from @/components/motion (L15) -> the web-parity motion barrel
//     (reused; `delay` in seconds preserved).
//   - every chart primitive from @/components/charts (L16-19): BarChart/Bar/
//     XAxis/YAxis/CartesianGrid/Tooltip/Legend/ResponsiveContainer/ChartTooltip
//     -> the web-parity charts barrel, which preserves the Recharts public API
//     while rendering React-Native-safe placeholders (no Recharts/SVG/DOM). The
//     daily-breakdown recharts JSX is kept structurally faithful; the per-day
//     native stacked-bar summary below it carries the same counts in an
//     accessible, visible form (the source's `chart-a11y:no-table` intent).
//   - `useVehicles` from @/api/hooks/useVehicles (L21) + the `Vehicle` type ->
//     the web-parity useVehicles hook + its exported `Vehicle` (reused 1:1).
//   - `useSelectedVehicle` from @/hooks/useSelectedVehicle (L22) -> a local shim
//     resolving the first vehicle in the fleet (URL `?vehicle_id` deep-links +
//     localStorage persistence are UNAVAILABLE on native); it still returns
//     `{ vehicleId, vehicles, setVehicleId }` and `setVehicleId` is a functional
//     state setter so the picker contract is preserved.
//   - `usePageTitle` from @/hooks/usePageTitle (L23) -> the web-parity hook port
//     (reused; the OS title paint is a documented native no-op there).
//   - `useUrlString` from @/hooks/useUrlState (L24) -> a local state-backed shim
//     (no DOM URL on native); `setUrlVehicleId` stays a functional setter.
//   - `formatDateTime` from @/lib/dateFormat (L25), `fmtInt`/`fmtPercent` from
//     @/lib/numberFormat (L26) and `getErrorMessage` from @/lib/errorMessage
//     (L28) -> inlined verbatim so rendered strings are byte-identical.
//   - `cn` from @/lib/cn (L27) is a className combiner with no native surface ->
//     dropped (StyleSheet replaces Tailwind classes).
//   - `request` from @/api/client (L29) -> the web-parity api client (reused 1:1).
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported. Tailwind maps to StyleSheet: the `grid-cols-1
// sm:grid-cols-2 lg:grid-cols-4` metric grid resolves mobile-first to a
// flex-wrap row (each card flexBasis 150 -> 2-up on phones, 4-up on wide
// screens); `p-4`/`mb-6` -> panel padding 16 / marginBottom 24; the
// `--text-primary/secondary/muted` tokens -> colors.text*; the proportional
// distribution bar + colour legend render as native Views; the long page body
// is wrapped in a ScrollView so every section stays reachable.

import React, {useMemo} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {PageContainer} from '../../../components/layout/PageContainer';
import {DataFreshnessAuto} from '../../../components/data-display/DataFreshness';
import {FadeIn} from '../../../components/motion';
import {Badge, type BadgeVariant} from '../../../components/ui/Badge';
import {DataTable, type Column} from '../../../components/ui/DataTable';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartTooltip,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '../../../components/charts';
import {usePageTitle} from '../../../hooks/usePageTitle';

/* ── i18n shim ─────────────────────────────────────────────────── */
// react-i18next has no native parity module. i18next resolves a missing
// translation to the KEY, so: `t(key)` -> key; `t(key, 'English')` -> 'English'.
type TFunc = (key: string, fallback?: string) => string;

const translate: TFunc = (key, fallback) =>
  typeof fallback === 'string' ? fallback : key;

function useTranslation(): {t: TFunc} {
  return {t: translate};
}

/* ── numberFormat (inlined from web @/lib/numberFormat) ────────── */
// `safeNumber` collapses non-finite/non-number values to 0; `fmtNumber` is the
// locale-aware fixed-precision formatter (default precision 2); `fmtInt` is
// `fmtNumber(v, 0)`; `fmtPercent` is `` `${fmtNumber(v, decimals)}%` ``.
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

function fmtPercent(v: unknown, decimals?: number): string {
  return `${fmtNumber(v, decimals)}%`;
}

/* ── dateFormat (inlined from web @/lib/dateFormat) ────────────── */
// `formatDateTime` returns the universal "—" placeholder for unrenderable input
// and otherwise the locale full date + time ("Apr 4, 2026, 2:30 AM"), matching
// the web contract (browser locale + timezone; no tz override is passed here).
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ── errorMessage (inlined from web @/lib/errorMessage) ────────── */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ── useUrlString shim (native-safe; in-state string) ──────────── */
// The web hook mirrors a query-string key to/from the DOM URL. Native has no DOM
// URL, so the value is held in component state; `setUrlVehicleId` stays a
// functional setter so the source mutation path is preserved (the URL write is
// UNAVAILABLE on native, documented).
function useUrlString(
  _key: string,
  initial: string,
): [string, (next: string) => void] {
  const [value, setValue] = React.useState(initial);
  return [value, setValue];
}

/* ── useSelectedVehicle shim (native-safe; first vehicle in fleet) ── */
// The web hook resolves URL `?vehicle_id` deep-links > persisted store > first
// vehicle, and exposes `{ vehicleId, vehicles, setVehicleId }`. Native has no
// DOM URL and no cross-page selected-vehicle store, so selection defaults to the
// first vehicle in the fleet; `setVehicleId` is a functional state override so
// the picker contract is preserved (the Select chip itself is read-only on
// native — documented).
function useSelectedVehicle(): {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number) => void;
} {
  const {data} = useVehicles();
  const vehicles = useMemo(() => data ?? [], [data]);
  const [override, setOverride] = React.useState<number | null>(null);
  const vehicleId =
    override ?? (vehicles.length > 0 ? vehicles[0].id : null);
  const setVehicleId = React.useCallback(
    (id: number) => setOverride(id),
    [],
  );
  return {vehicleId, vehicles, setVehicleId};
}

/* ── useRangeState shim (native-safe; in-state {start,end} window) ── */
// The web hook syncs the range to the URL + localStorage and resolves named
// presets. Native has no DOM URL or localStorage, so both are UNAVAILABLE; the
// shim holds the window in component state, defaulting to the `'7d'` preset
// (today-6 .. today) exactly as the web preset resolves. `setRange` still
// updates state. `persistKey`/`defaultPresetId` are accepted but the default
// window is always the documented 7-day trailing window this page requests.
interface RangeValue {
  start: string;
  end: string;
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveDefaultRange(): RangeValue {
  const now = new Date();
  const s = new Date(now);
  s.setDate(s.getDate() - 6);
  return {start: isoFromDate(s), end: isoFromDate(now)};
}

interface UseRangeStateOptions {
  persistKey?: string;
  defaultPresetId?: string;
}

function useRangeState(_options: UseRangeStateOptions = {}): {
  start: string;
  end: string;
  setRange: (range: RangeValue) => void;
} {
  const [range, setRange] = React.useState<RangeValue>(resolveDefaultRange);
  const setRangeCb = React.useCallback(
    (next: RangeValue) => setRange(next),
    [],
  );
  return {start: range.start, end: range.end, setRange: setRangeCb};
}

/* ── Decorative glyph (lucide icon substitute) ─────────────────── */
function GlyphLegacyUnused({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={style}>
      {children}
    </AppText>
  );
}

/* ── Local EmptyState (web @/components/feedback EmptyState) ────── */
// Mirrors the web API (`{ message, icon? }`): a centred muted message with an
// optional decorative glyph. The shared native EmptyState requires a `title` the
// source never supplies, so this message-only shim stays faithful.
function EmptyState({message, icon}: {message: string; icon?: string}) {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      {icon ? <Glyph style={styles.emptyIcon}>{icon}</Glyph> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── Local Skeleton (web @/components/feedback Skeleton) ────────── */
// Mirrors the web API surface this page uses (`{ height }`): a muted rounded
// placeholder block spanning the full width at the requested height. The web
// pulse animation is omitted (purely decorative); width defaults to 100%.
function Skeleton({height = 16}: {height?: number}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.skeleton, {height}]}
    />
  );
}

/* ── Local AlertBanner (web @/components/feedback AlertBanner) ──── */
// Mirrors the web API surface this page uses (`{ variant, icon, children }`): a
// tinted inline row with an optional leading glyph. The web neon variant map
// resolves to the SI palette (`danger` -> colors.danger). Only `danger` is
// exercised here; the other variants are kept for source compatibility.
type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const ALERT_TINT: Record<AlertVariant, string> = {
  info: colors.accent,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

function AlertBanner({
  variant,
  icon,
  children,
}: {
  variant: AlertVariant;
  icon?: string;
  children: React.ReactNode;
}) {
  const tint = ALERT_TINT[variant] ?? colors.accent;
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.alert,
        {borderColor: `${tint}33`, backgroundColor: `${tint}14`},
      ]}>
      {icon ? <Glyph style={[styles.alertIcon, {color: tint}]}>{icon}</Glyph> : null}
      <AppText style={[styles.alertText, {color: tint}]}>{children}</AppText>
    </View>
  );
}

/* ── Local MetricCard (web @/components/data-display MetricCard) ── */
// Mirrors the web MetricCard public API surface used here (label/value/icon/
// color). The web NeonColor maps to the SI palette; only the icon chip is tinted
// (the value stays text-primary, as on the web). `color` defaults to 'cyan'
// (the web default).
type MetricColor = 'cyan' | 'green' | 'amber' | 'purple' | 'red';

const METRIC_TINT: Record<MetricColor, string> = {
  cyan: colors.accent,
  green: colors.success,
  amber: colors.warning,
  purple: colors.violet,
  red: colors.danger,
};

function MetricCard({
  label,
  value,
  icon,
  color = 'cyan',
}: {
  label: string;
  value: string | number;
  icon?: string;
  color?: MetricColor;
}) {
  const tint = METRIC_TINT[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricRow}>
        <View style={styles.metricTextBlock}>
          <AppText
            numberOfLines={1}
            style={styles.metricLabel}
            tone="muted"
            variant="caption">
            {label}
          </AppText>
          <AppText style={styles.metricValue} weight="bold">
            {value}
          </AppText>
        </View>
        {icon ? (
          <View
            style={[
              styles.metricIcon,
              {borderColor: `${tint}55`, backgroundColor: `${tint}1f`},
            ]}>
            <Glyph style={[styles.metricIconGlyph, {color: tint}]}>{icon}</Glyph>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ── Local Select (web @/components/ui Select) ─────────────────── */
// Read-only on native: shows the label of the currently-selected option (or the
// placeholder when none resolves). Interactive option selection is UNAVAILABLE
// (documented in the sidecar); `options`/`value`/`onChange`/`placeholder` are
// accepted for source compatibility — `onChange` is wired so the page's
// `onPickVehicle` mutation path stays referenced, but native never invokes it.
interface SelectOption {
  value: string;
  label: string;
}

function Select({
  options,
  value,
  placeholder,
}: {
  options: SelectOption[];
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}) {
  const selected = options.find(o => o.value === value);
  const label = selected?.label ?? placeholder ?? '—';
  return (
    <View accessibilityRole="text" style={styles.selectChip}>
      <Glyph style={styles.selectChipGlyph}>🚗</Glyph>
      <AppText
        numberOfLines={1}
        style={styles.selectChipText}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ── Local RangePicker (web @/components/forms RangePicker) ────── */
// Read-only on native: shows the resolved start->end window. Interactive
// calendar selection is UNAVAILABLE (documented); `onChange`/`presetIds`/
// `presetsOnly`/`align` are accepted for source compatibility.
function RangePicker({
  value,
  triggerTestId,
}: {
  value: RangeValue;
  onChange?: (range: RangeValue) => void;
  presetIds?: string[];
  presetsOnly?: boolean;
  align?: 'start' | 'end';
  triggerTestId?: string;
}) {
  return (
    <View accessibilityRole="text" style={styles.rangeChip} testID={triggerTestId}>
      <Glyph style={styles.rangeChipGlyph}>📅</Glyph>
      <AppText
        numberOfLines={1}
        style={styles.rangeChipText}
        variant="caption"
        weight="semibold">
        {`${value.start} → ${value.end}`}
      </AppText>
    </View>
  );
}

/* ── Local Button (web @/components/ui Button — ghost variant) ─── */
// The source uses a ghost-variant icon button to trigger `refetch()`. `refetch`
// works on native, so this affordance stays functional: a pressable that calls
// `onPress`. `variant` is accepted for source compatibility.
function Button({
  onPress,
  children,
  accessibilityLabel,
}: {
  variant?: 'ghost' | 'primary' | 'secondary';
  onPress?: () => void;
  children: React.ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({pressed}) => [styles.ghostButton, pressed ? styles.ghostButtonPressed : null]}>
      {children}
    </Pressable>
  );
}

/* ─── Types matching actual API responses ────────────────── */

/** GET /vehicle-states/timeline → { vehicle_id, days, transitions: TransitionRecord[] }.
 *  Each record is a single FSM transition event — point-in-time, NOT a state with
 *  duration. To compute "time spent in state X" we use the summary endpoint instead. */
interface TransitionRecord {
  ts: string;
  from_state: string;
  to_state: string;
  trigger_field: string | null;
  trigger_value: string | null;
}

/** Indexed transition row for the table. Adds the timestamp of the
 *  *next* transition so the table can compute "duration spent in
 *  to_state" without extra hooks. The newest row has no successor —
 *  its duration is computed from `now` so the user sees how long the
 *  vehicle has been in the current state. */
interface TransitionRow extends TransitionRecord {
  index: number;
  next_ts: string | null;
}

/** GET /vehicle-states/summary → { vehicle_id, days, total_seconds, by_state: ByStateRow[] }. */
interface ByStateRow {
  state: string;
  total_seconds: number;
  percentage: number;
  transition_count: number;
}

interface SummaryResponse {
  vehicle_id: number;
  days: number;
  total_seconds: number;
  by_state: ByStateRow[];
}

/* ─── Constants ──────────────────────────────────────────── */

const STATE_COLORS: Record<string, string> = {
  driving: '#10b981',
  charging: '#00f0ff',
  idle: '#f59e0b',
  sleeping: '#64748b',
  online: '#3b82f6',
  offline: '#374151',
  parked: '#8b5cf6',
  asleep: '#64748b',
};

const STATE_BADGE: Record<string, BadgeVariant> = {
  driving: 'success',
  charging: 'info',
  idle: 'warning',
  sleeping: 'neutral',
  online: 'info',
  offline: 'danger',
  parked: 'warning',
  asleep: 'neutral',
};

function formatHoursFromSeconds(seconds: number): string {
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const h = Math.floor(hours);
  const m = (hours - h) * 60;
  if (h === 0) return `${fmtInt(m)}m`;
  return m >= 0.5 ? `${h}h ${fmtInt(m)}m` : `${h}h`;
}

function formatDurationFromSeconds(seconds: number): string {
  if (seconds < 60) return `${fmtInt(seconds)}s`;
  return formatHoursFromSeconds(seconds);
}

/* ─── Daily breakdown buckets (native accessible companion to the chart) ─── */
const DAILY_BUCKETS: {key: 'driving' | 'charging' | 'idle' | 'sleeping'; color: string}[] = [
  {key: 'driving', color: STATE_COLORS.driving},
  {key: 'charging', color: STATE_COLORS.charging},
  {key: 'idle', color: STATE_COLORS.idle},
  {key: 'sleeping', color: STATE_COLORS.sleeping},
];

interface DailyBucket {
  day: string;
  driving: number;
  charging: number;
  idle: number;
  sleeping: number;
}

/* ─── Component ──────────────────────────────────────────── */

export default function TimelinePage() {
  const {t} = useTranslation();
  usePageTitle(t('timeline.title', 'Timeline'));

  // Vehicle selection: useSelectedVehicle reads ?vehicle_id from the URL
  // (alert deep-links), persists across pages via localStorage, and falls
  // back to the first vehicle. We additionally mirror the picker's value
  // to the URL on change so the page URL stays bookmarkable.
  const [, setUrlVehicleId] = useUrlString('vehicle_id', '');
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';
  const enabled = activeId !== '';

  const onPickVehicle = (id: string) => {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) {
      setVehicleId(n);
      setUrlVehicleId(id);
    }
  };

  const {start, end, setRange} = useRangeState({
    persistKey: 'timeline.range',
    defaultPresetId: '7d',
  });

  // Backend accepts `?days=N` (trailing window). Compute inclusive day
  // count from the picker's range. Custom historical windows that don't
  // end today still degrade to a trailing window — `presetsOnly` mode
  // hides the calendar to keep the UX honest.
  const days = useMemo(() => {
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T00:00:00`).getTime();
    return Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
  }, [start, end]);

  const {error: vehiclesError} = useVehicles();

  const timelineQuery = useQuery({
    queryKey: ['vehicle-timeline', activeId, days],
    queryFn: () =>
      request<{transitions: TransitionRecord[]}>(
        `/vehicle-states/timeline?vehicle_id=${activeId}&days=${days}`,
      ),
    enabled,
  });
  const {data: timelineData, isLoading: tlLoading, error: timelineError, refetch} = timelineQuery;

  const {data: summaryData, isLoading: sumLoading, error: summaryError} = useQuery({
    queryKey: ['vehicle-summary', activeId, days],
    queryFn: () =>
      request<SummaryResponse>(
        `/vehicle-states/summary?vehicle_id=${activeId}&days=${days}`,
      ),
    enabled,
  });

  /* Defensive coercion — even with TanStack handling network errors, an
   * unexpected response shape (e.g. backend returns an array, or an error
   * envelope object) would otherwise crash with "X is not iterable" inside
   * the for/of loops below. (Wrapped in useMemo so the downstream useMemo
   * dependencies stay referentially stable — the value is identical to the
   * web source's inline coercion.) */
  const transitionsRaw = useMemo<TransitionRecord[]>(
    () =>
      Array.isArray(timelineData?.transitions)
        ? (timelineData!.transitions as TransitionRecord[])
        : [],
    [timelineData],
  );
  const summaryRows = useMemo<ByStateRow[]>(
    () =>
      Array.isArray(summaryData?.by_state)
        ? (summaryData!.by_state as ByStateRow[])
        : [],
    [summaryData],
  );
  const totalSeconds = summaryData?.total_seconds ?? 0;

  const anyError = [vehiclesError, timelineError, summaryError].find(Boolean);
  const isLoading = tlLoading || sumLoading;

  // Indexed transition rows for the table — sorted ASC by ts so duration
  // computations point to the correct neighbour. The DataTable's own
  // "Time" column is sortable so the user can still flip the display
  // order without affecting duration math.
  const transitions = useMemo<TransitionRow[]>(() => {
    if (transitionsRaw.length === 0) return [];
    const ordered = [...transitionsRaw].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    return ordered.map((rec, i) => ({
      ...rec,
      index: i,
      next_ts: i + 1 < ordered.length ? ordered[i + 1].ts : null,
    }));
  }, [transitionsRaw]);

  /* Daily breakdown — bin transitions by YYYY-MM-DD of `ts`, count by
   * the *destination* state (to_state) since that is what the original
   * pre-refactor chart visualised. We collapse the 8 raw FSM states
   * into the 4 user-facing buckets shown in the legend (driving /
   * charging / idle / sleeping) so the chart stays readable. */
  const dailyBreakdown = useMemo<DailyBucket[]>(() => {
    if (transitions.length === 0) return [];
    const buckets = new Map<string, DailyBucket>();
    for (const row of transitions) {
      const date = new Date(row.ts);
      if (Number.isNaN(date.getTime())) continue;
      const day = date.toISOString().slice(0, 10);
      const bucket = buckets.get(day) ?? {
        day,
        driving: 0,
        charging: 0,
        idle: 0,
        sleeping: 0,
      };
      const target = row.to_state;
      if (target === 'driving') bucket.driving += 1;
      else if (target === 'charging') bucket.charging += 1;
      else if (target === 'idle' || target === 'online' || target === 'parked') bucket.idle += 1;
      else if (target === 'sleeping' || target === 'asleep' || target === 'offline') bucket.sleeping += 1;
      buckets.set(day, bucket);
    }
    return Array.from(buckets.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [transitions]);

  // Derive summary metrics from the raw summary rows
  const summaryByState = useMemo(() => {
    const m: Record<string, {transitionCount: number; totalSeconds: number; percentage: number}> = {};
    for (const row of summaryRows) {
      m[row.state] = {
        transitionCount: row.transition_count,
        totalSeconds: row.total_seconds,
        percentage: row.percentage,
      };
    }
    return m;
  }, [summaryRows]);

  const totalTransitions = summaryRows.reduce((s, r) => s + (r.transition_count ?? 0), 0);
  const drivingSec = summaryByState.driving?.totalSeconds ?? 0;
  const chargingSec = summaryByState.charging?.totalSeconds ?? 0;
  const idleSec = (summaryByState.online?.totalSeconds ?? 0) +
    (summaryByState.parked?.totalSeconds ?? 0) +
    (summaryByState.idle?.totalSeconds ?? 0);
  const sleepingSec = (summaryByState.asleep?.totalSeconds ?? 0) +
    (summaryByState.sleeping?.totalSeconds ?? 0) +
    (summaryByState.offline?.totalSeconds ?? 0);

  /* ─── Table columns ─── */

  const columns = useMemo<Column<TransitionRow>[]>(
    () => [
      {
        key: 'ts',
        header: t('timeline.time', 'Time'),
        sortable: true,
        render: (row) => (
          <AppText style={styles.cellSm}>{formatDateTime(row.ts)}</AppText>
        ),
      },
      {
        key: 'from_state',
        header: t('timeline.fromState', 'From State'),
        sortable: true,
        render: (row) => (
          <Badge variant={STATE_BADGE[row.from_state] ?? 'neutral'} size="sm">
            {row.from_state}
          </Badge>
        ),
      },
      {
        key: 'to_state',
        header: t('timeline.toState', 'To State'),
        sortable: true,
        render: (row) => (
          <Badge variant={STATE_BADGE[row.to_state] ?? 'neutral'} size="sm">
            {row.to_state}
          </Badge>
        ),
      },
      {
        key: 'duration',
        header: t('timeline.duration', 'Duration'),
        sortable: false,
        render: (row) => {
          /* Duration in row.to_state = (next transition or now) - row.ts.
           * The newest row uses `now` so the user sees the live age of
           * the current state. */
          const start = new Date(row.ts).getTime();
          const end = row.next_ts ? new Date(row.next_ts).getTime() : Date.now();
          if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
            return <AppText style={styles.cellMuted}>—</AppText>;
          }
          return (
            <AppText style={styles.cellDuration}>
              {formatDurationFromSeconds((end - start) / 1000)}
            </AppText>
          );
        },
      },
      {
        key: 'trigger_field',
        header: t('timeline.trigger', 'Trigger'),
        sortable: true,
        render: (row) => (
          <AppText style={styles.cellTrigger} tone="secondary">
            {row.trigger_field ?? '—'}
          </AppText>
        ),
      },
    ],
    [t],
  );

  /* ─── Actions (vehicle selector + refresh) ─── */

  const vehicleOptions = vehicles.map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  const actions = (
    <View style={styles.actionsRow}>
      {vehicles.length > 0 && (
        <Select
          options={vehicleOptions}
          value={activeId}
          onChange={onPickVehicle}
          placeholder={t('timeline.selectVehicle', 'Select Vehicle')}
        />
      )}
      <RangePicker
        value={{start, end}}
        onChange={(r) => setRange(r)}
        presetIds={['today', 'yesterday', '7d', '30d', '90d', 'mtd', 'ytd']}
        presetsOnly
        align="end"
        triggerTestId="timeline-range"
      />
      <DataFreshnessAuto query={timelineQuery} />
      <Button
        variant="ghost"
        onPress={() => refetch()}
        accessibilityLabel={t('common.refresh', 'Refresh')}>
        <Glyph style={styles.refreshGlyph}>↻</Glyph>
      </Button>
    </View>
  );

  return (
    <PageContainer
      title={t('timeline.title', 'Timeline')}
      subtitle={t('timeline.subtitle', 'Vehicle state history and transitions')}
      actions={actions}
      loading={isLoading && transitions.length === 0}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {anyError && (
          <AlertBanner variant="danger" icon="⚠️">
            {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(anyError)}`}
          </AlertBanner>
        )}

        {/* Summary metric cards */}
        <FadeIn>
          <View style={styles.metricsGrid}>
            <View style={styles.metricItem}>
              <MetricCard
                label={t('timeline.totalTransitions', 'Total Transitions')}
                value={totalTransitions}
                icon="⇄"
              />
            </View>
            <View style={styles.metricItem}>
              <MetricCard
                label={t('timeline.drivingTime', 'Driving Time')}
                value={formatHoursFromSeconds(drivingSec)}
                icon="🚗"
                color="green"
              />
            </View>
            <View style={styles.metricItem}>
              <MetricCard
                label={t('timeline.chargingTime', 'Charging Time')}
                value={formatHoursFromSeconds(chargingSec)}
                icon="🔋"
                color="cyan"
              />
            </View>
            <View style={styles.metricItem}>
              <MetricCard
                label={t('timeline.idleSleepTime', 'Idle / Sleep Time')}
                value={formatHoursFromSeconds(idleSec + sleepingSec)}
                icon="🌙"
              />
            </View>
          </View>
        </FadeIn>

        {/* State timeline bar — proportional state distribution from summary */}
        <FadeIn delay={0.1}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.panelTitle} weight="semibold">
              {t('timeline.stateTimeline', 'State Distribution')}
            </AppText>
            {summaryRows.length === 0 || totalSeconds === 0 ? (
              sumLoading ? (
                <Skeleton height={32} />
              ) : (
                <EmptyState
                  /* no-action: transient empty state — surfaces when no recent state activity exists for the vehicle */
                  icon="🕐"
                  message={t('timeline.noStateData', 'No state distribution available yet')}
                />
              )
            ) : (
              <View style={styles.distributionBar}>
                {summaryRows.map((row) => {
                  const pct = totalSeconds > 0
                    ? (row.total_seconds / totalSeconds) * 100
                    : 0;
                  if (pct < 0.3) return null;
                  return (
                    <View
                      key={row.state}
                      accessibilityLabel={`${row.state}: ${formatDurationFromSeconds(row.total_seconds)} (${fmtPercent(row.percentage, 1)})`}
                      accessibilityRole="image"
                      style={{
                        width: `${pct}%`,
                        backgroundColor:
                          STATE_COLORS[row.state] ?? STATE_COLORS.offline,
                      }}
                    />
                  );
                })}
              </View>
            )}
            <View style={styles.legendRow}>
              {Object.entries(STATE_COLORS).map(([state, color]) => (
                <View key={state} style={styles.legendItem}>
                  <View style={[styles.legendDot, {backgroundColor: color}]} />
                  <AppText style={styles.legendLabel} tone="secondary" variant="caption">
                    {state}
                  </AppText>
                </View>
              ))}
            </View>
          </GlassPanel>
        </FadeIn>

        {/* Daily breakdown — stacked transition counts per day, grouped
            into the four high-level state buckets shown in the legend. */}
        <FadeIn delay={0.2}>
          <GlassPanel style={styles.panel}>
            <View style={styles.panelTitleRow}>
              <Glyph style={styles.panelTitleGlyph}>📊</Glyph>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('timeline.dailyBreakdown', 'Daily Breakdown')}
              </AppText>
            </View>
            {dailyBreakdown.length === 0 ? (
              tlLoading ? (
                <Skeleton height={220} />
              ) : (
                <EmptyState
                  /* no-action: transient empty state — surfaces when no transitions exist in the lookback window */
                  icon="📊"
                  message={t('timeline.noDailyData', 'No daily transition activity yet')}
                />
              )
            ) : (
              <View>
                {/* Source recharts stacked BarChart — structurally faithful; the
                    native charts barrel renders an accessible placeholder, so the
                    per-day stacked-bar summary below carries the same counts
                    (chart-a11y:no-table). */}
                <View style={styles.chartBox}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="day" tick={{fill: 'var(--text-muted)', fontSize: 10}} />
                      <YAxis tick={{fill: 'var(--text-muted)', fontSize: 10}} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{fontSize: 12}} />
                      <Bar dataKey="driving" name={t('timeline.driving', 'Driving')} stackId="a" fill={STATE_COLORS.driving} fillOpacity={0.85} />
                      <Bar dataKey="charging" name={t('timeline.charging', 'Charging')} stackId="a" fill={STATE_COLORS.charging} fillOpacity={0.85} />
                      <Bar dataKey="idle" name={t('timeline.idle', 'Idle')} stackId="a" fill={STATE_COLORS.idle} fillOpacity={0.85} />
                      <Bar dataKey="sleeping" name={t('timeline.sleeping', 'Sleeping')} stackId="a" fill={STATE_COLORS.sleeping} fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </View>
                <View style={styles.dailyList}>
                  {dailyBreakdown.map((row) => {
                    const total = row.driving + row.charging + row.idle + row.sleeping;
                    return (
                      <View key={row.day} style={styles.dailyRow}>
                        <AppText style={styles.dailyDay} tone="muted" variant="caption">
                          {row.day}
                        </AppText>
                        <View style={styles.dailyBar}>
                          {DAILY_BUCKETS.map((bucket) => {
                            const count = row[bucket.key];
                            if (count <= 0) return null;
                            const pct = total > 0 ? (count / total) * 100 : 0;
                            return (
                              <View
                                key={bucket.key}
                                accessibilityLabel={`${bucket.key}: ${fmtInt(count)}`}
                                accessibilityRole="image"
                                style={{width: `${pct}%`, backgroundColor: bucket.color}}
                              />
                            );
                          })}
                        </View>
                        <AppText style={styles.dailyCount} tone="secondary" variant="caption">
                          {fmtInt(total)}
                        </AppText>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </GlassPanel>
        </FadeIn>

        {/* State transitions table */}
        <FadeIn delay={0.3}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.panelTitle} weight="semibold">
              {t('timeline.stateTransitions', 'State Transitions')}
            </AppText>
            <DataTable
              tableId="analytics:timeline-transitions"
              columns={columns}
              data={transitions}
              keyExtractor={(row) => row.index}
              emptyMessage={t('timeline.noTransitions', 'No state transitions recorded')}
              pagination
            />
          </GlassPanel>
        </FadeIn>
      </ScrollView>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  alert: {
    alignItems: 'flex-start',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  alertIcon: {
    fontSize: 18,
    lineHeight: 22,
  },
  alertText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  cellDuration: {
    color: colors.textPrimary,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  cellMuted: {
    color: colors.textMuted,
    fontSize: 12,
  },
  cellSm: {
    fontSize: 14,
  },
  cellTrigger: {
    fontSize: 12,
  },
  chartBox: {
    height: 224,
    marginBottom: spacing.md,
  },
  dailyBar: {
    borderRadius: 6,
    flex: 1,
    flexDirection: 'row',
    height: 12,
    overflow: 'hidden',
  },
  dailyCount: {
    minWidth: 28,
    textAlign: 'right',
  },
  dailyDay: {
    minWidth: 64,
  },
  dailyList: {
    gap: spacing.sm,
  },
  dailyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  distributionBar: {
    borderRadius: 16,
    flexDirection: 'row',
    height: 32,
    overflow: 'hidden',
  },
  emptyIcon: {
    fontSize: 30,
    marginBottom: spacing.sm,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  ghostButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  ghostButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  legendDot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendLabel: {
    textTransform: 'capitalize',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.md,
  },
  metricIcon: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  metricIconGlyph: {
    fontSize: 18,
  },
  metricItem: {
    flexBasis: 150,
    flexGrow: 1,
    minWidth: 150,
  },
  metricLabel: {
    fontSize: 11,
  },
  metricRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  metricTextBlock: {
    flex: 1,
    gap: 2,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  panel: {
    padding: spacing.md,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  panelTitleGlyph: {
    color: colors.accent,
    fontSize: 14,
  },
  panelTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  rangeChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  rangeChipGlyph: {
    fontSize: 12,
  },
  rangeChipText: {
    color: colors.textPrimary,
    maxWidth: 180,
  },
  refreshGlyph: {
    color: colors.textSecondary,
    fontSize: 18,
  },
  scrollContent: {
    gap: 24,
    paddingBottom: spacing.xl,
  },
  selectChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  selectChipGlyph: {
    fontSize: 12,
  },
  selectChipText: {
    color: colors.textPrimary,
    maxWidth: 160,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    width: '100%',
  },
});
