// Native parity port of
// web/src/features/vehicle-systems/pages/TirePressurePage.tsx.
//
// TirePressurePage is the per-vehicle TPMS dashboard: an AI trend-reasoning
// panel, a hard/soft TPMS warning banner, four per-wheel RadialGauges with a
// status badge, four summary MetricCards (Avg / Min / Warning Count / Last
// Updated), a four-line pressure-history chart, and a sortable + paginated
// history table — all under a VehicleSelect + RangePicker action row.
//
// The web original composes the shared DOM page kit (PageContainer, GlassPanel,
// Badge, DataTable + useSortToggle, RangePicker, VehicleSelect, MetricCard,
// RadialGauge, Skeleton, EmptyState, AlertBanner, FadeIn), the Recharts
// LineChart tree, lucide SVG icons, react-i18next, the app-level
// useSelectedVehicle / useRangeState / useUnits / usePageTitle hooks and the
// @/lib unit/number/date formatters. React Native has no DOM, Recharts/SVG,
// Tailwind, lucide, document.title or wired react-i18next, so — following the
// established self-contained page idiom (DrivetrainHealthPage, CostAnalysisPage)
// — this port reproduces the page with RN primitives + the shared native parity
// building blocks and documents every adaptation in the sidecar:
//
//   - The CONVERTED native AITirePressureTrendReasoning is imported (not
//     re-inlined), exactly as the web wires @/components/ai/...; vehicleId is
//     passed through verbatim.
//   - The two real data reads keep the web's inline useQuery + request calls so
//     the exact API paths (/tire-pressure/latest?vehicle_id= and
//     /tire-pressure?vehicle_id=&start=&end=), the snake_case TirePressureReading
//     interface and the query keys are all preserved.
//   - @/hooks/useUnits -> an inlined `useUnits` deriving only unitPrefs.pressure
//     from native useSettings `unit_of_pressure` exactly as web derivePressure
//     ('psi' -> 'psi' else 'bar'); convertPressureFromSI is inlined verbatim
//     (kPa input; psi /6.894757, bar /100).
//   - @/hooks/useSelectedVehicle has no native global selection context, so the
//     `activeVehicleId` name is preserved as local state seeded to the first
//     useVehicles() vehicle; the actions-row VehicleSelect becomes a native pill
//     group (the DrivetrainHealthPage idiom).
//   - @/hooks/useRangeState (localStorage-persisted) -> local `start`/`end`/
//     `setRange` keeping their exact names, seeded to the '30d' preset; the web
//     RangePicker becomes a native PRESET_IDS pill control.
//   - usePageTitle (document.title) has no native analogue -> the same translated
//     title renders in the on-screen header.
//   - Recharts LineChart -> the shared native ChartContainer + a hand-drawn
//     multi-series dot/grid trace (the converted TemperatureTrendChart idiom);
//     the accessible data-table fallback is owned by ChartContainer via
//     data + dataColumns.
//   - DataTable + useSortToggle -> a native table (sortable headers, paginated at
//     the web DataTable default page size 25) + a verbatim local useSortToggle;
//     sortKey/sortDir/onSort/sortFn semantics and the Badge-wrapped cells are
//     preserved.
//   - GlassPanel/Badge/MetricCard/Skeleton/AlertBanner/FadeIn are reproduced with
//     RN primitives; lucide icons map onto the shared native SemanticIcon glyph
//     set (Gauge->tirePressure, AlertTriangle->warning, TrendingDown->trendDown,
//     Activity->activity, Clock->clock, AlertCircle->alertCircle).
//   - @/lib fmtNumber / formatDateTime / getErrorMessage are inlined verbatim in
//     intent (safeNumber + en-US grouping + default precision 2; localized
//     "MMM d, yyyy, h:mm a" with the em-dash nullish fallback; Error.message
//     extraction).
//   - react-i18next useTranslation -> a native key/English-default `t` fallback
//     preserving every tirePressure.* key + bare-key default verbatim.
//
// State names (activeVehicleId, start, end, setRange, latest, history,
// summaryStats, historyAsc, chartData, lastUpdatedAt, tableData, historyColumns,
// sortKey/sortDir/onSort, isLoading), every API path, the SI->display pressure
// handling (converted only at the render boundary) and the section order are
// preserved. No DOM, Recharts, Leaflet, framer-motion, lucide-react, or old web
// UI components are imported.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AITirePressureTrendReasoning} from '../../../components/ai/AITirePressureTrendReasoning';
import {ChartContainer, RadialGauge} from '../../../components/charts';

/* ─── i18n fallback ─────────────────────────────────────────────────────────
   react-i18next is not wired in native; i18next returns the supplied default
   (or the key itself when no default) when a translation is missing. The
   fallback keeps every tirePressure.* key + English default — and the bare-key
   labels (Time, Warnings, Ok, …) — verbatim at the call sites. */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeT(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  Types (snake_case from backend)                                    */
/* ------------------------------------------------------------------ */

interface TirePressureReading {
  id: number;
  vehicle_id: number;
  front_left: number;
  front_right: number;
  rear_left: number;
  rear_right: number;
  tpms_hard_warnings?: string | null;
  tpms_soft_warnings?: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

/** Check if a TPMS warning JSON string contains any true value. */
function hasTpmsWarning(val: string | null | undefined): boolean {
  if (!val) {
    return false;
  }
  try {
    const parsed = JSON.parse(val) as Record<string, boolean>;
    return Object.values(parsed).some(Boolean);
  } catch {
    // Fallback: treat non-empty non-JSON strings as truthy
    return val !== 'false' && val !== '';
  }
}

// Thresholds in Pascals (SI). Backend `signal_log` stores TpmsPressure
// values in Pa; units.ToSI converts both bar and psi inputs to Pa per
// `internal/tesla/units/units.go`.
// 1 bar = 100_000 Pa, 1 psi ≈ 6894.757 Pa.
const NORMAL_MIN_PA = 250_000; // 2.5 bar
const NORMAL_MAX_PA = 350_000; // 3.5 bar
const SOFT_LOW_PA = 200_000; // 2.0 bar
const SOFT_HIGH_PA = 400_000; // 4.0 bar
const GAUGE_MAX_PA = 500_000; // 5.0 bar

/**
 * Interim adapter that coerces a raw TPMS value to Pa.
 *
 * Background: when `vehicle_unit_history` lacks a row for a vehicle, the
 * codec cannot run `units.ToSI` on TpmsPressure* atomics. The raw codec
 * value (bar for metric vehicles, psi for imperial) lands in `signal.Store`,
 * and the `/tire-pressure/latest` handler echoes it back verbatim. The bug
 * surfaced as gauges showing ~0 with all-critical badges, which reads as
 * "vehicle is broken" rather than "vehicle unit context is missing".
 *
 * Until the source-unit gap is fixed, this helper detects the three
 * plausible source units by value range and normalises to Pa so the page
 * renders accurate readings today.
 *
 * Ranges (typical passenger car tire pressures):
 *   - Pa     : 150_000–500_000   → return as-is
 *   - kPa    : 150–500           → multiply by 1_000
 *   - psi    : 20–60             → multiply by 6_894.757
 *   - bar    : 1.5–5             → multiply by 100_000
 *   - 0/null : missing reading   → return 0
 */
function normaliseTpmsToPa(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  if (raw >= 50_000) {
    return raw; // already Pa
  }
  if (raw >= 100) {
    return raw * 1_000; // kPa
  }
  if (raw >= 10) {
    return raw * 6_894.757; // psi
  }
  return raw * 100_000; // bar (covers 0.5..10)
}

const TIRE_POSITIONS = ['fl', 'fr', 'rl', 'rr'] as const;
type TirePosition = (typeof TIRE_POSITIONS)[number];

const TIRE_LABELS: Record<TirePosition, string> = {
  fl: 'Front Left',
  fr: 'Front Right',
  rl: 'Rear Left',
  rr: 'Rear Right',
};

type PressureStatus = 'normal' | 'low' | 'high' | 'critical';

const STATUS_LABELS: Record<PressureStatus, string> = {
  normal: 'Normal',
  low: 'Low',
  high: 'High',
  critical: 'Critical',
};

const PRESET_IDS = ['7d', '30d', '90d', 'mtd', 'ytd', 'all'];

function getTirePressureValue(
  reading: TirePressureReading,
  pos: TirePosition,
): number {
  const map: Record<TirePosition, number> = {
    fl: reading.front_left,
    fr: reading.front_right,
    rl: reading.rear_left,
    rr: reading.rear_right,
  };
  return normaliseTpmsToPa(map[pos]);
}

function pressureColor(pa: number): string {
  if (pa >= NORMAL_MIN_PA && pa <= NORMAL_MAX_PA) {
    return '#10b981';
  }
  if (pa >= SOFT_LOW_PA && pa <= SOFT_HIGH_PA) {
    return '#f59e0b';
  }
  return '#ef4444';
}

function pressureStatus(pa: number): PressureStatus {
  if (pa < SOFT_LOW_PA) {
    return 'critical';
  }
  if (pa < NORMAL_MIN_PA) {
    return 'low';
  }
  if (pa > SOFT_HIGH_PA) {
    return 'critical';
  }
  if (pa > NORMAL_MAX_PA) {
    return 'high';
  }
  return 'normal';
}

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info';

function statusVariant(status: PressureStatus): 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'normal':
      return 'success';
    case 'critical':
      return 'danger';
    default:
      return 'warning';
  }
}

/* ------------------------------------------------------------------ */
/*  Chart helpers                                                      */
/* ------------------------------------------------------------------ */

interface ChartDatum {
  time: string;
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

// CHART_COLORS[0]/[2]/[1]/[3] from @/components/charts (Okabe-Ito palette),
// preserved verbatim so the four trace lines keep their web hues.
const LINE_COLORS: Record<TirePosition, string> = {
  fl: '#0072B2',
  fr: '#009E73',
  rl: '#E69F00',
  rr: '#F0E442',
};

/* ------------------------------------------------------------------ */
/*  Inlined SI / number / date / error helpers (verbatim intent from   */
/*  @/lib/unitConversion, @/lib/numberFormat, @/lib/dateFormat,         */
/*  @/lib/errorMessage; the native lib module is not a converted target)*/
/* ------------------------------------------------------------------ */

type PressureUnitPref = 'psi' | 'bar';

const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;
const FALLBACK = '\u2014';

// Verbatim from web lib/unitConversion convertPressureFromSI (input is kPa).
function convertPressureFromSI(kpa: number, to: PressureUnitPref): number {
  switch (to) {
    case 'psi':
      return kpa / KPA_PER_PSI;
    case 'bar':
      return kpa / KPA_PER_BAR;
  }
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Mirrors web lib/numberFormat fmtNumber: safeNumber guard + en-US grouping +
// the global default precision of 2 (settings-driven precision is not wired
// natively, matching the converted siblings + the native RadialGauge default).
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

// Verbatim intent from web lib/dateFormat formatDateTime: ISO -> localized
// "MMM d, yyyy, h:mm a"; nullish/invalid -> the universal em-dash placeholder.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// Verbatim from web lib/errorMessage getErrorMessage.
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ------------------------------------------------------------------ */
/*  Native UI building blocks (GlassPanel kit reproductions)           */
/* ------------------------------------------------------------------ */

const BADGE_TONES: Record<
  BadgeVariant,
  {color: string; border: string; surface: string}
> = {
  success: {
    border: colors.successBorder,
    color: colors.success,
    surface: colors.successSurface,
  },
  warning: {
    border: colors.warningBorder,
    color: colors.warning,
    surface: colors.warningSurface,
  },
  danger: {
    border: colors.dangerBorder,
    color: colors.danger,
    surface: colors.dangerSurface,
  },
  info: {
    border: colors.borderAccent,
    color: colors.accent,
    surface: colors.accentSoft,
  },
};

function Badge({
  variant,
  children,
  dot,
  size,
}: {
  variant: BadgeVariant;
  children: React.ReactNode;
  dot?: boolean;
  size?: 'sm';
}) {
  const tone = BADGE_TONES[variant];
  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: tone.surface, borderColor: tone.border},
        size === 'sm' ? styles.badgeSm : null,
      ]}>
      {dot ? (
        <View style={[styles.badgeDot, {backgroundColor: tone.color}]} />
      ) : null}
      <AppText
        numberOfLines={1}
        style={{color: tone.color}}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

type MetricColor = 'cyan' | 'green' | 'amber' | 'purple';

const METRIC_COLORS: Record<MetricColor, string> = {
  amber: colors.warning,
  cyan: colors.accent,
  green: colors.success,
  purple: colors.violet,
};

function MetricCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: SemanticIconName;
  color: MetricColor;
}) {
  return (
    <GlassPanel style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <SemanticIcon name={icon} size="sm" />
        <AppText
          numberOfLines={1}
          style={styles.metricLabel}
          tone="muted"
          variant="caption"
          weight="semibold">
          {label}
        </AppText>
      </View>
      <AppText
        numberOfLines={1}
        style={[styles.metricValue, {color: METRIC_COLORS[color]}]}
        variant="title"
        weight="bold">
        {value}
      </AppText>
    </GlassPanel>
  );
}

function Skeleton({height}: {height: number}) {
  return <View style={[styles.skeleton, {height}]} />;
}

function AlertBanner({
  variant,
  icon,
  children,
}: {
  variant: BadgeVariant;
  icon: SemanticIconName;
  children: React.ReactNode;
}) {
  const tone = BADGE_TONES[variant];
  return (
    <View
      style={[
        styles.alertBanner,
        {backgroundColor: tone.surface, borderColor: tone.border},
      ]}>
      <SemanticIcon name={icon} size="sm" />
      <AppText
        style={[styles.alertText, {color: tone.color}]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// Presentation-only entrance animation on web; rendered statically on native
// (no native FadeIn). `delay` is accepted for source parity but is a no-op.
function FadeIn({children}: {children: React.ReactNode; delay?: number}) {
  return <View style={styles.fadeIn}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  VehicleSelect + RangePicker (native pill controls)                 */
/* ------------------------------------------------------------------ */

interface VehicleOption {
  id: number;
  label: string;
}

function VehicleSelect({
  options,
  value,
  onChange,
}: {
  options: VehicleOption[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <View style={styles.pillRow}>
      {options.map(opt => {
        const selected = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            accessibilityRole="button"
            accessibilityState={{selected}}
            onPress={() => onChange(opt.id)}
            style={[styles.pill, selected ? styles.pillSelected : null]}>
            <AppText
              numberOfLines={1}
              tone={selected ? 'accent' : 'secondary'}
              variant="caption">
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const PRESET_LABELS: Record<string, string> = {
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  mtd: 'MTD',
  ytd: 'YTD',
  all: 'All',
};

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

// Resolve a web RangePicker preset id to a {start,end} ISO-date window.
function rangeForPreset(id: string): {start: string; end: string} {
  const now = new Date();
  const end = isoDate(now);
  const startDate = new Date(now);
  switch (id) {
    case '7d':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case '90d':
      startDate.setDate(startDate.getDate() - 90);
      break;
    case 'mtd':
      startDate.setDate(1);
      break;
    case 'ytd':
      startDate.setMonth(0, 1);
      break;
    case 'all':
      startDate.setFullYear(startDate.getFullYear() - 10);
      break;
    case '30d':
    default:
      startDate.setDate(startDate.getDate() - 30);
      break;
  }
  return {end, start: isoDate(startDate)};
}

function RangePicker({
  value,
  presetIds,
  onChange,
}: {
  value: {start: string; end: string};
  presetIds: string[];
  onChange: (r: {start: string; end: string}) => void;
}) {
  return (
    <View style={styles.rangeRow} testID="tire-pressure-range">
      <AppText numberOfLines={1} tone="muted" variant="caption">
        {value.start} → {value.end}
      </AppText>
      <View style={styles.pillRow}>
        {presetIds.map(id => (
          <Pressable
            key={id}
            accessibilityRole="button"
            onPress={() => onChange(rangeForPreset(id))}
            style={styles.pill}>
            <AppText tone="secondary" variant="caption">
              {PRESET_LABELS[id] ?? id}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  useSortToggle (verbatim from web DataTable)                        */
/* ------------------------------------------------------------------ */

function useSortToggle(defaultKey?: string, defaultDir: 'asc' | 'desc' = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir);

  const onSort = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey],
  );

  const sortFn = useCallback(
    <T,>(data: T[], accessor: (row: T, key: string) => number | string) => {
      if (!sortKey) {
        return data;
      }
      return [...data].sort((a, b) => {
        const av = accessor(a, sortKey);
        const bv = accessor(b, sortKey);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    },
    [sortKey, sortDir],
  );

  return {onSort, sortDir, sortFn, sortKey};
}

/* ------------------------------------------------------------------ */
/*  Native DataTable (sortable headers + pagination + Badge cells)     */
/* ------------------------------------------------------------------ */

interface Column {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: TirePressureReading) => React.ReactNode;
}

const TABLE_PAGE_SIZE = 25; // web DataTable defaultPageSize

function renderCell(content: React.ReactNode): React.ReactNode {
  if (typeof content === 'string' || typeof content === 'number') {
    return (
      <AppText numberOfLines={1} variant="caption">
        {content}
      </AppText>
    );
  }
  return content;
}

function DataTable({
  columns,
  data,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
  emptyMessage,
}: {
  columns: Column[];
  data: TirePressureReading[];
  keyExtractor: (row: TirePressureReading) => number | string;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  emptyMessage: string;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(data.length / TABLE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = data.slice(
    (safePage - 1) * TABLE_PAGE_SIZE,
    safePage * TABLE_PAGE_SIZE,
  );

  if (data.length === 0) {
    return <EmptyState message={emptyMessage} title={emptyMessage} />;
  }

  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        {columns.map(col => {
          const active = !!col.sortable && sortKey === col.key;
          const indicator = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
          return (
            <Pressable
              key={col.key}
              accessibilityRole={col.sortable ? 'button' : undefined}
              disabled={!col.sortable}
              onPress={col.sortable ? () => onSort(col.key) : undefined}
              style={styles.tableCell}>
              <AppText
                numberOfLines={1}
                tone={active ? 'accent' : 'muted'}
                variant="caption"
                weight="semibold">
                {col.header}
                {indicator}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {pageRows.map(row => (
        <View key={keyExtractor(row)} style={styles.tableRow}>
          {columns.map(col => (
            <View key={col.key} style={styles.tableCell}>
              {renderCell(col.render(row))}
            </View>
          ))}
        </View>
      ))}

      {totalPages > 1 ? (
        <View style={styles.pagination}>
          <Pressable
            accessibilityRole="button"
            disabled={safePage <= 1}
            onPress={() => setPage(p => Math.max(1, p - 1))}
            style={[styles.pill, safePage <= 1 ? styles.pillDisabled : null]}>
            <AppText tone="secondary" variant="caption">
              Prev
            </AppText>
          </Pressable>
          <AppText tone="muted" variant="caption">
            {`Page ${safePage} of ${totalPages}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            disabled={safePage >= totalPages}
            onPress={() => setPage(p => Math.min(totalPages, p + 1))}
            style={[
              styles.pill,
              safePage >= totalPages ? styles.pillDisabled : null,
            ]}>
            <AppText tone="secondary" variant="caption">
              Next
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Native pressure-history chart (ChartContainer + hand-drawn trace)  */
/* ------------------------------------------------------------------ */

interface ChartSeries {
  key: TirePosition;
  label: string;
  color: string;
}

interface ChartDomain {
  min: number;
  max: number;
}

const CHART_MAX_COLUMNS = 40;
const CHART_GRID_LINES = [0, 50, 100] as const;

function buildChartDomain(values: number[]): ChartDomain {
  if (values.length === 0) {
    return {max: 1, min: 0};
  }
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < min) {
      min = values[i];
    }
    if (values[i] > max) {
      max = values[i];
    }
  }
  if (min === max) {
    const pad = Math.max(Math.abs(max) * 0.05, 1);
    min -= pad;
    max += pad;
  }
  return {max, min};
}

function chartPct(value: number, domain: ChartDomain): number {
  const span = domain.max - domain.min || 1;
  return Math.min(Math.max(((value - domain.min) / span) * 100, 0), 100);
}

function sampleRows(rows: ChartDatum[], max: number): ChartDatum[] {
  if (rows.length <= max) {
    return rows;
  }
  const step = (rows.length - 1) / (max - 1);
  const out: ChartDatum[] = [];
  for (let i = 0; i < max; i++) {
    out.push(rows[Math.round(i * step)]);
  }
  return out;
}

function PressureHistoryChart({
  data,
  unit,
  t,
}: {
  data: ChartDatum[];
  unit: string;
  t: NativeTFunction;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const series: ChartSeries[] = useMemo(
    () =>
      TIRE_POSITIONS.map(pos => ({
        color: LINE_COLORS[pos],
        key: pos,
        label: TIRE_LABELS[pos],
      })),
    [],
  );

  const points = useMemo(() => sampleRows(data, CHART_MAX_COLUMNS), [data]);

  const domain = useMemo(() => {
    const values: number[] = [];
    data.forEach(row => {
      series.forEach(s => {
        const v = row[s.key];
        if (Number.isFinite(v)) {
          values.push(v);
        }
      });
    });
    return buildChartDomain(values);
  }, [data, series]);

  const yTicks = useMemo(
    () => [domain.max, (domain.max + domain.min) / 2, domain.min],
    [domain],
  );

  const xTicks = useMemo(() => {
    if (points.length <= 3) {
      return points;
    }
    const last = points.length - 1;
    return [points[0], points[Math.round(last / 2)], points[last]];
  }, [points]);

  const activeIndex =
    points.length === 0
      ? 0
      : Math.min(
          Math.max(selectedIndex ?? points.length - 1, 0),
          points.length - 1,
        );
  const selected = points[activeIndex];

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const ariaLabel = t(
    'tirePressure.history.aria',
    'Tire pressure history line chart per wheel',
  );

  return (
    <ChartContainer
      ariaLabel={ariaLabel}
      data={data.map(d => ({
        fl: d.fl,
        fr: d.fr,
        rl: d.rl,
        rr: d.rr,
        time: d.time,
      }))}
      dataColumns={[
        {key: 'time', label: t('Time')},
        ...TIRE_POSITIONS.map(pos => ({
          key: pos,
          label: `${TIRE_LABELS[pos]} (${unit})`,
        })),
      ]}
      height={300}
      title={t('Pressure History')}>
      <View style={styles.chartContent}>
        <View style={styles.chartFrame}>
          <View style={styles.chartYAxis}>
            {yTicks.map((tick, index) => (
              <AppText
                key={`y-${index}`}
                numberOfLines={1}
                style={styles.chartYTick}
                tone="muted"
                variant="caption">
                {fmtNumber(tick, 1)}
              </AppText>
            ))}
          </View>

          <View style={styles.chartPlotColumn}>
            <View
              accessibilityLabel={ariaLabel}
              accessibilityRole="image"
              accessible
              style={styles.chartPlotArea}>
              {CHART_GRID_LINES.map(line => (
                <View
                  key={`grid-${line}`}
                  pointerEvents="none"
                  style={[
                    styles.chartGridLine,
                    {top: `${line}%` as DimensionValue},
                  ]}
                />
              ))}

              <View style={styles.chartColumnsRow}>
                {points.map((point, index) => {
                  const isSelected = index === activeIndex;
                  return (
                    <Pressable
                      key={`col-${index}`}
                      accessibilityLabel={point.time}
                      accessibilityRole="button"
                      accessibilityState={{selected: isSelected}}
                      onPress={() => handleSelect(index)}
                      style={styles.chartSampleColumn}>
                      {isSelected ? (
                        <View
                          pointerEvents="none"
                          style={styles.chartSelectedColumn}
                        />
                      ) : null}
                      {series.map(s => {
                        const v = point[s.key];
                        if (!Number.isFinite(v)) {
                          return null;
                        }
                        return (
                          <View
                            key={s.key}
                            pointerEvents="none"
                            style={[
                              styles.chartDotWrap,
                              {
                                bottom: `${chartPct(v, domain).toFixed(
                                  2,
                                )}%` as DimensionValue,
                              },
                            ]}>
                            <View
                              style={[
                                styles.chartDot,
                                {backgroundColor: s.color},
                              ]}
                            />
                          </View>
                        );
                      })}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.chartXAxis}>
              {xTicks.map((tick, index) => (
                <AppText
                  key={`x-${index}`}
                  numberOfLines={1}
                  style={styles.chartXTick}
                  tone="muted"
                  variant="caption">
                  {tick?.time ?? ''}
                </AppText>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.chartLegendRow}>
          {series.map(s => (
            <View key={s.key} style={styles.chartLegendItem}>
              <View
                style={[styles.chartLegendSwatch, {backgroundColor: s.color}]}
              />
              <AppText numberOfLines={1} tone="secondary" variant="caption">
                {s.label}
              </AppText>
            </View>
          ))}
        </View>

        {selected ? (
          <View accessibilityRole="summary" style={styles.chartTooltip}>
            <AppText
              numberOfLines={1}
              tone="secondary"
              variant="caption"
              weight="semibold">
              {selected.time}
            </AppText>
            <View style={styles.chartTooltipRow}>
              {series.map(s => {
                const v = selected[s.key];
                const text = Number.isFinite(v) ? fmtNumber(v, 1) : FALLBACK;
                return (
                  <View key={s.key} style={styles.chartTooltipChip}>
                    <View
                      style={[
                        styles.chartTooltipChipDot,
                        {backgroundColor: s.color},
                      ]}
                    />
                    <AppText numberOfLines={1} tone="secondary" variant="caption">
                      {`${s.label}: ${text}`}
                    </AppText>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>
    </ChartContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function TirePressurePage() {
  const t = useNativeT();
  // usePageTitle(t('tirePressure.title')) sets document.title on web; no native
  // analogue, so the same translated title renders in the on-screen header.

  // useUnits -> pressure preference derived from native useSettings exactly as
  // web derivePressure (unit_of_pressure === 'psi' -> 'psi' else 'bar').
  const {data: settings} = useSettings();
  const pressureUnitPref: PressureUnitPref =
    settings?.unit_of_pressure === 'psi' ? 'psi' : 'bar';
  const pressureUnit = pressureUnitPref;

  // Backend front_left/front_right/rear_left/rear_right arrive in Pa (SI).
  // convertPressureFromSI expects kPa, so divide by 1000 at the boundary.
  const pressureDisplayValue = useCallback(
    (pa: number) => convertPressureFromSI(pa / 1000, pressureUnitPref),
    [pressureUnitPref],
  );

  const gaugeMax = pressureDisplayValue(GAUGE_MAX_PA);

  // useSelectedVehicle source-of-truth -> local state seeded to first vehicle.
  const {data: vehicles} = useVehicles();
  const vehicleList = useMemo(() => vehicles ?? [], [vehicles]);
  const [activeVehicleId, setActiveVehicleId] = useState<number | null>(null);
  useEffect(() => {
    if (activeVehicleId == null && vehicleList.length > 0) {
      setActiveVehicleId(vehicleList[0].id);
    }
  }, [activeVehicleId, vehicleList]);
  const vehicleOptions: VehicleOption[] = vehicleList.map(v => ({
    id: v.id,
    label: v.display_name,
  }));

  // useRangeState({persistKey:'tire-pressure.range', defaultPresetId:'30d'}) ->
  // local start/end/setRange (names preserved); persistence has no native target.
  const initialRange = useMemo(() => rangeForPreset('30d'), []);
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const setRange = useCallback((r: {start: string; end: string}) => {
    setStart(r.start);
    setEnd(r.end);
  }, []);

  /* ---- API queries ---- */

  const {
    data: latest,
    isLoading: loadingLatest,
    error: latestError,
  } = useQuery({
    enabled: activeVehicleId !== null,
    queryFn: () =>
      request<TirePressureReading>(
        `/tire-pressure/latest?vehicle_id=${activeVehicleId}`,
      ),
    queryKey: ['tire-pressure-latest', activeVehicleId],
  });

  const {
    data: history,
    isLoading: loadingHistory,
    error: historyError,
  } = useQuery({
    enabled: activeVehicleId !== null,
    queryFn: () =>
      request<TirePressureReading[]>(
        `/tire-pressure?vehicle_id=${activeVehicleId}&start=${start}&end=${end}`,
      ),
    queryKey: ['tire-pressure-history', activeVehicleId, start, end],
  });

  const anyError = [latestError, historyError].find(Boolean);

  /* ---- Derived data ---- */

  const hasWarning =
    hasTpmsWarning(latest?.tpms_hard_warnings) ||
    hasTpmsWarning(latest?.tpms_soft_warnings);

  const summaryStats = useMemo(() => {
    if (!latest) {
      return null;
    }
    const values = TIRE_POSITIONS.map(p => getTirePressureValue(latest, p));
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const min = Math.min(...values);
    const warningCount = values.filter(
      v => v < NORMAL_MIN_PA || v > NORMAL_MAX_PA,
    ).length;
    return {avg, min, warningCount};
  }, [latest]);

  // Canonical chronological order (oldest first). The /tire-pressure endpoint
  // forwards rows in StateReader.Timeline order (ASC) but the contract doesn't
  // pin that, so we sort defensively here. Single source of truth for both the
  // chart (left=oldest, right=newest) and the newest-first table derivation.
  const historyAsc = useMemo<TirePressureReading[]>(() => {
    if (!history?.length) {
      return [];
    }
    return [...history].sort((a, b) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
  }, [history]);

  const chartData: ChartDatum[] = useMemo(() => {
    if (historyAsc.length === 0) {
      return [];
    }
    return historyAsc.map(r => ({
      fl: pressureDisplayValue(normaliseTpmsToPa(r.front_left)),
      fr: pressureDisplayValue(normaliseTpmsToPa(r.front_right)),
      rl: pressureDisplayValue(normaliseTpmsToPa(r.rear_left)),
      rr: pressureDisplayValue(normaliseTpmsToPa(r.rear_right)),
      time: formatDateTime(r.created_at),
    }));
  }, [historyAsc, pressureDisplayValue]);

  // Newest entry in the selected range — populates "Last Updated" because
  // /tire-pressure/latest returns only field values (no timestamp). This is the
  // freshness of the visible window, range-bound by design.
  const lastUpdatedAt = useMemo<string | null>(() => {
    if (historyAsc.length === 0) {
      return null;
    }
    return historyAsc[historyAsc.length - 1].created_at ?? null;
  }, [historyAsc]);

  /* ---- Table sort: newest-first by default, all sortable columns wired ---- */

  // Numeric tire columns sort by their normalised Pa value so the Badge-wrapped
  // renders sort by magnitude, not by Badge label text.
  const sortAccessor = useCallback(
    (row: TirePressureReading, key: string): number | string => {
      switch (key) {
        case 'created_at':
          return row.created_at ?? '';
        case 'fl':
        case 'fr':
        case 'rl':
        case 'rr':
          return getTirePressureValue(row, key);
        default:
          return '';
      }
    },
    [],
  );

  const {sortKey, sortDir, onSort, sortFn} = useSortToggle('created_at', 'desc');

  const tableData = useMemo(
    () => sortFn(historyAsc, sortAccessor),
    [historyAsc, sortFn, sortAccessor],
  );

  /* ---- Table columns ---- */

  const historyColumns: Column[] = useMemo(
    () => [
      {
        header: t('Time'),
        key: 'created_at',
        render: (row: TirePressureReading) => formatDateTime(row.created_at),
        sortable: true,
      },
      ...TIRE_POSITIONS.map(
        (pos): Column => ({
          header: `${TIRE_LABELS[pos]} (${pressureUnit})`,
          key: pos,
          render: (row: TirePressureReading) => {
            const val = getTirePressureValue(row, pos);
            const status = pressureStatus(val);
            return (
              <Badge size="sm" variant={statusVariant(status)}>
                {fmtNumber(pressureDisplayValue(val ?? 0))}
              </Badge>
            );
          },
          sortable: true,
        }),
      ),
      {
        header: t('Warnings'),
        key: 'warnings',
        render: (row: TirePressureReading) => {
          if (hasTpmsWarning(row.tpms_hard_warnings)) {
            return (
              <Badge dot size="sm" variant="danger">
                {t('Hard Warning')}
              </Badge>
            );
          }
          if (hasTpmsWarning(row.tpms_soft_warnings)) {
            return (
              <Badge dot size="sm" variant="warning">
                {t('Soft Warning')}
              </Badge>
            );
          }
          return (
            <Badge size="sm" variant="success">
              {t('Ok')}
            </Badge>
          );
        },
      },
    ],
    [t, pressureUnit, pressureDisplayValue],
  );

  /* ---- Render ---- */

  const isLoading = loadingLatest && !latest;

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      testID="tire-pressure-page">
      <View style={styles.header}>
        <AppText variant="title" weight="bold">
          {t('tirePressure.title', 'Tire Pressure')}
        </AppText>
        <AppText tone="muted">
          {t(
            'tirePressure.subtitle',
            'Monitor tire pressure readings and history',
          )}
        </AppText>
        <View style={styles.actions}>
          <VehicleSelect
            onChange={setActiveVehicleId}
            options={vehicleOptions}
            value={activeVehicleId}
          />
          <RangePicker
            onChange={setRange}
            presetIds={PRESET_IDS}
            value={{end, start}}
          />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      {anyError ? (
        <AlertBanner icon="alertCircle" variant="danger">
          {t('error.loadFailed', 'Failed to load data')}:{' '}
          {getErrorMessage(anyError)}
        </AlertBanner>
      ) : null}

      <FadeIn>
        <View style={styles.sections}>
          <AITirePressureTrendReasoning
            vehicleId={activeVehicleId ?? undefined}
          />

          {/* Warning banner */}
          {hasWarning ? (
            <GlassPanel
              style={[
                styles.warningPanel,
                {
                  borderColor: hasTpmsWarning(latest?.tpms_hard_warnings)
                    ? colors.dangerBorder
                    : colors.warningBorder,
                },
              ]}>
              <SemanticIcon name="warning" size="sm" />
              <Badge
                variant={
                  hasTpmsWarning(latest?.tpms_hard_warnings) ? 'danger' : 'warning'
                }>
                {hasTpmsWarning(latest?.tpms_hard_warnings)
                  ? t('Hard Warning Active')
                  : t('Soft Warning Active')}
              </Badge>
            </GlassPanel>
          ) : null}

          {/* 4 Tire Pressure Gauges */}
          <GlassPanel style={styles.panel}>
            <FadeIn delay={0.1}>
              <View style={styles.panelHeading}>
                <SemanticIcon name="tirePressure" size="sm" />
                <Badge size="sm" variant="info">
                  {t('Current Readings')}
                </Badge>
              </View>

              <View style={styles.gaugeGrid}>
                {TIRE_POSITIONS.map(pos => {
                  const value = latest ? getTirePressureValue(latest, pos) : 0;
                  const color = pressureColor(value);
                  const status = pressureStatus(value);

                  return (
                    <GlassPanel key={pos} style={styles.gaugeCell}>
                      {loadingLatest ? (
                        <Skeleton height={120} />
                      ) : (
                        <>
                          <RadialGauge
                            color={color}
                            label={TIRE_LABELS[pos]}
                            max={gaugeMax}
                            size={120}
                            unit={pressureUnit}
                            value={pressureDisplayValue(value)}
                          />
                          <Badge size="sm" variant={statusVariant(status)}>
                            {STATUS_LABELS[status]}
                          </Badge>
                        </>
                      )}
                    </GlassPanel>
                  );
                })}
              </View>
            </FadeIn>
          </GlassPanel>

          {/* Summary Stats */}
          <View style={styles.metricGrid}>
            <MetricCard
              color="cyan"
              icon="activity"
              label={t('Avg Pressure')}
              value={
                summaryStats
                  ? `${fmtNumber(
                      pressureDisplayValue(summaryStats.avg ?? 0),
                    )} ${pressureUnit}`
                  : FALLBACK
              }
            />
            <MetricCard
              color="green"
              icon="trendDown"
              label={t('Min Pressure')}
              value={
                summaryStats
                  ? `${fmtNumber(
                      pressureDisplayValue(summaryStats.min ?? 0),
                    )} ${pressureUnit}`
                  : FALLBACK
              }
            />
            <MetricCard
              color="amber"
              icon="warning"
              label={t('Warning Count')}
              value={summaryStats?.warningCount ?? 0}
            />
            <MetricCard
              color="purple"
              icon="clock"
              label={t('Last Updated')}
              value={lastUpdatedAt ? formatDateTime(lastUpdatedAt) : FALLBACK}
            />
          </View>

          {/* Pressure History Chart */}
          <GlassPanel style={styles.panel}>
            <FadeIn delay={0.2}>
              <View style={styles.panelHeading}>
                <SemanticIcon name="tirePressure" size="sm" />
                <Badge size="sm" variant="info">
                  {t('Pressure History')}
                </Badge>
              </View>

              {loadingHistory ? (
                <Skeleton height={300} />
              ) : chartData.length === 0 ? (
                <EmptyState
                  message={t('No History Data')}
                  title={t('No History Data')}
                />
              ) : (
                <PressureHistoryChart
                  data={chartData}
                  t={t}
                  unit={pressureUnit}
                />
              )}
            </FadeIn>
          </GlassPanel>

          {/* History DataTable */}
          <GlassPanel style={styles.panel}>
            <FadeIn delay={0.3}>
              <View style={styles.panelHeading}>
                <SemanticIcon name="clock" size="sm" />
                <Badge size="sm" variant="info">
                  {t('History Table')}
                </Badge>
              </View>

              {loadingHistory ? (
                <Skeleton height={200} />
              ) : !history?.length ? (
                <EmptyState
                  message={t('No History Data')}
                  title={t('No History Data')}
                />
              ) : (
                <DataTable
                  columns={historyColumns}
                  data={tableData}
                  emptyMessage={t('No History Data')}
                  keyExtractor={row => row.id}
                  onSort={onSort}
                  sortDir={sortDir}
                  sortKey={sortKey}
                />
              )}
            </FadeIn>
          </GlassPanel>
        </View>
      </FadeIn>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  alertBanner: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  alertText: {
    flex: 1,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeDot: {
    borderRadius: 999,
    height: 6,
    width: 6,
  },
  badgeSm: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  chartColumnsRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    gap: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  chartContent: {
    flex: 1,
    gap: spacing.sm,
    width: '100%',
  },
  chartDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  chartDotWrap: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  chartFrame: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  chartGridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.4,
    position: 'absolute',
    right: 0,
  },
  chartLegendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  chartLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  chartLegendSwatch: {
    borderRadius: 2,
    height: 4,
    width: 16,
  },
  chartPlotArea: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  chartPlotColumn: {
    flex: 1,
    gap: spacing.xs,
  },
  chartSampleColumn: {
    flex: 1,
    minWidth: 2,
    position: 'relative',
  },
  chartSelectedColumn: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.accentSoft,
  },
  chartTooltip: {
    marginTop: spacing.sm,
  },
  chartTooltipChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chartTooltipChipDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  chartTooltipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  chartXAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 16,
  },
  chartXTick: {
    flex: 1,
    textAlign: 'center',
  },
  chartYAxis: {
    justifyContent: 'space-between',
    paddingBottom: 16,
    width: 44,
  },
  chartYTick: {
    textAlign: 'left',
  },
  fadeIn: {
    width: '100%',
  },
  gaugeCell: {
    alignItems: 'center',
    flexBasis: '45%',
    flexGrow: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  gaugeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  header: {
    gap: spacing.xs,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 150,
    padding: spacing.md,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricLabel: {
    flex: 1,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metricValue: {
    marginTop: spacing.xs,
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  panel: {
    padding: spacing.lg,
  },
  panelHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  pill: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pillDisabled: {
    opacity: 0.4,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pillSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderWidth: 1,
  },
  rangeRow: {
    gap: spacing.xs,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sections: {
    gap: spacing.lg,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    width: '100%',
  },
  table: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  tableCell: {
    flex: 1,
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  tableRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  warningPanel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
