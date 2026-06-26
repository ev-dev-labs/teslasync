// Native parity port of web/src/features/battery/pages/BatteryCellsPage.tsx.
//
// `BatteryCellsPage` is the per-vehicle cell-level battery surface. It resolves
// the active vehicle, fetches the cell pack snapshot (`/analytics/battery-cells
// ?vehicle_id={id}`, query key `['battery-cells', activeId]`, `enabled` only when
// a vehicle is selected), derives a voltage histogram, the min/max cells, a
// voltage-spread trend, a set of health insights, and a sortable cell table, then
// renders ten stacked sections (summary metrics, voltage heatmap, bar chart,
// distribution + imbalance trend, voltage-over-time, cell table, spread-trend
// area chart, temperature summary, health recommendations, summary stats). Every
// state name (`showHeatmap`/`setShowHeatmap`, `vehicleId`, `activeId`, `data`/
// `isLoading`/`error`, `histogram`, `minCell`, `maxCell`, `voltageSpreadTrend`,
// `insights`, `sortKey`/`sortDir`/`onSort`/`sortFn`, `sortedCells`, `columns`),
// the API path, query key + `enabled` gate, the unit handling, and every i18n key
// are preserved verbatim from the source.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4/5/6/7):
//   - react-i18next `useTranslation` (L2) -> a native i18n shim. i18next returns
//     the KEY when no translation/fallback exists, so the shim resolves
//     `t(key)` -> key, `t(key, 'English')` -> the English fallback, and the one
//     options-object call `t(key, { count, defaultValue })` -> `defaultValue`
//     with `{{count}}` interpolation (the DataTable/EventTimeline precedent). No
//     translation catalog ships in apps/native, so the inline English copy shows.
//   - lucide-react icons (L3-7: Battery/Cpu/Activity/TrendingDown/BarChart3/
//     Grid3x3/ArrowDownRight/ArrowUpRight/Minus/Thermometer/Zap/CheckCircle/
//     AlertTriangle/Shield/Info) are SVG with no native analog -> decorative
//     emoji/arrow glyphs via the local `Glyph` (accessibilityElementsHidden); the
//     adjacent label always carries the meaning, so each glyph is decorative.
//   - `PageContainer`/`Grid` from @/components/layout (L9): PageContainer -> the
//     web-parity layout PageContainer (reused; `loading`/`error`/`actions`/`title`/
//     `subtitle` match). Grid -> the local `GridRow` wrapping-row (the native shell
//     has no Grid); responsive `cols` resolve mobile-first to a flex-wrap row.
//   - `VehicleSelect` from @/components/forms (L10) is the global header vehicle
//     picker with no native parity port -> a local read-only `VehicleSelectChip`
//     showing the resolved vehicle name. Interactive selection is UNAVAILABLE on
//     native (documented in the sidecar); the page still resolves scope through
//     `useSelectedVehicle` so the data flow is preserved.
//   - `GlassPanel`/`Badge`/`Button`/`DataTable`/`Column`/`useSortToggle` from
//     @/components/ui (L11): GlassPanel -> shared native GlassPanel; Badge/DataTable/
//     useSortToggle/Column -> the web-parity ports (reused 1:1); Button -> a local
//     ghost `ToggleButton` (the native shell exports AppButton without an icon/size
//     slot, so the heatmap toggle keeps its glyph via a small Pressable).
//   - `MetricCard` from @/components/data-display (L12) -> a local `MetricCard`
//     mirroring the web API (label/value/icon/color) because the native shell's
//     MetricCard has a different contract (requires `helper`, only 3 tones, no
//     icon); the web NeonColor set maps to the SI palette
//     (cyan->accent, green->success, amber->warning, purple->violet, red->danger).
//   - all chart primitives + helpers from @/components/charts (L13-20):
//     ChartContainer/ChartTooltip/ChartGradient/chartGrid/axisTick/axisTickSm/
//     chartMargin/chartMarginLabeled/CHART_COLORS/renderAnnotationLines/BarChart/
//     Bar/LineChart/Line/AreaChart/Area/XAxis/YAxis/CartesianGrid/Tooltip/
//     ResponsiveContainer/Legend/ReferenceLine/AREA_DEFAULTS -> the web-parity
//     charts barrel, which preserves the Recharts public API while rendering
//     React-Native-safe placeholders (no Recharts/SVG/DOM). The recharts JSX is
//     kept structurally faithful (the DrivingSection precedent). The only DOM/SVG
//     element in the source, the `<defs>` wrapper around `<ChartGradient>` in the
//     spread-trend AreaChart, is dropped (SVG-only, forbidden by rule 4); the
//     `<ChartGradient>` is rendered directly as a native-inert gradient marker and
//     the `fill="url(#spreadGrad)"` reference is retained verbatim on the Area.
//   - `Skeleton`/`EmptyState` from @/components/feedback (L21): EmptyState -> the
//     shared native EmptyState (title + message, no icon slot — the web icon is
//     dropped, the web message becomes `message`, a section label becomes `title`);
//     Skeleton -> a local fixed-height placeholder View (no native shimmer module).
//   - `FadeIn` from @/components/motion (L22) -> the web-parity motion FadeIn
//     (reused; numeric `delay`).
//   - app hooks: `useSelectedVehicle` (L24) -> a local shim returning the first
//     vehicle in the fleet (URL path/query + persisted-store selection is
//     UNAVAILABLE on native — the SecurityAccessPage precedent); `usePageTitle`
//     (L25) -> a documented native-safe no-op (no DOM document.title; the
//     translated title still flows into PageContainer's header); `useUnits` (L26)
//     -> a local shim reading the web-parity `useSettings` and deriving the
//     temperature preference (`unit_of_temp === 'F' ? '°F' : '°C'`) + a
//     `formatTemperature(celsius, { precision })` that mirrors the lib
//     (SI Celsius -> display, `°C`/`°F`, no space before the degree unit).
//   - `formatDateTime` from @/lib/dateFormat (L27) and `fmtNumber` (+ `safeNumber`)
//     from @/lib/numberFormat (L28) -> inlined verbatim so rendered strings are
//     byte-identical (the native lib/format.ts variants diverge — no year, '-' vs
//     '—' — so they are intentionally NOT used).
//   - `cn` from @/lib/cn (L29) is a className combiner with no role under
//     StyleSheet -> dropped; conditional Tailwind classes become conditional style
//     objects / tones.
//   - `request` from @/api/client (L30) -> the reused web-parity api client.
//   - `useQuery` from @tanstack/react-query (L31) -> reused (native bundles it);
//     the inline battery-cells query is kept verbatim.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported. Tailwind maps to StyleSheet: the responsive metric/stat
// grids (`grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`, `grid-cols-1 md:grid-cols-2`,
// `cols={{default,sm,lg}}`) resolve mobile-first to flex-wrap rows (gap 16/12);
// `p-4`/`p-6` -> panel padding 16/24; `mb-2`/`mb-3`/`mb-4` -> 8/12/16; the
// `--text-secondary`/`--text-muted`/`--text-primary` tokens -> colors.text*; the
// long page body is wrapped in a ScrollView so the ten sections remain reachable.

import React, {useMemo, useState, type ReactNode} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {PageContainer} from '../../../components/layout/PageContainer';
import {FadeIn} from '../../../components/motion';
import {Badge, type BadgeVariant} from '../../../components/ui/Badge';
import {
  DataTable,
  useSortToggle,
  type Column,
} from '../../../components/ui/DataTable';
import {
  AREA_DEFAULTS,
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  CHART_COLORS,
  ChartContainer,
  ChartGradient,
  ChartTooltip,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  axisTickSm,
  chartGrid,
  chartMargin,
  chartMarginLabeled,
  renderAnnotationLines,
} from '../../../components/charts';

/* ── i18n shim ─────────────────────────────────────────────────── */
// react-i18next has no native parity module. i18next resolves a missing
// translation to the KEY, so: `t(key)` -> key; `t(key, 'English')` -> 'English';
// `t(key, { count, defaultValue })` -> defaultValue with `{{count}}` interpolated.
type TParams = Record<string, string | number>;
type TFallback = string | (TParams & {defaultValue?: string});
type TFunc = (key: string, fallback?: TFallback, params?: TParams) => string;

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = params[token];
    return value == null ? match : String(value);
  });
}

const translate: TFunc = (key, fallback, params) => {
  if (typeof fallback === 'string') {
    return interpolate(fallback, params);
  }
  if (fallback && typeof fallback === 'object') {
    return interpolate(fallback.defaultValue ?? key, fallback);
  }
  return interpolate(key, params);
};

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
// locale-aware fixed-precision formatter, defaulting to en-US on a bad tag.
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

/* ── dateFormat (inlined from web @/lib/dateFormat) ────────────── */
// "Apr 4, 2026, 03:00 PM" — the source relies on `.split(',')[0]` -> "Apr 4", so
// the year/comma layout is preserved exactly (the native lib/format.ts drops the
// year and is intentionally not reused).
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ── useUnits shim (temperature only — the surface this page uses) ── */
// Mirrors the web `useUnits` temperature bridge: derive the pref from the user's
// `unit_of_temp` setting and expose `formatTemperature(celsius, { precision })`
// (SI Celsius -> display value, no space before the degree unit) plus the stable
// `unitPrefs.temperature`. The page passes `{ precision: 1 }` everywhere; the
// default mirrors the lib temperature precision.
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

interface FormatOptions {
  precision?: number;
}

interface UseUnitsResult {
  unitPrefs: {temperature: TemperatureUnitPref};
  formatTemperature: (
    value: number | null | undefined,
    options?: FormatOptions,
  ) => string;
}

function useUnits(): UseUnitsResult {
  const {data: settings} = useSettings();
  const temperature = deriveTemperature(settings?.unit_of_temp);

  return useMemo<UseUnitsResult>(() => {
    return {
      unitPrefs: {temperature},
      formatTemperature: (value, options) => {
        if (typeof value !== 'number' || !isFinite(value)) {
          return '—';
        }
        const digits = options?.precision ?? 1;
        return `${fmtNumber(convertTempFromSI(value, temperature), digits)}${temperature}`;
      },
    };
  }, [temperature]);
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

/* ── Types ─────────────────────────────────────────────────────── */

interface CellReading {
  cell_id: number;
  voltage: number;
  delta_from_avg: number;
  status: 'normal' | 'low' | 'high' | 'critical';
}

interface HistoryPoint {
  timestamp: string;
  min_voltage: number;
  max_voltage: number;
  avg_voltage: number;
  imbalance_mv: number;
}

interface BatteryCellData {
  total_cells: number;
  avg_voltage: number;
  min_voltage: number;
  max_voltage: number;
  voltage_spread: number;
  imbalance_mv: number;
  pack_voltage: number;
  avg_temperature: number;
  min_temperature: number;
  max_temperature: number;
  temp_spread: number;
  cells: CellReading[];
  history: HistoryPoint[];
}

/* ── Helpers ───────────────────────────────────────────────────── */

/** Color a cell by how far it deviates from the pack average (mV). */
function cellColor(voltage: number, avg: number): string {
  const delta = Math.abs(voltage - avg) * 1000;
  if (delta < 5) {
    return '#10b981'; // green – nominal
  }
  if (delta < 15) {
    return '#f59e0b'; // amber – slight deviation
  }
  return '#ef4444'; // red   – significant deviation
}

function statusVariant(status: CellReading['status']): BadgeVariant {
  switch (status) {
    case 'normal':
      return 'success';
    case 'low':
      return 'warning';
    case 'high':
      return 'warning';
    case 'critical':
      return 'danger';
  }
}

/** lucide status icon mapped to a decorative native glyph. */
function statusIconGlyph(status: CellReading['status']): string {
  switch (status) {
    case 'low':
      return '↘';
    case 'high':
      return '↗';
    case 'critical':
      return '📉';
    default:
      return '−';
  }
}

/** Build a histogram of voltage distribution across buckets. */
function buildHistogram(cells: CellReading[]): {bucket: string; count: number}[] {
  if (cells.length === 0) {
    return [];
  }
  const voltages = cells.map(c => c.voltage);
  const min = Math.min(...voltages);
  const max = Math.max(...voltages);
  const range = max - min;
  const bucketCount = Math.max(6, Math.min(12, Math.ceil(cells.length / 4)));
  const step = range > 0 ? range / bucketCount : 0.001;

  const buckets = Array.from({length: bucketCount}, (_, i) => ({
    low: min + i * step,
    high: min + (i + 1) * step,
    count: 0,
  }));

  for (const v of voltages) {
    const idx = Math.min(Math.floor((v - min) / step), bucketCount - 1);
    buckets[idx].count += 1;
  }

  return buckets.map(b => ({
    bucket: `${fmtNumber(b.low ?? 0, 3)}–${fmtNumber(b.high ?? 0, 3)}`,
    count: b.count,
  }));
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
    <AppText accessibilityElementsHidden importantForAccessibility="no" style={style}>
      {children}
    </AppText>
  );
}

/* ── Local MetricCard (web @/components/data-display MetricCard) ── */
// Mirrors the web MetricCard public API. The web NeonColor maps to the SI palette;
// the icon renders as a tinted chip with a decorative glyph.
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
          <AppText numberOfLines={1} style={styles.metricLabel} tone="muted" variant="caption">
            {label}
          </AppText>
          <AppText style={styles.metricValue} weight="bold">
            {value}
          </AppText>
        </View>
        {icon ? (
          <View style={[styles.metricIcon, {borderColor: `${tint}55`, backgroundColor: `${tint}1f`}]}>
            <Glyph style={[styles.metricIconGlyph, {color: tint}]}>{icon}</Glyph>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ── Local Skeleton (web @/components/feedback Skeleton) ────────── */
// No native shimmer module; a fixed-height tinted placeholder preserves the
// loading slot the source reserved for each chart.
function Skeleton({height}: {height: number}) {
  return (
    <View
      accessibilityLabel={translate('Loading')}
      accessibilityRole="progressbar"
      style={[styles.skeleton, {height}]}
    />
  );
}

/* ── Local GridRow (web @/components/layout Grid) ──────────────── */
// The native shell has no Grid; responsive `cols` resolve mobile-first to a
// flex-wrap row. Children flex-grow with a min width so they wrap 2–3 per row.
function GridRow({children}: {children: ReactNode}) {
  return <View style={styles.gridRow}>{children}</View>;
}

/* ── Local ToggleButton (web @/components/ui Button, ghost+icon) ── */
function ToggleButton({
  glyph,
  label,
  onPress,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [styles.toggleBtn, pressed && styles.toggleBtnPressed]}>
      <Glyph style={styles.toggleBtnGlyph}>{glyph}</Glyph>
      <AppText style={styles.toggleBtnText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── Local VehicleSelectChip (web @/components/forms VehicleSelect) ── */
// Read-only on native: shows the resolved vehicle name. Interactive selection is
// UNAVAILABLE (documented in the sidecar).
function VehicleSelectChip() {
  const {data: vehicles} = useVehicles();
  const {vehicleId} = useSelectedVehicle();
  const name =
    vehicles?.find(v => v.id === vehicleId)?.display_name ??
    translate('All Vehicles');
  return (
    <View accessibilityRole="text" style={styles.vehicleChip}>
      <Glyph style={styles.vehicleChipGlyph}>🚗</Glyph>
      <AppText numberOfLines={1} style={styles.vehicleChipText} variant="caption" weight="semibold">
        {name}
      </AppText>
    </View>
  );
}

/* ── Heatmap Grid Component ────────────────────────────────────── */
// The web CSS `grid-template-columns: repeat(cols, 1fr)` maps to a flex-wrap row
// where each cell takes `100/cols` of the width. The CSS keyframe fade-in/pulse
// animations are dropped (no portable native analog); the per-cell `title` tooltip
// becomes the cell's accessibilityLabel.
function CellHeatmap({
  cells,
  avg,
  label,
}: {
  cells: CellReading[];
  avg: number;
  label: string;
}) {
  const {t} = useTranslation();
  const cols = Math.ceil(Math.sqrt(cells.length));
  const cellWidth = `${(100 / cols).toFixed(4)}%` as DimensionValue;

  return (
    <GlassPanel style={styles.panelPad}>
      <AppText style={styles.sectionLabel} tone="secondary" variant="caption">
        {label}
      </AppText>
      <View style={styles.heatGrid}>
        {cells.map(cell => {
          const color = cellColor(cell.voltage, avg);
          const a11y = `${t('Cell')} ${cell.cell_id}: ${fmtNumber(cell.voltage ?? 0, 3)} V (${(cell.delta_from_avg ?? 0) >= 0 ? '+' : ''}${fmtNumber((cell.delta_from_avg ?? 0) * 1000, 1)} mV)`;
          return (
            <View
              accessibilityLabel={a11y}
              key={cell.cell_id}
              style={[styles.heatCellWrap, {width: cellWidth}]}>
              <View style={[styles.heatCell, {backgroundColor: `${color}20`}]}>
                <AppText style={[styles.heatCellId, {color}]}>{cell.cell_id}</AppText>
                <AppText style={[styles.heatCellV, {color}]}>
                  {fmtNumber(cell.voltage ?? 0, 3)}
                </AppText>
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendDotGreen]} />
          <AppText style={styles.legendText} tone="muted">
            {t('Nominal')}
          </AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendDotAmber]} />
          <AppText style={styles.legendText} tone="muted">
            {t('Slight Deviation')}
          </AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendDotRed]} />
          <AppText style={styles.legendText} tone="muted">
            {t('Significant Deviation')}
          </AppText>
        </View>
      </View>
    </GlassPanel>
  );
}

type InsightStatus = 'good' | 'warning' | 'critical';

const insightPanelStyle: Record<InsightStatus, ViewStyle> = {
  good: {borderColor: `${colors.success}33`, backgroundColor: `${colors.success}0d`},
  warning: {borderColor: `${colors.warning}33`, backgroundColor: `${colors.warning}0d`},
  critical: {borderColor: `${colors.danger}33`, backgroundColor: `${colors.danger}0d`},
};

const insightIconColor: Record<InsightStatus, string> = {
  good: '#6ee7b7',
  warning: '#fcd34d',
  critical: '#fda4af',
};

/* ── Page Component ────────────────────────────────────────────── */

export default function BatteryCellsPage() {
  const {t} = useTranslation();
  usePageTitle(t('battery.cells.title', 'Battery Cells'));
  const {formatTemperature, unitPrefs} = useUnits();
  const tempUnit = unitPrefs.temperature;

  const [showHeatmap, setShowHeatmap] = useState(true);

  /* ── Queries ─── */

  // Header picker is the source of truth for vehicle scope.
  const {vehicleId} = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const {data, isLoading, error} = useQuery<BatteryCellData>({
    queryKey: ['battery-cells', activeId],
    queryFn: () =>
      request<BatteryCellData>(`/analytics/battery-cells?vehicle_id=${activeId}`),
    enabled: activeId !== '',
  });

  /* ── Derived data ─── */

  const histogram = useMemo(() => buildHistogram(data?.cells ?? []), [data?.cells]);

  const minCell = useMemo(() => {
    if (!data?.cells?.length) {
      return null;
    }
    return data.cells.reduce((a, b) => (a.voltage < b.voltage ? a : b));
  }, [data?.cells]);

  const maxCell = useMemo(() => {
    if (!data?.cells?.length) {
      return null;
    }
    return data.cells.reduce((a, b) => (a.voltage > b.voltage ? a : b));
  }, [data?.cells]);

  /* ── Derived: voltage spread trend from history ─── */
  const voltageSpreadTrend = useMemo(() => {
    const hist = data?.history ?? [];
    if (hist.length === 0) {
      return [];
    }
    return hist.map(h => ({
      time: formatDateTime(h.timestamp).split(',')[0],
      spread: fmtNumber((h.max_voltage - h.min_voltage) * 1000, 1),
      spreadRaw: (h.max_voltage - h.min_voltage) * 1000,
    }));
  }, [data?.history]);

  /* ── Derived: health insights ─── */
  const insights = useMemo(() => {
    if (!data) {
      return [];
    }
    const items: {
      icon: string;
      title: string;
      description: string;
      status: InsightStatus;
    }[] = [];
    const imb = data.imbalance_mv ?? 0;

    if (imb > 15) {
      items.push({
        icon: '⚡',
        title: t('battery.cells.insight.highSpread', 'High Voltage Spread'),
        description: t(
          'battery.cells.insight.highSpreadDesc',
          'Cell imbalance is significant. Consider a full charge to 100% to allow BMS balancing, then discharge to 90%.',
        ),
        status: 'critical',
      });
    } else if (imb > 5) {
      items.push({
        icon: '⚡',
        title: t('battery.cells.insight.watchSpread', 'Voltage Spread Increasing'),
        description: t(
          'battery.cells.insight.watchSpreadDesc',
          'Cell balance is slightly off. Periodic full charges can help the BMS equalize cells.',
        ),
        status: 'warning',
      });
    } else {
      items.push({
        icon: '✅',
        title: t('battery.cells.insight.balanced', 'Cells Well Balanced'),
        description: t(
          'battery.cells.insight.balancedDesc',
          'Voltage spread is within healthy range. Battery cells are operating normally.',
        ),
        status: 'good',
      });
    }

    if (data.temp_spread > 5) {
      items.push({
        icon: '🌡️',
        title: t('battery.cells.insight.highTemp', 'High Temperature Spread'),
        description: t(
          'battery.cells.insight.highTempDesc',
          'Avoid fast charging in extreme temperatures. Allow the battery to precondition before supercharging.',
        ),
        status: 'critical',
      });
    } else if (data.temp_spread > 3) {
      items.push({
        icon: '🌡️',
        title: t('battery.cells.insight.watchTemp', 'Module Temperature Variation'),
        description: t(
          'battery.cells.insight.watchTempDesc',
          'Some temperature variation is normal. Monitor during fast charging sessions.',
        ),
        status: 'warning',
      });
    } else {
      items.push({
        icon: '🌡️',
        title: t('battery.cells.insight.goodTemp', 'Thermal Balance Good'),
        description: t(
          'battery.cells.insight.goodTempDesc',
          'Module temperatures are consistent. Thermal management system is performing well.',
        ),
        status: 'good',
      });
    }

    const criticalCells = data.cells.filter(c => c.status === 'critical').length;
    if (criticalCells > 0) {
      items.push({
        icon: '⚠️',
        title: t('battery.cells.insight.criticalCells', 'Critical Cells Detected'),
        description: t('battery.cells.insight.criticalCellsDesc', {
          count: criticalCells,
          defaultValue:
            '{{count}} cell(s) show significant deviation. Consider scheduling a service appointment.',
        }),
        status: 'critical',
      });
    } else {
      items.push({
        icon: '🛡️',
        title: t('battery.cells.insight.healthy', 'All Cells Healthy'),
        description: t(
          'battery.cells.insight.healthyDesc',
          'No critical cells detected. Continue current charging habits for long-term health.',
        ),
        status: 'good',
      });
    }

    return items;
  }, [data, t]);

  /* ── Table ─── */

  const {sortKey, sortDir, onSort, sortFn} = useSortToggle('cell_id', 'asc');

  const sortedCells = useMemo(() => {
    if (!data?.cells) {
      return [];
    }
    return sortFn(data.cells, (row, key) => {
      const val = row[key as keyof CellReading];
      return typeof val === 'number' ? val : String(val);
    });
  }, [data?.cells, sortFn]);

  const columns: Column<CellReading>[] = useMemo(
    () => [
      {
        key: 'cell_id',
        header: t('Cell #'),
        sortable: true,
        render: r => <AppText style={styles.cellMonoBold}>{r.cell_id}</AppText>,
      },
      {
        key: 'voltage',
        header: t('Voltage (V)'),
        sortable: true,
        render: r => (
          <AppText style={[styles.cellMono, {color: cellColor(r.voltage, data?.avg_voltage ?? 0)}]}>
            {fmtNumber(r.voltage, 4)}
          </AppText>
        ),
      },
      {
        key: 'delta_from_avg',
        header: t('Delta (mV)'),
        sortable: true,
        render: r => {
          const mv = r.delta_from_avg * 1000;
          return (
            <AppText
              style={[
                styles.cellMono,
                {color: mv > 0 ? colors.success : mv < 0 ? colors.danger : colors.textPrimary},
              ]}>
              {mv >= 0 ? '+' : ''}
              {fmtNumber(mv, 1)}
            </AppText>
          );
        },
      },
      {
        key: 'status',
        header: t('Status'),
        sortable: true,
        render: r => (
          <Badge dot size="sm" variant={statusVariant(r.status)}>
            {`${statusIconGlyph(r.status)} ${t(
              (r.status ?? '').charAt(0).toUpperCase() + (r.status ?? '').slice(1),
            )}`}
          </Badge>
        ),
      },
    ],
    [t, data?.avg_voltage],
  );

  /* ── Render ─── */

  return (
    <PageContainer
      actions={<VehicleSelectChip />}
      error={error instanceof Error ? error : null}
      loading={isLoading}
      subtitle={t('Individual cell voltage monitoring and analysis')}
      title={t('Battery Cells')}>
      <ScrollView contentContainerStyle={styles.body}>
        {/* ── Summary Metrics ─── */}
        <FadeIn>
          <GridRow>
            <MetricCard
              color="cyan"
              icon="▦"
              label={t('Total Cells')}
              value={fmtNumber(data?.total_cells ?? 0, 0)}
            />
            <MetricCard
              color="green"
              icon="🔋"
              label={t('Avg Voltage')}
              value={`${fmtNumber(data?.avg_voltage ?? 0, 4)} V`}
            />
            <MetricCard
              color="amber"
              icon="↘"
              label={t('Min Cell')}
              value={minCell ? `#${minCell.cell_id} ${fmtNumber(minCell.voltage, 4)} V` : '—'}
            />
            <MetricCard
              color="purple"
              icon="↗"
              label={t('Max Cell')}
              value={maxCell ? `#${maxCell.cell_id} ${fmtNumber(maxCell.voltage, 4)} V` : '—'}
            />
            <MetricCard
              color={(data?.imbalance_mv ?? 0) > 15 ? 'red' : (data?.imbalance_mv ?? 0) > 5 ? 'amber' : 'green'}
              icon="📈"
              label={t('Imbalance')}
              value={`${fmtNumber(data?.imbalance_mv ?? 0, 1)} mV`}
            />
            <MetricCard
              color="cyan"
              icon="⚙️"
              label={t('Pack Voltage')}
              value={`${fmtNumber(data?.pack_voltage ?? 0, 1)} V`}
            />
          </GridRow>
        </FadeIn>

        {/* ── Cell Voltage Heatmap ─── */}
        <FadeIn delay={0.05}>
          <View style={styles.heatmapHeader}>
            <AppText style={styles.sectionLabel} tone="secondary" variant="caption">
              {t('Cell Voltage Heatmap')}
            </AppText>
            <ToggleButton
              glyph={showHeatmap ? '📊' : '▦'}
              label={showHeatmap ? t('Bar View') : t('Grid View')}
              onPress={() => setShowHeatmap(v => !v)}
            />
          </View>
          {data?.cells && data.cells.length > 0 ? (
            showHeatmap ? (
              <CellHeatmap
                avg={data.avg_voltage}
                cells={data.cells}
                label={t('Cells colored by deviation from average')}
              />
            ) : null
          ) : (
            <GlassPanel style={styles.panelPadLg}>
              <EmptyState
                /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                message={t('No cell readings available.')}
                title={t('Cell Voltage Heatmap')}
              />
            </GlassPanel>
          )}
        </FadeIn>

        {/* ── Cell Voltage Bar Chart ─── */}
        <FadeIn delay={0.1}>
          <GlassPanel style={styles.panelPad}>
            <AppText style={styles.sectionLabel} tone="secondary" variant="caption">
              {t('Cell Voltage Bar Chart')}
            </AppText>
            {data?.cells && data.cells.length > 0 ? (
              <ResponsiveContainer height={280} width="100%">
                <BarChart data={data.cells} margin={chartMarginLabeled}>
                  <CartesianGrid stroke="var(--glass-border)" strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="cell_id"
                    label={{value: t('Cell #'), position: 'insideBottom', offset: -2, style: {fill: 'var(--text-muted)', fontSize: 11}}}
                    tick={axisTick}
                  />
                  <YAxis
                    domain={['dataMin - 0.005', 'dataMax + 0.005']}
                    label={{value: t('Voltage (V)'), angle: -90, position: 'insideLeft', style: {fill: 'var(--text-muted)', fontSize: 11}}}
                    tick={axisTick}
                    tickFormatter={(v: number) => fmtNumber(v, 3)}
                    width={55}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine
                    label={{value: t('Avg'), position: 'right', fill: CHART_COLORS[0], fontSize: 10}}
                    stroke={CHART_COLORS[0]}
                    strokeDasharray="4 4"
                    y={data.avg_voltage}
                  />
                  <ReferenceLine
                    label={{value: t('Min'), position: 'right', fill: CHART_COLORS[5], fontSize: 10}}
                    stroke={CHART_COLORS[5]}
                    strokeDasharray="2 2"
                    y={data.min_voltage}
                  />
                  <ReferenceLine
                    label={{value: t('Max'), position: 'right', fill: CHART_COLORS[1], fontSize: 10}}
                    stroke={CHART_COLORS[1]}
                    strokeDasharray="2 2"
                    y={data.max_voltage}
                  />
                  <Bar
                    dataKey="voltage"
                    fill={CHART_COLORS[0]}
                    maxBarSize={24}
                    name={t('Voltage')}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton height={280} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Voltage Distribution & Imbalance Trend ─── */}
        <FadeIn delay={0.15}>
          <View style={styles.twoCol}>
            {/* Voltage Distribution Histogram */}
            <GlassPanel style={[styles.panelPad, styles.twoColItem]}>
              <AppText style={styles.sectionLabel} tone="secondary" variant="caption">
                {t('Voltage Distribution')}
              </AppText>
              {histogram.length > 0 ? (
                <ResponsiveContainer height={240} width="100%">
                  <BarChart data={histogram} margin={chartMarginLabeled}>
                    <CartesianGrid stroke="var(--glass-border)" strokeDasharray="3 3" strokeOpacity={0.4} />
                    <XAxis angle={-35} dataKey="bucket" height={60} textAnchor="end" tick={axisTick} />
                    <YAxis
                      allowDecimals={false}
                      label={{value: t('Cells'), angle: -90, position: 'insideLeft', style: {fill: 'var(--text-muted)', fontSize: 11}}}
                      tick={axisTick}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="count"
                      fill={CHART_COLORS[2]}
                      maxBarSize={40}
                      name={t('Cell Count')}
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Skeleton height={240} />
              )}
            </GlassPanel>

            {/* Imbalance Trend */}
            <GlassPanel style={[styles.panelPad, styles.twoColItem]}>
              <AppText style={styles.sectionLabel} tone="secondary" variant="caption">
                {t('Imbalance Trend')}
              </AppText>
              {data?.history && data.history.length > 0 ? (
                <ResponsiveContainer height={240} width="100%">
                  <LineChart data={data.history} margin={chartMargin}>
                    <CartesianGrid stroke="var(--glass-border)" strokeDasharray="3 3" strokeOpacity={0.4} />
                    <XAxis
                      dataKey="timestamp"
                      tick={axisTick}
                      tickFormatter={(v: string) => formatDateTime(v).split(',')[0]}
                    />
                    <YAxis tick={axisTick} unit=" mV" width={55} />
                    <Tooltip content={<ChartTooltip />} labelFormatter={(v: string) => formatDateTime(v)} />
                    <Legend />
                    <Line
                      {...AREA_DEFAULTS}
                      activeDot={{r: 4}}
                      dataKey="imbalance_mv"
                      name={t('Imbalance (mV)')}
                      stroke={CHART_COLORS[3]}
                    />
                    <ReferenceLine
                      label={{value: t('Nominal'), position: 'right', fill: CHART_COLORS[1], fontSize: 10}}
                      stroke={CHART_COLORS[1]}
                      strokeDasharray="4 4"
                      y={5}
                    />
                    <ReferenceLine
                      label={{value: t('Warning'), position: 'right', fill: CHART_COLORS[5], fontSize: 10}}
                      stroke={CHART_COLORS[5]}
                      strokeDasharray="4 4"
                      y={15}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Skeleton height={240} />
              )}
            </GlassPanel>
          </View>
        </FadeIn>

        {/* ── Cell Voltage Over Time ─── */}
        <FadeIn delay={0.2}>
          <GlassPanel style={styles.panelPad}>
            <AppText style={styles.sectionLabel} tone="secondary" variant="caption">
              {t('Cell Voltage Over Time')}
            </AppText>
            {data?.history && data.history.length > 0 ? (
              <ResponsiveContainer height={280} width="100%">
                <LineChart data={data.history} margin={chartMarginLabeled}>
                  <CartesianGrid stroke="var(--glass-border)" strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="timestamp"
                    tick={axisTick}
                    tickFormatter={(v: string) => formatDateTime(v).split(',')[0]}
                  />
                  <YAxis
                    domain={['dataMin - 0.002', 'dataMax + 0.002']}
                    label={{value: t('Voltage (V)'), angle: -90, position: 'insideLeft', style: {fill: 'var(--text-muted)', fontSize: 11}}}
                    tick={axisTick}
                    tickFormatter={(v: number) => fmtNumber(v, 3)}
                    width={55}
                  />
                  <Tooltip content={<ChartTooltip />} labelFormatter={(v: string) => formatDateTime(v)} />
                  <Legend />
                  <Line
                    {...AREA_DEFAULTS}
                    dataKey="min_voltage"
                    name={t('Min Voltage')}
                    stroke={CHART_COLORS[5]}
                    strokeDasharray="4 2"
                  />
                  <Line {...AREA_DEFAULTS} dataKey="avg_voltage" name={t('Avg Voltage')} stroke={CHART_COLORS[0]} />
                  <Line
                    {...AREA_DEFAULTS}
                    dataKey="max_voltage"
                    name={t('Max Voltage')}
                    stroke={CHART_COLORS[1]}
                    strokeDasharray="4 2"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton height={280} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Cell Details Table ─── */}
        <FadeIn delay={0.25}>
          <GlassPanel style={styles.panelPad}>
            <View style={styles.tableHeader}>
              <AppText style={styles.sectionLabel} tone="secondary" variant="caption">
                {t('Cell Details')}
              </AppText>
              {data?.cells && (
                <Badge size="sm" variant="neutral">
                  {`${data.cells.length} ${t('cells')}`}
                </Badge>
              )}
            </View>
            {sortedCells.length > 0 ? (
              <DataTable
                columns={columns}
                compact
                data={sortedCells}
                keyExtractor={r => r.cell_id}
                onSort={onSort}
                pagination
                sortDir={sortDir}
                sortKey={sortKey}
                tableId="battery:cells"
              />
            ) : (
              <EmptyState
                /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                message={t('No cell details available.')}
                title={t('Cell Details')}
              />
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Voltage Spread Trend ─── */}
        <FadeIn delay={0.3}>
          {/* chart-a11y:no-table dense per-sample voltage trace; SR users get the latest spread via the cell summary above */}
          <ChartContainer
            annotations={{vehicleId, scope: 'battery', chartId: 'battery-cells-spread-trend'}}
            ariaLabel={t('battery.cells.chart.spreadTrend.aria', 'Battery cell voltage spread trend area chart over time')}
            title={t('battery.cells.chart.spreadTrend', 'Voltage Spread Trend')}>
            {({annotations: chartAnnotations}) =>
              voltageSpreadTrend.length > 0 ? (
                <View style={styles.spreadChart}>
                  <ResponsiveContainer height="100%" width="100%">
                    <AreaChart data={voltageSpreadTrend}>
                      <ChartGradient color="#a855f7" id="spreadGrad" opacity={0.3} />
                      {chartGrid}
                      <XAxis axisLine={false} dataKey="time" tick={axisTickSm} tickLine={false} />
                      <YAxis axisLine={false} tick={axisTickSm} tickLine={false} unit=" mV" />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine stroke={CHART_COLORS[1]} strokeDasharray="4 4" y={5} />
                      <ReferenceLine stroke={CHART_COLORS[5]} strokeDasharray="4 4" y={15} />
                      {renderAnnotationLines(chartAnnotations, ts => ts)}
                      <Area
                        {...AREA_DEFAULTS}
                        dataKey="spreadRaw"
                        fill="url(#spreadGrad)"
                        name={t('battery.cells.chart.voltageSpread', 'Voltage Spread (mV)')}
                        stroke="#a855f7"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </View>
              ) : (
                <EmptyState
                  /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  message={t('battery.cells.chart.noSpreadTrend', 'Not enough history for spread trend')}
                  title={t('battery.cells.chart.spreadTrend', 'Voltage Spread Trend')}
                />
              )
            }
          </ChartContainer>
        </FadeIn>

        {/* ── Temperature Summary ─── */}
        <FadeIn delay={0.35}>
          <GlassPanel style={styles.panelPadLg}>
            <AppText style={styles.panelTitle} weight="semibold">
              🌡️ {t('battery.cells.temp.title', 'Temperature Summary')}
            </AppText>
            {data ? (
              <GridRow>
                <MetricCard
                  color="green"
                  icon="🌡️"
                  label={t('battery.cells.temp.avg', 'Avg Temperature')}
                  value={formatTemperature(data.avg_temperature, {precision: 1})}
                />
                <MetricCard
                  color="cyan"
                  icon="↘"
                  label={t('battery.cells.temp.min', 'Min Temperature')}
                  value={formatTemperature(data.min_temperature, {precision: 1})}
                />
                <MetricCard
                  color="amber"
                  icon="↗"
                  label={t('battery.cells.temp.max', 'Max Temperature')}
                  value={formatTemperature(data.max_temperature, {precision: 1})}
                />
                <MetricCard
                  color={data.temp_spread > 5 ? 'red' : data.temp_spread > 3 ? 'amber' : 'green'}
                  icon="📈"
                  label={t('battery.cells.temp.spread', 'Temp Spread')}
                  value={`${fmtNumber(tempUnit === '°F' ? data.temp_spread * 1.8 : data.temp_spread, 1)}${tempUnit}`}
                />
              </GridRow>
            ) : (
              <EmptyState
                /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                message={t('battery.cells.temp.empty', 'No temperature data available')}
                title={t('battery.cells.temp.title', 'Temperature Summary')}
              />
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Health Recommendations ─── */}
        <FadeIn delay={0.4}>
          <GlassPanel style={styles.panelPadLg}>
            <AppText style={styles.panelTitle} weight="semibold">
              🛡️ {t('battery.cells.recommendations', 'Health Recommendations')}
            </AppText>
            {insights.length > 0 ? (
              <View style={styles.twoCol}>
                {insights.map((ins, i) => (
                  <GlassPanel key={i} style={[styles.insightPanel, styles.twoColItem, insightPanelStyle[ins.status]]}>
                    <View style={styles.insightRow}>
                      <Glyph style={[styles.insightGlyph, {color: insightIconColor[ins.status]}]}>{ins.icon}</Glyph>
                      <View style={styles.insightTextBlock}>
                        <AppText style={styles.insightTitle} weight="semibold">
                          {ins.title}
                        </AppText>
                        <AppText style={styles.insightDesc} tone="secondary" variant="caption">
                          {ins.description}
                        </AppText>
                      </View>
                    </View>
                  </GlassPanel>
                ))}
              </View>
            ) : (
              <EmptyState
                /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                message={t('battery.cells.noInsights', 'Not enough data for recommendations')}
                title={t('battery.cells.recommendations', 'Health Recommendations')}
              />
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Summary Stats ─── */}
        <FadeIn delay={0.45}>
          <GridRow>
            <GlassPanel style={styles.statPanel}>
              <AppText style={styles.statLabel} tone="muted">
                {t('battery.cells.stat.totalCells', 'Total Cells')}
              </AppText>
              <AppText style={[styles.statValue, styles.statValueCyan]} weight="bold">
                {data?.total_cells ?? 0}
              </AppText>
            </GlassPanel>
            <GlassPanel style={styles.statPanel}>
              <AppText style={styles.statLabel} tone="muted">
                {t('battery.cells.stat.packVoltage', 'Pack Voltage')}
              </AppText>
              <AppText style={[styles.statValue, styles.statValueEmerald]} weight="bold">
                {fmtNumber(data?.pack_voltage ?? 0, 1)}
                <AppText style={styles.statUnit}>V</AppText>
              </AppText>
            </GlassPanel>
            <GlassPanel style={styles.statPanel}>
              <AppText style={styles.statLabel} tone="muted">
                {t('battery.cells.stat.avgVoltage', 'Avg Cell V')}
              </AppText>
              <AppText style={styles.statValue} weight="bold">
                {fmtNumber(data?.avg_voltage ?? 0, 4)}
                <AppText style={styles.statUnit}>V</AppText>
              </AppText>
            </GlassPanel>
            <GlassPanel style={styles.statPanel}>
              <AppText style={styles.statLabel} tone="muted">
                {t('battery.cells.stat.voltageSpread', 'V Spread')}
              </AppText>
              <AppText
                style={[
                  styles.statValue,
                  {
                    color:
                      (data?.imbalance_mv ?? 0) > 15
                        ? '#fda4af'
                        : (data?.imbalance_mv ?? 0) > 5
                          ? '#fcd34d'
                          : '#6ee7b7',
                  },
                ]}
                weight="bold">
                {fmtNumber(data?.imbalance_mv ?? 0, 1)}
                <AppText style={styles.statUnit}>mV</AppText>
              </AppText>
            </GlassPanel>
            <GlassPanel style={styles.statPanel}>
              <AppText style={styles.statLabel} tone="muted">
                {t('battery.cells.stat.tempSpread', 'Temp Spread')}
              </AppText>
              <AppText
                style={[
                  styles.statValue,
                  {
                    color:
                      (data?.temp_spread ?? 0) > 5
                        ? '#fda4af'
                        : (data?.temp_spread ?? 0) > 3
                          ? '#fcd34d'
                          : '#6ee7b7',
                  },
                ]}
                weight="bold">
                {fmtNumber(tempUnit === '°F' ? (data?.temp_spread ?? 0) * 1.8 : (data?.temp_spread ?? 0), 1)}
                <AppText style={styles.statUnit}>{tempUnit}</AppText>
              </AppText>
            </GlassPanel>
            <GlassPanel style={styles.statPanel}>
              <AppText style={styles.statLabel} tone="muted">
                {t('battery.cells.stat.normalCells', 'Normal Cells')}
              </AppText>
              <AppText style={[styles.statValue, styles.statValueEmerald]} weight="bold">
                {data?.cells.filter(c => c.status === 'normal').length ?? 0}
                <AppText style={styles.statUnit}>/{data?.total_cells ?? 0}</AppText>
              </AppText>
            </GlassPanel>
          </GridRow>
        </FadeIn>
      </ScrollView>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sectionLabel: {
    marginBottom: spacing.sm,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    marginBottom: spacing.md,
  },
  panelPad: {
    padding: spacing.md,
  },
  panelPadLg: {
    padding: spacing.lg,
  },
  /* metric card */
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricCard: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 150,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metricTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 10,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 18,
  },
  metricIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
  },
  metricIconGlyph: {
    fontSize: 14,
  },
  /* skeleton */
  skeleton: {
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  /* toggle button */
  heatmapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
  },
  toggleBtnPressed: {
    backgroundColor: colors.surfaceHover,
  },
  toggleBtnGlyph: {
    fontSize: 13,
    color: colors.accent,
  },
  toggleBtnText: {
    color: colors.accent,
  },
  /* vehicle chip */
  vehicleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    maxWidth: 200,
  },
  vehicleChipGlyph: {
    fontSize: 13,
  },
  vehicleChipText: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  /* heatmap */
  heatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  heatCellWrap: {
    padding: 1,
  },
  heatCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingVertical: 3,
  },
  heatCellId: {
    fontSize: 9,
    fontWeight: '600',
  },
  heatCellV: {
    fontSize: 9,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  legendDotGreen: {
    backgroundColor: '#10b981',
  },
  legendDotAmber: {
    backgroundColor: '#f59e0b',
  },
  legendDotRed: {
    backgroundColor: '#ef4444',
  },
  legendText: {
    fontSize: 10,
  },
  /* two column responsive */
  twoCol: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  twoColItem: {
    flexBasis: '100%',
    flexGrow: 1,
    minWidth: 280,
  },
  /* table */
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  cellMono: {
    fontVariant: ['tabular-nums'],
  },
  cellMonoBold: {
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  /* spread trend chart */
  spreadChart: {
    height: 220,
  },
  /* insights */
  insightPanel: {
    padding: spacing.md,
    borderWidth: 1,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  insightGlyph: {
    fontSize: 16,
    marginTop: 1,
  },
  insightTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  insightTitle: {
    color: colors.textPrimary,
  },
  insightDesc: {
    marginTop: 2,
  },
  /* summary stats */
  statPanel: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 110,
    padding: spacing.md,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '500',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 24,
    marginTop: 2,
  },
  statValueCyan: {
    color: '#67e8f9',
  },
  statValueEmerald: {
    color: '#6ee7b7',
  },
  statUnit: {
    fontSize: 13,
  },
});
