// Native parity port of web/src/features/battery/pages/SleepEfficiencyPage.tsx.
//
// `SleepEfficiencyPage` analyses a vehicle's sleep patterns, vampire drain, and
// Sentry-mode cost. It resolves the active vehicle, derives a date window from a
// canonical range picker, fetches `/analytics/sleep?vehicle_id={id}&days={n}
// &start={s}&end={e}` (query key `['sleep-efficiency', vehicleId, days, start,
// end]`, enabled only when a vehicle is selected) via `useSleepEfficiency`, and
// renders four key MetricCards, a state-distribution donut, a Sentry-vs-no-Sentry
// comparison bar chart, a monthly Sentry-impact callout, and a recent-drain-events
// table. Every state name (`t`, `unitPrefs`, `formatCurrency`,
// `toTemperatureDisplay`, `tempUnit`, `vehicleId`, `vehicleIdStr`, `start`/`end`/
// `setRange`, `days`, `sleepQuery`, `sleep`/`isLoading`/`error`, `pieData`,
// `sentryOn`/`sentryOff`, `comparisonData`, `recentEvents`, `drainColumns`), the
// API path + query gating, the unit handling, and every i18n key are preserved
// verbatim from the source. `STATE_COLORS` and `STATE_LABELS` are byte-identical.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4/5/6/7):
//   - react-i18next `useTranslation` (L2) -> a native i18n shim. i18next returns
//     the KEY when no translation/fallback exists, so the shim resolves
//     `t(key)` -> key and `t(key, 'English')` -> the English fallback (no catalog
//     ships in apps/native, so inline English copy shows). Used identically by the
//     DataTable / BatteryCellsPage ports.
//   - lucide-react icons (L3: Moon/Eye/Clock/Zap/DollarSign/Thermometer) are SVG
//     with no native analog -> decorative emoji glyphs via the local `Glyph`
//     (accessibilityElementsHidden); the adjacent label always carries the meaning.
//   - `PageContainer` from @/components/layout (L4) -> the web-parity layout
//     PageContainer (reused; `title`/`subtitle`/`loading`/`error`/`actions` match).
//   - `GlassPanel`/`DataTable`/`Badge`/`Column` from @/components/ui (L5):
//     GlassPanel -> the shared native GlassPanel; DataTable/Badge/Column -> the
//     web-parity ui ports (reused 1:1 — the table keeps tableId/columns/data/
//     keyExtractor/emptyMessage/compact/pagination).
//   - `RangePicker`/`VehicleSelect` from @/components/forms (L6) have no native
//     parity port -> local read-only chips (`RangePicker` shows the resolved
//     start->end window; `VehicleSelect` shows the resolved vehicle name).
//     Interactive calendar selection + vehicle switching are UNAVAILABLE on native
//     (documented in the sidecar); the page still resolves scope via the hooks so
//     the data flow is preserved.
//   - `MetricCard`/`DataFreshnessAuto` from @/components/data-display (L7):
//     DataFreshnessAuto -> the web-parity port (reused 1:1); MetricCard -> a local
//     component mirroring the web public API (label/value/icon/color/help) because
//     the native shell has no equivalent. The web NeonColor set maps to the SI
//     palette (cyan->accent, green->success, amber->warning, purple->violet,
//     red->danger); only the icon chip is tinted, the value stays text-primary
//     (exactly like the web MetricCard). The web `help` HelpTooltip becomes the
//     card's accessibilityHint (resolved via the i18n shim) so the help i18n keys
//     + copy are preserved without a hover-only affordance.
//   - `EmptyState` from @/components/feedback (L8) -> a local component mirroring
//     the web API (`{ message, icon? }`): centred muted message with an optional
//     decorative glyph. The shared native EmptyState requires a `title` the source
//     never supplies, so a faithful message-only shim is used instead.
//   - `FadeIn`/`StaggerContainer`/`StaggerItem` from @/components/motion (L9) ->
//     the web-parity motion barrel (reused). StaggerContainer renders a plain
//     native column with no style hook, so the Tailwind `grid grid-cols-2
//     lg:grid-cols-4` is UNAVAILABLE on native; the four metric cards render as a
//     full-width vertical stagger stack (documented).
//   - every chart primitive + helper from @/components/charts (L10-14):
//     PieChart/Pie/Cell/BarChart/Bar/XAxis/YAxis/Tooltip/ResponsiveContainer/
//     Legend/ChartContainer/ChartTooltip/chartGrid/axisTick -> the web-parity
//     charts barrel, which preserves the Recharts public API while rendering
//     React-Native-safe placeholders (no Recharts/SVG/DOM). The recharts JSX is
//     kept structurally faithful; leaf primitives render accessible "unavailable"
//     placeholders. Per-state legend + the Sentry callout below each chart carry
//     the numbers in accessible text (the source's `chart-a11y:no-table` intent).
//   - `CHART_COLORS` from @/lib/colors (L15) -> the web-parity charts barrel
//     CHART_COLORS, which is the identical Okabe-Ito CB-safe palette
//     (CHART_COLORS[0] === '#0072B2'), so the donut fallback colour is byte-equal.
//   - `usePageTitle` (L16) -> a documented native-safe no-op (no DOM document.title;
//     the translated title still flows into PageContainer's header).
//   - `useUnits` (L17) -> a local temperature-only shim (the only surface this page
//     reads): `unitPrefs.temperature` derived from `unit_of_temp` (`'F' -> '°F'`).
//   - `useFormatting` (L18) -> a local shim exposing `formatCurrency(amount,
//     decimals?)` derived from `settings.currency_symbol` + `decimal_precision`,
//     byte-identical to the web helper.
//   - `useSelectedVehicle` (L19) -> a local first-vehicle native shim (URL
//     path/query + persisted-store selection is UNAVAILABLE on native).
//   - `useRangeState` (L20) -> a local native-safe shim: holds the {start,end}
//     window in component state, defaulting to the `'30d'` preset (today-29 ..
//     today, ISO yyyy-mm-dd) exactly as the web preset resolves. URL sync +
//     localStorage persistence are UNAVAILABLE on native (documented); `setRange`
//     still updates state for source compatibility.
//   - `useSleepEfficiency` from @/api/hooks/useEnergy (L21) + the `SleepDrainEvent`
//     type from @/types/energy (L24) -> the web-parity useEnergy hook + its
//     re-exported `SleepDrainEvent`/`SleepEfficiencyData` (reused 1:1).
//   - `formatDateShort`/`formatTime` from @/lib/dateFormat (L22) and `fmtNumber`/
//     `fmtInt` (+ `safeNumber`) from @/lib/numberFormat (L23) -> inlined verbatim
//     so rendered strings are byte-identical (native lib/format.ts diverges).
//   - `convertTempFromSI` from @/lib/unitConversion (L25) -> inlined verbatim.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported. Tailwind maps to StyleSheet: the `grid-cols-1
// lg:grid-cols-2` chart row resolves mobile-first to a flex-wrap row (each cell
// flexBasis 100% / minWidth 280 -> stacks on phones, side-by-side on wide
// screens); `p-4`/`p-6`/`p-8` -> panel padding 16/24/32; the amber Sentry callout
// keeps its tint via rgba literals; the `--text-primary/secondary/muted` tokens ->
// colors.text*; the long page body is wrapped in a ScrollView so every section
// stays reachable.

import React, {useMemo} from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useSettings} from '../../../api/hooks/useSettings';
import {
  useSleepEfficiency,
  type SleepDrainEvent,
} from '../../../api/hooks/useEnergy';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {PageContainer} from '../../../components/layout/PageContainer';
import {DataFreshnessAuto} from '../../../components/data-display/DataFreshness';
import {FadeIn, StaggerContainer, StaggerItem} from '../../../components/motion';
import {Badge} from '../../../components/ui/Badge';
import {DataTable, type Column} from '../../../components/ui/DataTable';
import {
  axisTick,
  Bar,
  BarChart,
  Cell,
  ChartContainer,
  ChartTooltip,
  chartGrid,
  CHART_COLORS,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '../../../components/charts';

/* ── i18n shim ─────────────────────────────────────────────────── */
// react-i18next has no native parity module. i18next resolves a missing
// translation to the KEY, so: `t(key)` -> key; `t(key, 'English')` -> 'English'.
type TParams = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, params?: TParams) => string;

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = params[token];
    return value == null ? match : String(value);
  });
}

const translate: TFunc = (key, fallback, params) =>
  interpolate(typeof fallback === 'string' ? fallback : key, params);

function useTranslation(): {t: TFunc} {
  return {t: translate};
}

/* ── usePageTitle shim ─────────────────────────────────────────── */
// The web hook writes `document.title`; native has no DOM document, so this is a
// documented native-safe no-op. The translated title is still computed at the call
// site and rendered by PageContainer as the on-screen header.
function usePageTitle(title: string): void {
  React.useEffect(() => {
    return undefined;
  }, [title]);
}

/* ── numberFormat (inlined from web @/lib/numberFormat) ────────── */
// `safeNumber` collapses non-finite/non-number values to 0; `fmtNumber` is the
// locale-aware fixed-precision formatter (default precision 2); `fmtInt` is
// `fmtNumber(v, 0)`.
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

/* ── dateFormat (inlined from web @/lib/dateFormat) ────────────── */
// Both formatters return the universal "—" placeholder for unrenderable input,
// matching the web contract. `formatDateShort` -> "Apr 4"; `formatTime` -> the
// locale 2-digit hour:minute (24h or AM/PM by locale).
function formatDateShort(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

/* ── unitConversion (inlined from web @/lib/unitConversion) ────── */
type TemperatureUnitPref = '°C' | '°F';

function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

/* ── useUnits shim (temperature only — the surface this page uses) ── */
// Mirrors the web `useUnits` temperature bridge: derive `unitPrefs.temperature`
// from the user's `unit_of_temp` setting. The page only reads
// `unitPrefs.temperature`, so the other formatters are intentionally omitted.
function useUnits(): {unitPrefs: {temperature: TemperatureUnitPref}} {
  const {data: settings} = useSettings();
  const temperature = deriveTemperature(settings?.unit_of_temp);
  return useMemo(() => ({unitPrefs: {temperature}}), [temperature]);
}

/* ── useFormatting shim (formatCurrency — the surface this page uses) ── */
// Mirrors the web `useFormatting.formatCurrency`: `${currencySymbol}${fmtNumber(
// amount, decimals ?? userPrecision)}`. `currencySymbol` defaults to '$';
// `userPrecision` defaults to 2 (a floored, non-negative `decimal_precision`).
function useFormatting(): {
  formatCurrency: (amount: number, decimals?: number) => string;
} {
  const {data: settings} = useSettings();
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;

  return useMemo(
    () => ({
      formatCurrency: (amount: number, decimals?: number) => {
        const d = decimals ?? userPrecision;
        return `${currencySymbol}${fmtNumber(amount, d)}`;
      },
    }),
    [currencySymbol, userPrecision],
  );
}

/* ── useSelectedVehicle shim (native-safe; first vehicle in the fleet) ── */
// The web hook resolves URL path/query > persisted store > first vehicle. Native
// has no DOM URL and no cross-page selected-vehicle store, so selection falls back
// to the first vehicle in the fleet. The VehicleSelect chip is non-interactive on
// native (documented in the sidecar).
function useSelectedVehicle(): {vehicleId: number | null} {
  const {data: vehicles} = useVehicles();
  const vehicleId = vehicles && vehicles.length > 0 ? vehicles[0].id : null;
  return {vehicleId};
}

/* ── useRangeState shim (native-safe; in-state {start,end} window) ── */
// The web hook syncs the range to the URL + localStorage and resolves named
// presets. Native has no DOM URL or localStorage, so both are UNAVAILABLE; the
// shim holds the window in component state, defaulting to the `'30d'` preset
// (today-29 .. today) exactly as the web preset resolves. `setRange` still updates
// state for source compatibility. `persistKey`/`defaultPresetId` are accepted but
// the default window is always the documented 30-day window this page requests.
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
  s.setDate(s.getDate() - 29);
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
function Glyph({
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

/* ── Local MetricCard (web @/components/data-display MetricCard) ── */
// Mirrors the web MetricCard public API. The web NeonColor maps to the SI palette;
// only the icon chip is tinted (the value stays text-primary, as on the web). The
// web `help` HelpTooltip becomes the card's accessibilityHint.
type MetricColor = 'cyan' | 'green' | 'amber' | 'purple' | 'red';

const METRIC_TINT: Record<MetricColor, string> = {
  cyan: colors.accent,
  green: colors.success,
  amber: colors.warning,
  purple: colors.violet,
  red: colors.danger,
};

interface MetricHelp {
  i18nKey: string;
  defaultValue: string;
}

function MetricCard({
  label,
  value,
  icon,
  color = 'cyan',
  help,
}: {
  label: string;
  value: string | number;
  icon?: string;
  color?: MetricColor;
  help?: MetricHelp;
}) {
  const tint = METRIC_TINT[color];
  return (
    <View
      accessibilityHint={help ? translate(help.i18nKey, help.defaultValue) : undefined}
      style={styles.metricCard}>
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

/* ── Local RangePicker (web @/components/forms RangePicker) ────── */
// Read-only on native: shows the resolved start->end window. Interactive calendar
// selection is UNAVAILABLE (documented in the sidecar); `onChange`/`align` are
// accepted for source compatibility.
function RangePicker({
  value,
  triggerTestId,
}: {
  value: RangeValue;
  onChange?: (range: RangeValue) => void;
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

/* ── Local VehicleSelect (web @/components/forms VehicleSelect) ── */
// Read-only on native: shows the resolved vehicle name. Interactive selection is
// UNAVAILABLE (documented in the sidecar).
function VehicleSelect({ariaLabel}: {ariaLabel?: string}) {
  const {data: vehicles} = useVehicles();
  const {vehicleId} = useSelectedVehicle();
  const name =
    vehicles?.find(v => v.id === vehicleId)?.display_name ??
    translate('All Vehicles');
  return (
    <View accessibilityLabel={ariaLabel} accessibilityRole="text" style={styles.vehicleChip}>
      <Glyph style={styles.vehicleChipGlyph}>🚗</Glyph>
      <AppText
        numberOfLines={1}
        style={styles.vehicleChipText}
        variant="caption"
        weight="semibold">
        {name}
      </AppText>
    </View>
  );
}

/* ── Constants ── */

const STATE_COLORS: Record<string, string> = {
  asleep: '#a855f7',
  online: '#00f0ff',
  driving: '#10b981',
  charging: '#f59e0b',
  updating: '#ec4899',
  suspended: '#6366f1',
};

/* ── Component ── */

export default function SleepEfficiencyPage() {
  const {t} = useTranslation();
  usePageTitle(t('sleep.title', 'Sleep Efficiency'));
  const {unitPrefs} = useUnits();
  const {formatCurrency} = useFormatting();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;

  const {vehicleId} = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;

  // Date range — canonical RangePicker. The backend handler now accepts
  // explicit start/end (YYYY-MM-DD) so historical presets like
  // `yesterday`/`lastMonth` and custom calendar picks return the actual
  // chosen window. The derived `days` count is still passed for
  // backward-compat with older API builds and used internally by the
  // backend to populate `period_days` in the response.
  const {start, end, setRange} = useRangeState({
    persistKey: 'sleep-efficiency.range',
    defaultPresetId: '30d',
  });
  const days = useMemo(() => {
    if (!start || !end) {
      return 30;
    }
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T00:00:00`).getTime();
    const diff = Math.round((endMs - startMs) / 86_400_000) + 1;
    return Math.max(1, diff);
  }, [start, end]);

  const sleepQuery = useSleepEfficiency(vehicleIdStr, days, start, end);
  const {data: sleep, isLoading, error} = sleepQuery;

  /* ── Derived data ── */

  const pieData = useMemo(
    () =>
      (sleep?.state_distribution ?? []).map(s => ({
        name: STATE_LABELS[s.state] ?? s.state,
        value: Math.round(s.total_minutes),
        color: STATE_COLORS[s.state] ?? CHART_COLORS[0],
        hours: fmtNumber(s.total_minutes / 60),
      })),
    [sleep?.state_distribution],
  );

  const sentryOn = sleep?.sentry_comparison?.find(s => s.sentry_mode);
  const sentryOff = sleep?.sentry_comparison?.find(s => !s.sentry_mode);

  const comparisonData = useMemo(
    () => [
      {
        name: t('sleep.drainRate', 'Drain Rate (%/hr)'),
        sentry_on: sentryOn?.avg_drain_rate ?? 0,
        sentry_off: sentryOff?.avg_drain_rate ?? 0,
      },
      {
        name: t('sleep.avgBatteryLost', 'Avg Battery Lost (%)'),
        sentry_on: sentryOn?.avg_battery_lost ?? 0,
        sentry_off: sentryOff?.avg_battery_lost ?? 0,
      },
    ],
    [sentryOn, sentryOff, t],
  );

  const recentEvents = sleep?.recent_events ?? [];

  /* ── Drain events table columns ── */

  const drainColumns: Column<SleepDrainEvent>[] = useMemo(
    () => [
      {
        key: 'date',
        header: t('sleep.date', 'Date'),
        render: event => (
          <AppText variant="caption">
            {formatDateShort(event.start_date)}
            <AppText tone="muted" variant="caption">
              {` ${formatTime(event.start_date)}`}
            </AppText>
          </AppText>
        ),
      },
      {
        key: 'duration',
        header: t('sleep.duration', 'Duration'),
        render: event => `${fmtNumber(event.duration_hours)}h`,
      },
      {
        key: 'batteryLost',
        header: t('sleep.batteryLost', 'Battery Lost'),
        render: event => (
          <AppText style={styles.roseText}>
            {`${fmtNumber(event.battery_lost)}%`}
          </AppText>
        ),
      },
      {
        key: 'drainRate',
        header: t('sleep.drainRateCol', 'Drain Rate'),
        render: event => (
          <AppText
            style={event.drain_rate > 1.5 ? styles.roseText : styles.emeraldText}>
            {`${fmtNumber(event.drain_rate)}%/hr`}
          </AppText>
        ),
      },
      {
        key: 'sentry',
        header: t('sleep.sentry', 'Sentry'),
        render: event =>
          event.sentry_mode ? (
            <Badge size="sm" variant="warning">
              {`👁 ${t('common.on', 'On')}`}
            </Badge>
          ) : (
            <Badge size="sm" variant="info">
              {`🌙 ${t('common.off', 'Off')}`}
            </Badge>
          ),
      },
      {
        key: 'temp',
        header: t('sleep.temp', 'Temp'),
        render: event =>
          event.outside_temp != null ? (
            <View style={styles.tempCell}>
              <Glyph style={styles.tempCellGlyph}>🌡</Glyph>
              <AppText>
                {`${fmtNumber(toTemperatureDisplay(event.outside_temp))}${tempUnit}`}
              </AppText>
            </View>
          ) : (
            <AppText tone="muted">—</AppText>
          ),
      },
    ],
    // Dep array preserved verbatim from the source (`[t]`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  return (
    <PageContainer
      title={t('sleep.title', 'Sleep Efficiency')}
      subtitle={t(
        'sleep.subtitle',
        'Analyze vehicle sleep patterns, vampire drain, and sentry mode costs',
      )}
      loading={isLoading}
      error={error instanceof Error ? error : null}
      actions={
        <View style={styles.actions}>
          <VehicleSelect ariaLabel={t('sleep.selectVehicle', 'Select vehicle')} />
          <RangePicker
            value={{start, end}}
            onChange={setRange}
            align="end"
            triggerTestId="sleep-efficiency-range"
          />
          <DataFreshnessAuto query={sleepQuery} />
        </View>
      }>
      <ScrollView contentContainerStyle={styles.body}>
        {sleep ? (
          <>
            {/* Key metric cards */}
            <StaggerContainer>
              <StaggerItem>
                <MetricCard
                  icon="🌙"
                  label={t('sleep.efficiency', 'Sleep Efficiency')}
                  value={`${fmtNumber(sleep.sleep_efficiency_pct)}%`}
                  color="purple"
                  help={{
                    i18nKey: 'help.sleepEfficiency.body',
                    defaultValue:
                      'Share of parked time the car spent in true low-power sleep (vs. idle/online). Higher is better — more sleep means less vampire drain and lower battery wear.',
                  }}
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  icon="⏱"
                  label={t('sleep.avgTimeToSleep', 'Avg Time to Sleep')}
                  value={`${fmtInt(sleep.time_to_sleep_avg_min)} min`}
                  color="cyan"
                  help={{
                    i18nKey: 'help.sleepEfficiency.timeToSleep',
                    defaultValue:
                      'Average minutes from when the car parks to when it enters low-power sleep.',
                  }}
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  icon="👁"
                  label={t('sleep.sentryDrainRate', 'Sentry Drain Rate')}
                  value={`${fmtNumber(sleep.sentry_on_drain_rate)}%/hr`}
                  help={{
                    i18nKey: 'help.sleepEfficiency.sentryDrain',
                    defaultValue:
                      'Battery loss per hour while Sentry Mode is active. Sentry keeps cameras and computers on, which adds noticeable drain.',
                  }}
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  icon="💲"
                  label={t('sleep.sentryMonthlyCost', 'Sentry Monthly Cost')}
                  value={formatCurrency(sleep.sentry_monthly_cost)}
                  color="red"
                  help={{
                    i18nKey: 'help.sleepEfficiency.sentryCost',
                    defaultValue:
                      'Estimated monthly electricity cost of Sentry-related drain, using your configured per-kWh rate.',
                  }}
                />
              </StaggerItem>
            </StaggerContainer>

            {/* State Distribution Donut + Sentry Comparison */}
            <View style={styles.twoCol}>
              <View style={styles.twoColItem}>
                <FadeIn>
                  {/* chart-a11y:no-table state-share donut; per-state hours announced via the legend below the chart */}
                  <ChartContainer
                    title={t('sleep.stateDistribution', 'State Distribution')}
                    ariaLabel={t(
                      'sleep.stateDistribution.aria',
                      'State distribution donut chart with per-state hours in the legend',
                    )}
                    height={264}>
                    {pieData.length > 0 ? (
                      <>
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={55}
                              outerRadius={90}
                              paddingAngle={3}
                              dataKey="value"
                              nameKey="name"
                              animationDuration={800}>
                              {pieData.map((entry, i) => (
                                <Cell
                                  key={`cell-${i}`}
                                  fill={entry.color}
                                  stroke="transparent"
                                />
                              ))}
                            </Pie>
                            <Tooltip content={<ChartTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                        <View style={styles.legendRow}>
                          {pieData.map(entry => (
                            <View key={entry.name} style={styles.legendItem}>
                              <View
                                style={[
                                  styles.legendDot,
                                  {backgroundColor: entry.color},
                                ]}
                              />
                              <AppText style={styles.legendName} tone="secondary" variant="caption">
                                {entry.name}
                              </AppText>
                              <AppText style={styles.legendHours} tone="muted" variant="caption">
                                {`${entry.hours}h`}
                              </AppText>
                            </View>
                          ))}
                        </View>
                      </>
                    ) : (
                      <EmptyState
                        /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                        message={t(
                          'sleep.noStateData',
                          'No state distribution data available',
                        )}
                      />
                    )}
                  </ChartContainer>
                </FadeIn>
              </View>

              <View style={styles.twoColItem}>
                <FadeIn delay={0.1}>
                  <View style={styles.stack}>
                    {/* chart-a11y:no-table small comparison bar chart; numbers visible in the sentry callout below */}
                    <ChartContainer
                      title={t('sleep.sentryComparison', 'Sentry vs No-Sentry')}
                      ariaLabel={t(
                        'sleep.sentryComparison.aria',
                        'Sentry on versus sentry off drain comparison bar chart',
                      )}
                      height={224}>
                      {comparisonData.some(
                        d => d.sentry_on > 0 || d.sentry_off > 0,
                      ) ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={comparisonData}>
                            {chartGrid}
                            <XAxis
                              dataKey="name"
                              tick={axisTick}
                              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                            <Tooltip content={<ChartTooltip />} />
                            <Legend wrapperStyle={{fontSize: 11}} />
                            <Bar
                              dataKey="sentry_on"
                              name={t('sleep.sentryOn', 'Sentry On')}
                              fill="#f59e0b"
                              radius={[4, 4, 0, 0]}
                              animationDuration={800}
                            />
                            <Bar
                              dataKey="sentry_off"
                              name={t('sleep.sentryOff', 'Sentry Off')}
                              fill="#a855f7"
                              radius={[4, 4, 0, 0]}
                              animationDuration={800}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <EmptyState
                          /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                          message={t(
                            'sleep.noSentryData',
                            'No sentry comparison data available',
                          )}
                        />
                      )}
                    </ChartContainer>

                    {/* Sentry cost callout — outside ChartContainer to avoid overflow */}
                    <View style={styles.sentryCallout}>
                      <View style={styles.calloutHeader}>
                        <Glyph style={styles.calloutHeaderGlyph}>👁</Glyph>
                        <AppText style={styles.calloutHeaderText} weight="semibold">
                          {t(
                            'sleep.monthlySentryImpact',
                            'Monthly Sentry Mode Impact',
                          )}
                        </AppText>
                      </View>
                      <View style={styles.calloutGrid}>
                        <View style={styles.calloutCell}>
                          <AppText style={styles.calloutValueAmber} weight="bold">
                            {`${fmtNumber(sleep.sentry_extra_drain_rate)}%`}
                          </AppText>
                          <AppText style={styles.calloutLabel} tone="muted" variant="caption">
                            {t('sleep.extraDrainHr', 'Extra drain/hr')}
                          </AppText>
                        </View>
                        <View style={styles.calloutCell}>
                          <AppText style={styles.calloutValueAmber} weight="bold">
                            {`${fmtNumber(sleep.sentry_extra_monthly_kwh)} kWh`}
                          </AppText>
                          <AppText style={styles.calloutLabel} tone="muted" variant="caption">
                            {t('sleep.extraMonthly', 'Extra monthly')}
                          </AppText>
                        </View>
                        <View style={styles.calloutCell}>
                          <AppText style={styles.calloutValueRose} weight="bold">
                            {formatCurrency(sleep.sentry_extra_monthly_cost)}
                          </AppText>
                          <AppText style={styles.calloutLabel} tone="muted" variant="caption">
                            {t('sleep.extraCostMo', 'Extra cost/mo')}
                          </AppText>
                        </View>
                      </View>
                    </View>
                  </View>
                </FadeIn>
              </View>
            </View>

            {/* Recent drain events table */}
            <FadeIn delay={0.2}>
              <GlassPanel style={styles.panelPadLg}>
                <View style={styles.tableHeaderRow}>
                  <Glyph style={styles.tableHeaderGlyph}>⚡</Glyph>
                  <AppText style={styles.tableTitle} weight="semibold">
                    {t('sleep.recentDrainEvents', 'Recent Drain Events')}
                  </AppText>
                </View>
                {recentEvents.length > 0 ? (
                  <DataTable<SleepDrainEvent>
                    tableId="battery:sleep-drain-events"
                    columns={drainColumns}
                    data={recentEvents}
                    keyExtractor={event => event.id}
                    emptyMessage={t(
                      'sleep.noDrainEvents',
                      'No drain events recorded yet',
                    )}
                    compact
                    pagination
                  />
                ) : (
                  <EmptyState
                    message={t(
                      'sleep.noDrainEvents',
                      'No drain events recorded yet',
                    )}
                  />
                )}
              </GlassPanel>
            </FadeIn>
          </>
        ) : !isLoading ? (
          <GlassPanel style={styles.panelPadXl}>
            <EmptyState
              /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon="🌙"
              message={t(
                'sleep.noData',
                'No sleep data available. Data will appear after your vehicle records sleep/wake events.',
              )}
            />
          </GlassPanel>
        ) : null}
      </ScrollView>
    </PageContainer>
  );
}

/* ── State labels ── */

const STATE_LABELS: Record<string, string> = {
  asleep: 'Sleeping',
  online: 'Online/Idle',
  driving: 'Driving',
  charging: 'Charging',
  updating: 'Updating',
  suspended: 'Suspended',
};

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  body: {
    gap: 24,
    paddingBottom: spacing.xl,
  },
  /* metric cards (vertical stagger stack — the web grid className is inert) */
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  metricRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  metricTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
  },
  metricIcon: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  metricIconGlyph: {
    fontSize: 14,
  },
  /* two-column responsive chart row */
  twoCol: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  twoColItem: {
    flexBasis: '100%',
    flexGrow: 1,
    minWidth: 280,
  },
  stack: {
    gap: spacing.md,
  },
  /* donut legend */
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendDot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  legendName: {
    color: colors.textSecondary,
  },
  legendHours: {
    color: colors.textMuted,
  },
  /* sentry callout */
  sentryCallout: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  calloutHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  calloutHeaderGlyph: {
    color: '#fbbf24',
    fontSize: 14,
  },
  calloutHeaderText: {
    color: '#fcd34d',
    fontSize: 14,
  },
  calloutGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  calloutCell: {
    alignItems: 'center',
    flex: 1,
  },
  calloutValueAmber: {
    color: '#fbbf24',
    fontSize: 18,
  },
  calloutValueRose: {
    color: '#fda4af',
    fontSize: 18,
  },
  calloutLabel: {
    textAlign: 'center',
  },
  /* recent drain events table */
  panelPadLg: {
    padding: spacing.lg,
  },
  panelPadXl: {
    padding: spacing.xl,
  },
  tableHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tableHeaderGlyph: {
    color: colors.accent,
    fontSize: 14,
  },
  tableTitle: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  roseText: {
    color: '#fda4af',
  },
  emeraldText: {
    color: '#6ee7b7',
  },
  tempCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  tempCellGlyph: {
    color: colors.textMuted,
    fontSize: 12,
  },
  /* empty states */
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    color: colors.textMuted,
    fontSize: 36,
  },
  emptyMessage: {
    maxWidth: 360,
    textAlign: 'center',
  },
  /* header chips */
  vehicleChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  vehicleChipGlyph: {
    fontSize: 13,
  },
  vehicleChipText: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  rangeChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 240,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  rangeChipGlyph: {
    fontSize: 13,
  },
  rangeChipText: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
});
