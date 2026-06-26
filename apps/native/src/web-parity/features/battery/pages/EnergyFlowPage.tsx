// Native parity port of web/src/features/battery/pages/EnergyFlowPage.tsx.
//
// EnergyFlowPage — a battery/energy dashboard with six stacked sections:
//   1. a real-time Energy Flow Diagram (Grid -> Battery -> Motor with a battery
//      RadialGauge, a live charge FlowArrow, and a DC/AC/HVAC/Accessories
//      breakdown row) fed by GET /vehicles/{id}/energy/flow,
//   2. six summary MetricCards (Total Energy, Total Charged, Distance,
//      Efficiency, CO2 Saved, Period) from GET /vehicles/{id}/energy?days=N,
//   3. a Daily Energy Usage chart,
//   4. a Daily Distance chart + a Daily Efficiency chart,
//   5. an Efficiency Metrics trio (efficiency band, CO2 saved, avg energy/day),
//   6. a sortable + paginated Daily Energy History table.
//
// The web original composes the shared DOM page kit (PageContainer, GlassPanel,
// Badge, DataTable + useSortToggle, RangePicker, VehicleSelect, MetricCard,
// RadialGauge, the Recharts AreaChart/BarChart trees, Skeleton, EmptyState,
// FadeIn), lucide-react SVG icons, react-i18next, the app-level usePageTitle /
// useUnits / useSelectedVehicle / useRangeState hooks, @/lib/dateFormat,
// @/lib/numberFormat and @/lib/cn. React Native has no DOM, no Recharts/SVG, no
// Tailwind, no lucide, no react-router and no wired react-i18next, so this port
// reproduces the same behaviour with RN primitives + the established native
// parity building blocks:
//
//   - PageContainer (title/subtitle + actions + loading/empty gates) -> an inline
//     ScrollView scaffold with a persistent header (title + subtitle), an actions
//     row (VehicleSelect pills + RangePicker preset pills), a 6-card Skeleton
//     while loading and a focused EmptyState when no stats resolve.
//     usePageTitle(t('Energy Flow')) sets the browser tab title on web; there is
//     no native analogue, so the same translated string is the on-screen header
//     (documented in the sidecar).
//   - @/hooks/useUnits + @/lib/unitConversion are reproduced by reading the native
//     useSettings() query and deriving distanceUnit from unit_of_length, the
//     locale, and the decimal precision. convertDistanceFromSI / convertEnergyFromSI
//     and formatDistance / formatEnergy are inlined verbatim from
//     @/lib/unitConversion (same SI math, DEFAULT_PRECISION distance=1 / energy=2,
//     resolvePrecision per-call override, '—' nullish fallback, "<n> <unit>"). No
//     unit math is invented; the explicit Wh/km vs Wh/mi efficiency bridge
//     (x1000 vs x1609.344) is kept exactly as the web page wrote it.
//   - @/hooks/useSelectedVehicle (URL > store > first vehicle) is not wired on
//     native, so the page reads useVehicles() and defaults to the first vehicle,
//     with the VehicleSelect pill group changing the selection (the established
//     native precedent — DashboardScreen / LivePowerFlowWidget).
//   - @/hooks/useRangeState (URL + localStorage + preset) is reproduced with local
//     state seeded from the '7d' preset; the DATE_PRESETS resolve() math for the
//     six PRESET_IDS (today/7d/30d/90d/mtd/ytd) is inlined verbatim. URL sync and
//     localStorage persistence are not wired (documented).
//   - DataTable + useSortToggle -> a native header row (with the same desc/asc
//     toggle + 'date'/'desc' default and the verbatim sort accessor) plus
//     per-page rows and Prev/Next pagination, preserving every column render.
//   - The Recharts AreaChart/BarChart trees -> native proportional <ChartBars>
//     layers (the OverviewTab / ChargingTab idiom) that preserve each series' data
//     key and proportional intent, with the unit-formatted value beside each bar
//     and the EmptyState fallback preserved when there is no data.
//   - RadialGauge is the shared native parity gauge (same value/max/label/unit/
//     color/size contract as web). MetricCard / Badge / FlowArrow are inlined
//     native equivalents preserving every label/value/unit/variant.
//   - lucide icons (Battery/Car/Plug/Thermometer/Cpu/ArrowRight/ArrowDown/Zap/
//     TrendingUp/Activity/BarChart3/Leaf/Calendar/Gauge) map onto the shared
//     native SemanticIcon set; ArrowRight/ArrowDown render as '→'/'↓' glyphs.
//   - react-i18next useTranslation -> a native key/English-default `t` fallback
//     that preserves every translation key (the web keys are the English strings).
//   - <FadeIn> is a presentation-only entrance animation with no native
//     equivalent yet, so each section renders statically.
//
// State names (vehicleId/activeId, start/end/setRange, days, stats/flow,
// chargePower/batterySOC/chargeState, dailyBreakdown, dailyChartData/
// efficiencyChartData, totalDistance/avgEfficiency/efficiencyUnit/avgEnergyPerDay,
// sortKey/sortDir/sortedDailyRows/historyColumns, excellent/goodThreshold), every
// API path (via request + the unchanged native useEnergyFlow hook), the days memo,
// the SI unit handling and the threshold logic are preserved verbatim. No DOM,
// Recharts, Leaflet, react-router, lucide-react, or old web UI components are
// imported.

import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { EmptyState } from '../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import { RadialGauge } from '../../../components/charts';
import { request } from '../../../api/client';
import { useEnergyFlow } from '../../../api/hooks/useEnergy';
import { useSettings } from '../../../api/hooks/useSettings';
import { useVehicles } from '../../../api/hooks/useVehicles';

/* ───────── Types (match actual API response from energy_handler.go) ───────── */

interface DailyBreakdownEntry {
  date: string;
  energy_wh: number;
  distance_m: number;
  efficiency_wh_per_m: number;
  cost: number;
}

interface EnergyStatsResponse {
  vehicle_id: number;
  period_days: number;
  total_energy_used_wh: number;
  total_energy_charged_wh: number;
  total_wh: number;
  total_cost: number;
  total_distance_m: number;
  avg_efficiency_wh_per_m: number;
  co2_saved_kg: number;
  daily_breakdown: DailyBreakdownEntry[];
}

/* ───────── Constants ───────── */

const PRESET_IDS = ['today', '7d', '30d', '90d', 'mtd', 'ytd'];

// Web @/components/charts CHART_COLORS = @/lib/colors CB-safe Okabe-Ito palette.
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

/* ───────── i18n fallback ───────── */

// react-i18next is not wired in native; i18next returns the supplied default
// (or the key, which here is the English string) when a translation is missing.
type TFunc = (key: string, fallback?: string) => string;
const t: TFunc = (key, fallback) => fallback ?? key;

/* ───────── Inlined unit handling (mirror useUnits + lib/unitConversion) ───── */

type DistanceUnitPref = 'km' | 'mi';
type EnergyUnitPref = 'Wh' | 'kWh';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const DEFAULT_EMPTY_DISPLAY = '—';
const DEFAULT_LOCALE = 'en-US';

// Pure SI -> display converters, verbatim from web lib/unitConversion.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  return to === 'kWh' ? wh / 1000 : wh;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Mirrors web lib/unitConversion.formatNumber (Intl grouping, pinned digits).
function formatNumber(
  value: number,
  locale: string,
  fractionDigits: number,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  }
}

// Mirrors web lib/unitConversion.resolvePrecision: override > pref > fallback.
function resolvePrecision(
  prefPrecision: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 0
  ) {
    return Math.floor(override);
  }
  if (
    typeof prefPrecision === 'number' &&
    Number.isFinite(prefPrecision) &&
    prefPrecision >= 0
  ) {
    return Math.floor(prefPrecision);
  }
  return fallback;
}

// Mirrors web useUnits.derivePrecision (settings.decimal_precision -> pref).
function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(decimalPrecision)) {
    return undefined;
  }
  if (decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

// Mirrors web lib/numberFormat.fmtNumber with an explicit precision (every call
// site passes one). Locale comes from settings; nullish / non-finite -> 0.
function fmtNum(
  v: number | null | undefined,
  decimals: number,
  locale: string,
): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

// Mirrors web lib/dateFormat.formatDateShort: "Apr 4" in the browser locale
// (native uses the device default locale, matching web's browser-locale call).
function formatDateShort(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const expanded =
    h.length === 3
      ? h
          .split('')
          .map(char => `${char}${char}`)
          .join('')
      : h;
  if (/^[\da-f]{6}$/i.test(expanded)) {
    const r = parseInt(expanded.slice(0, 2), 16);
    const g = parseInt(expanded.slice(2, 4), 16);
    const b = parseInt(expanded.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

/* ───────── Inlined date presets (mirror lib/datePresets resolve) ───────── */

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface RangeValue {
  start: string;
  end: string;
}

function resolvePreset(id: string, now: Date = new Date()): RangeValue {
  switch (id) {
    case 'today':
      return { start: isoDay(now), end: isoDay(now) };
    case '30d': {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return { start: isoDay(s), end: isoDay(now) };
    }
    case '90d': {
      const s = new Date(now);
      s.setDate(s.getDate() - 89);
      return { start: isoDay(s), end: isoDay(now) };
    }
    case 'mtd':
      return {
        start: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
        end: isoDay(now),
      };
    case 'ytd':
      return {
        start: isoDay(new Date(now.getFullYear(), 0, 1)),
        end: isoDay(now),
      };
    case '7d':
    default: {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return { start: isoDay(s), end: isoDay(now) };
    }
  }
}

function presetLabel(id: string): string {
  switch (id) {
    case 'today':
      return t('Today');
    case '7d':
      return t('Last 7 days');
    case '30d':
      return t('Last 30 days');
    case '90d':
      return t('Last 90 days');
    case 'mtd':
      return t('Month to date');
    case 'ytd':
      return t('Year to date');
    default:
      return id;
  }
}

/* ───────── Sort toggle (mirror web useSortToggle) ───────── */

type SortDir = 'asc' | 'desc';

function useSortToggle(defaultKey: string, defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const onSort = (key: string) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortFn = <T,>(
    data: T[],
    accessor: (row: T, key: string) => number | string,
  ): T[] => {
    if (!sortKey) {
      return data;
    }
    return [...data].sort((a, b) => {
      const av = accessor(a, sortKey);
      const bv = accessor(b, sortKey);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  };

  return { sortKey, sortDir, onSort, sortFn };
}

/* ───────── Native presentational pieces ───────── */

type BadgeVariant = 'success' | 'neutral' | 'warning' | 'danger' | 'info';

function Badge({
  children,
  variant = 'neutral',
}: {
  children: ReactNode;
  variant?: BadgeVariant;
}) {
  return (
    <View style={[styles.badge, badgeStyles[variant]]}>
      <AppText variant="caption" weight="semibold" style={badgeText[variant]}>
        {children}
      </AppText>
    </View>
  );
}

type MetricColor = 'cyan' | 'green' | 'purple' | 'amber' | 'blue';

const metricColorMap: Record<MetricColor, string> = {
  cyan: colors.accent,
  green: colors.success,
  purple: colors.violet,
  amber: colors.warning,
  blue: '#56B4E9',
};

function MetricCard({
  label,
  value,
  icon,
  color,
  subtitle,
}: {
  label: string;
  value: string | number;
  icon: SemanticIconName;
  color: MetricColor;
  subtitle?: string;
}) {
  return (
    <GlassPanel style={styles.metricCard}>
      <View style={styles.metricHead}>
        <SemanticIcon name={icon} size="sm" decorative />
        <AppText
          variant="caption"
          tone="muted"
          weight="semibold"
          numberOfLines={1}
          style={styles.metricLabel}
        >
          {label}
        </AppText>
      </View>
      <AppText
        variant="title"
        weight="bold"
        numberOfLines={1}
        style={[styles.metricValue, { color: metricColorMap[color] }]}
      >
        {value}
      </AppText>
      {subtitle ? (
        <AppText variant="caption" tone="secondary">
          {subtitle}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

function FlowArrow({
  direction,
  power,
  color,
  label,
  locale,
}: {
  direction: 'right' | 'down';
  power: number;
  color: string;
  label: string;
  locale: string;
}) {
  const glyph = direction === 'right' ? '→' : '↓';
  const isActive = Math.abs(power) > 0.01;

  return (
    <View style={styles.flowArrow}>
      <AppText variant="caption" tone="muted" style={styles.flowArrowLabel}>
        {label}
      </AppText>
      <View
        style={[
          styles.flowChip,
          { backgroundColor: withAlpha(color, 0.094) },
          !isActive && styles.dim30,
        ]}
      >
        <AppText variant="caption" weight="semibold" style={{ color }}>
          {glyph} {fmtNum(Math.abs(power), 1, locale)} {t('kW')}
        </AppText>
      </View>
    </View>
  );
}

// Native stand-in for the Recharts AreaChart/BarChart: proportional bars that
// preserve each daily point's data key and proportional intent, with the value
// label beside each bar (the OverviewTab / ChargingTab idiom).
function ChartBars({
  data,
  color,
  format,
  accessibilityLabel,
}: {
  data: { label: string; value: number }[];
  color: string;
  format: (n: number) => string;
  accessibilityLabel: string;
}) {
  const max = data.reduce((m, d) => Math.max(m, safeNumber(d.value)), 0) || 1;
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      style={styles.barList}
    >
      {data.map((d, i) => {
        const width = `${Math.max(
          (safeNumber(d.value) / max) * 100,
          2,
        )}%` as DimensionValue;
        return (
          <View key={`${d.label}-${i}`} style={styles.barRow}>
            <AppText
              variant="caption"
              tone="muted"
              numberOfLines={1}
              style={styles.barLabel}
            >
              {d.label}
            </AppText>
            <View style={styles.barTrack}>
              <View
                style={[styles.barFill, { width, backgroundColor: color }]}
              />
            </View>
            <AppText
              variant="caption"
              tone="secondary"
              numberOfLines={1}
              style={styles.barValue}
            >
              {format(safeNumber(d.value))}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon: SemanticIconName;
  children: ReactNode;
}) {
  return (
    <View style={styles.sectionTitleRow}>
      <SemanticIcon name={icon} size="sm" decorative />
      <AppText weight="semibold" style={styles.sectionTitleText}>
        {children}
      </AppText>
    </View>
  );
}

interface NativeColumn {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: DailyBreakdownEntry) => ReactNode;
}

const HISTORY_PAGE_SIZE = 10;

/* ───────── Main Page ───────── */

export default function EnergyFlowPage() {
  // usePageTitle(t('Energy Flow')) sets the browser tab title on web; there is
  // no native analogue, so the same translated string is the on-screen header.

  /* ── Unit bridge (web useUnits / lib/unitConversion) ── */
  const { data: settings } = useSettings();
  const distanceUnit: DistanceUnitPref =
    settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);

  const fmtNumber = (v: number | null | undefined, decimals: number): string =>
    fmtNum(v, decimals, locale);

  const formatDistance = (value: number | null | undefined): string => {
    if (!isFiniteNumber(value)) {
      return DEFAULT_EMPTY_DISPLAY;
    }
    const digits = resolvePrecision(precision, undefined, 1);
    return `${formatNumber(
      convertDistanceFromSI(value, distanceUnit),
      locale,
      digits,
    )} ${distanceUnit}`;
  };

  const formatEnergy = (value: number | null | undefined): string => {
    if (!isFiniteNumber(value)) {
      return DEFAULT_EMPTY_DISPLAY;
    }
    const digits = resolvePrecision(precision, undefined, 2);
    return `${formatNumber(
      convertEnergyFromSI(value, 'kWh'),
      locale,
      digits,
    )} kWh`;
  };

  /* ── Selected vehicle (web useSelectedVehicle -> first vehicle default) ── */
  const { data: vehicles } = useVehicles();
  const vehicleList = useMemo(() => vehicles ?? [], [vehicles]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(
    null,
  );
  const firstVehicleId = vehicleList.length > 0 ? vehicleList[0].id : null;
  useEffect(() => {
    if (selectedVehicleId == null && firstVehicleId != null) {
      setSelectedVehicleId(firstVehicleId);
    }
  }, [selectedVehicleId, firstVehicleId]);
  const vehicleId = selectedVehicleId ?? firstVehicleId;

  /* ── Range state (web useRangeState, persistKey 'energy-flow.range') ── */
  const [{ start, end }, setRangeValue] = useState<RangeValue>(() =>
    resolvePreset('7d'),
  );
  const setRange = (r: RangeValue) => setRangeValue(r);
  const activePreset = useMemo(() => {
    const match = PRESET_IDS.find(id => {
      const r = resolvePreset(id);
      return r.start === start && r.end === end;
    });
    return match;
  }, [start, end]);

  // Backend currently accepts trailing ?days=N only. We compute days from the
  // selected start/end (inclusive). Custom historical ranges that don't end
  // today still resolve to a trailing window — documented limitation that the
  // presetsOnly RangePicker UI hints at by hiding the calendar grid.
  const days = useMemo(() => {
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T00:00:00`).getTime();
    return Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
  }, [start, end]);

  const activeId = vehicleId != null ? String(vehicleId) : null;

  // Historical stats from GET /vehicles/{id}/energy
  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery({
    queryKey: ['energy-stats', activeId, days],
    queryFn: ({ signal }) =>
      request<EnergyStatsResponse>(
        `/vehicles/${activeId}/energy?days=${days}`,
        {
          signal,
        },
      ),
    enabled: activeId != null,
    staleTime: 30_000,
  });

  // Real-time flow from GET /vehicles/{id}/energy/flow
  const { data: flow } = useEnergyFlow(activeId);

  const isLoading = statsLoading;

  /* ─── Derived: real-time flow ─── */
  const chargePower =
    (flow?.dc_charging_power ?? 0) + (flow?.ac_charging_power ?? 0);
  const batterySOC = flow?.soc ?? 0;
  const chargeState = flow?.charge_state ?? null;

  /* ─── Derived: daily chart data ─── */
  const dailyBreakdown = useMemo(() => stats?.daily_breakdown ?? [], [stats]);

  const dailyChartData = useMemo(
    () =>
      dailyBreakdown.map(d => ({
        date: formatDateShort(d.date),
        energy_wh: d.energy_wh,
        distance: d.distance_m,
      })),
    // Web listed distanceUnit here but never reads it (distance stays raw
    // meters); dropped to satisfy native react-hooks/exhaustive-deps. No
    // behaviour change.
    [dailyBreakdown],
  );

  const efficiencyChartData = useMemo(
    () =>
      dailyBreakdown
        .filter(d => d.efficiency_wh_per_m > 0)
        .map(d => ({
          date: formatDateShort(d.date),
          efficiency:
            distanceUnit === 'km'
              ? Number((d.efficiency_wh_per_m * 1000).toFixed(0))
              : d.efficiency_wh_per_m * 1609.344,
        })),
    // Web omitted distanceUnit though the body reads it; added to satisfy
    // native react-hooks/exhaustive-deps (also fixes a latent web staleness).
    [dailyBreakdown, distanceUnit],
  );

  /* ─── Derived: stat values with unit conversion ─── */
  const totalDistance = formatDistance(stats?.total_distance_m ?? 0);

  const avgEfficiency = useMemo(() => {
    const raw = stats?.avg_efficiency_wh_per_m ?? 0;
    return distanceUnit === 'km'
      ? Number((raw * 1000).toFixed(0))
      : Math.round(raw * 1609.344);
  }, [stats, distanceUnit]);

  const efficiencyUnit = distanceUnit === 'km' ? 'Wh/km' : 'Wh/mi';

  const avgEnergyPerDay = useMemo(() => {
    const period = stats?.period_days ?? 0;
    return period > 0 ? (stats?.total_energy_used_wh ?? 0) / period : 0;
  }, [stats]);

  /* ─── Table ─── */
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('date', 'desc');
  const [historyPage, setHistoryPage] = useState(0);

  const sortedDailyRows = useMemo(() => {
    const rows = dailyBreakdown.slice();
    return sortFn(rows, (row, key) => {
      if (key === 'energy_wh') return row.energy_wh;
      if (key === 'distance_m') return row.distance_m;
      if (key === 'efficiency_wh_per_m') return row.efficiency_wh_per_m;
      return row.date;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyBreakdown, sortKey, sortDir]);

  const historyColumns: NativeColumn[] = useMemo(
    () => [
      {
        key: 'date',
        header: t('Date'),
        sortable: true,
        render: row => (
          <AppText variant="caption" tone="secondary">
            {formatDateShort(row.date)}
          </AppText>
        ),
      },
      {
        key: 'energy_wh',
        header: t('Energy'),
        sortable: true,
        render: row => (
          <AppText variant="caption" weight="semibold">
            {formatEnergy(row.energy_wh)}
          </AppText>
        ),
      },
      {
        key: 'distance_m',
        header: `${t('Distance')} (${distanceUnit})`,
        sortable: true,
        render: row => (
          <AppText variant="caption">{formatDistance(row.distance_m)}</AppText>
        ),
      },
      {
        key: 'efficiency_wh_per_m',
        header: efficiencyUnit,
        sortable: true,
        render: row => {
          const val =
            distanceUnit === 'km'
              ? row.efficiency_wh_per_m * 1000
              : row.efficiency_wh_per_m * 1609.344;
          return <AppText variant="caption">{fmtNumber(val, 0)}</AppText>;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [distanceUnit, efficiencyUnit, locale, precision],
  );

  const pageCount = Math.max(
    1,
    Math.ceil(sortedDailyRows.length / HISTORY_PAGE_SIZE),
  );
  const safePage = Math.min(historyPage, pageCount - 1);
  const pagedRows = sortedDailyRows.slice(
    safePage * HISTORY_PAGE_SIZE,
    safePage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE,
  );

  /* ───── Vehicle & Range Controls ───── */

  const actions = (
    <View style={styles.actions}>
      <View style={styles.pillGroup} testID="energy-flow-vehicle-select">
        {vehicleList.map(v => {
          const selected = v.id === vehicleId;
          return (
            <Pressable
              key={v.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setSelectedVehicleId(v.id)}
              style={({ pressed }) => [
                styles.pill,
                selected && styles.pillActive,
                pressed && styles.dim30,
              ]}
            >
              <AppText
                variant="caption"
                weight="semibold"
                tone={selected ? 'accent' : 'secondary'}
                numberOfLines={1}
              >
                {v.display_name || v.vin || `Vehicle ${v.id}`}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.pillGroup} testID="energy-flow-range">
        {PRESET_IDS.map(id => {
          const selected = id === activePreset;
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => {
                setRange(resolvePreset(id));
                setHistoryPage(0);
              }}
              style={({ pressed }) => [
                styles.pill,
                selected && styles.pillActive,
                pressed && styles.dim30,
              ]}
            >
              <AppText
                variant="caption"
                weight="semibold"
                tone={selected ? 'accent' : 'secondary'}
              >
                {presetLabel(id)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const header = (
    <View style={styles.header}>
      <AppText variant="title" weight="bold">
        {t('Energy Flow')}
      </AppText>
      <AppText variant="caption" tone="secondary">
        {t('Power distribution and energy analysis')}
      </AppText>
      {actions}
    </View>
  );

  /* ───── Loading skeleton ───── */

  if (isLoading) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        testID="energy-flow-page"
      >
        {header}
        <View style={styles.metricGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.skeletonCard} />
          ))}
        </View>
      </ScrollView>
    );
  }

  /* ───── Empty / Error ───── */

  if (!stats && !isLoading) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        testID="energy-flow-page"
      >
        {header}
        <GlassPanel style={styles.panel}>
          <View style={styles.emptyWrap}>
            <SemanticIcon name="bolt" size="lg" decorative />
            <EmptyState
              title={statsError ? t('Error') : t('No Data')}
              message={t(
                'No energy flow data available for this vehicle and time range.',
              )}
            />
          </View>
        </GlassPanel>
      </ScrollView>
    );
  }

  /* ─── Efficiency thresholds (unit-aware) ─── */
  const excellentThreshold = distanceUnit === 'km' ? 150 : 240;
  const goodThreshold = distanceUnit === 'km' ? 200 : 320;

  const efficiencyBand: { label: string; variant: BadgeVariant } =
    avgEfficiency === 0
      ? { label: t('No Data'), variant: 'neutral' }
      : avgEfficiency < excellentThreshold
      ? { label: t('Excellent'), variant: 'success' }
      : avgEfficiency < goodThreshold
      ? { label: t('Good'), variant: 'warning' }
      : { label: t('High'), variant: 'danger' };

  /* ───── Main render ───── */

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="energy-flow-page"
    >
      {header}

      {/* ── Section 1: Energy Flow Diagram (real-time via /energy/flow) ── */}
      <GlassPanel style={styles.panel}>
        <View style={styles.flowHeader}>
          <SectionTitle icon="bolt">{t('Energy Flow Diagram')}</SectionTitle>
          {chargeState ? (
            <Badge variant={chargeState === 'Charging' ? 'success' : 'neutral'}>
              {t(chargeState)}
            </Badge>
          ) : null}
        </View>

        <View style={styles.flowRow}>
          {/* Grid → Battery */}
          <GlassPanel style={styles.flowNode}>
            <SemanticIcon name="charger" size="md" decorative />
            <AppText variant="caption" tone="secondary">
              {t('Grid')}
            </AppText>
          </GlassPanel>

          <FlowArrow
            direction="right"
            power={chargePower}
            color={CHART_COLORS[1]}
            label={t('Charging')}
            locale={locale}
          />

          {/* Battery center — SOC from real-time flow */}
          <GlassPanel style={styles.flowNodeCenter}>
            <SemanticIcon name="battery" size="md" decorative />
            <RadialGauge
              value={batterySOC}
              max={100}
              label={t('Battery')}
              unit="%"
              color={CHART_COLORS[0]}
              size={100}
            />
            {flow?.energy_remaining != null ? (
              <AppText variant="caption" tone="muted">
                {fmtNumber(flow.energy_remaining, 1)} {t('kWh')}
              </AppText>
            ) : null}
          </GlassPanel>

          {/* Motor — no real-time data available */}
          <View style={styles.flowArrow}>
            <AppText
              variant="caption"
              tone="muted"
              style={styles.flowArrowLabel}
            >
              {t('Driving')}
            </AppText>
            <View
              style={[
                styles.flowChip,
                { backgroundColor: withAlpha(CHART_COLORS[0], 0.094) },
                styles.dim30,
              ]}
            >
              <AppText
                variant="caption"
                weight="semibold"
                style={{ color: CHART_COLORS[0] }}
              >
                → {t('N/A')}
              </AppText>
            </View>
          </View>

          <GlassPanel style={[styles.flowNode, styles.dim50]}>
            <SemanticIcon name="vehicle" size="md" decorative />
            <AppText variant="caption" tone="secondary">
              {t('Motor')}
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('No live data')}
            </AppText>
          </GlassPanel>
        </View>

        {/* Bottom row: live charging breakdown + greyed-out aux */}
        <View style={styles.flowBottomRow}>
          <GlassPanel style={styles.flowMini}>
            <SemanticIcon name="bolt" size="sm" decorative />
            <AppText variant="caption" tone="muted">
              {t('DC Power')}
            </AppText>
            <AppText
              variant="caption"
              weight="semibold"
              style={{ color: CHART_COLORS[1] }}
            >
              {fmtNumber(flow?.dc_charging_power ?? 0, 1)} {t('kW')}
            </AppText>
          </GlassPanel>

          <GlassPanel style={styles.flowMini}>
            <SemanticIcon name="activity" size="sm" decorative />
            <AppText variant="caption" tone="muted">
              {t('AC Power')}
            </AppText>
            <AppText
              variant="caption"
              weight="semibold"
              style={{ color: CHART_COLORS[5] }}
            >
              {fmtNumber(flow?.ac_charging_power ?? 0, 1)} {t('kW')}
            </AppText>
          </GlassPanel>

          <GlassPanel style={[styles.flowMini, styles.dim50]}>
            <SemanticIcon name="climate" size="sm" decorative />
            <AppText variant="caption" tone="muted">
              {t('HVAC')}
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('N/A')}
            </AppText>
          </GlassPanel>

          <GlassPanel style={[styles.flowMini, styles.dim50]}>
            <SemanticIcon name="cpu" size="sm" decorative />
            <AppText variant="caption" tone="muted">
              {t('Accessories')}
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('N/A')}
            </AppText>
          </GlassPanel>
        </View>
      </GlassPanel>

      {/* ── Section 2: Summary MetricCards (historical from /energy) ── */}
      <View style={styles.metricGrid}>
        <MetricCard
          label={t('Total Energy')}
          value={formatEnergy(stats?.total_energy_used_wh ?? 0)}
          icon="bolt"
          color="cyan"
        />
        <MetricCard
          label={t('Total Charged')}
          value={formatEnergy(stats?.total_energy_charged_wh ?? 0)}
          icon="charger"
          color="green"
        />
        <MetricCard
          label={t('Distance')}
          value={totalDistance}
          icon="vehicle"
          color="purple"
          subtitle={distanceUnit}
        />
        <MetricCard
          label={t('Efficiency')}
          value={avgEfficiency}
          icon="efficiency"
          color="amber"
          subtitle={efficiencyUnit}
        />
        <MetricCard
          label={t('CO₂ Saved')}
          value={fmtNumber(stats?.co2_saved_kg ?? 0, 1)}
          icon="leaf"
          color="green"
          subtitle={t('kg')}
        />
        <MetricCard
          label={t('Period')}
          value={String(stats?.period_days ?? 0)}
          icon="calendar"
          color="blue"
          subtitle={t('days')}
        />
      </View>

      {/* ── Section 3: Daily Energy Usage AreaChart ── */}
      <GlassPanel style={styles.panel}>
        <SectionTitle icon="activity">{t('Daily Energy Usage')}</SectionTitle>
        {dailyChartData.length > 0 ? (
          <ChartBars
            data={dailyChartData.map(d => ({
              label: d.date,
              value: d.energy_wh,
            }))}
            color={CHART_COLORS[0]}
            format={formatEnergy}
            accessibilityLabel={`${t('Daily Energy Usage')} (${t('Energy')})`}
          />
        ) : (
          <EmptyState
            title={t('Daily Energy Usage')}
            message={t('No daily energy data available.')}
          />
        )}
      </GlassPanel>

      {/* ── Section 4: Daily Distance + Efficiency Charts ── */}
      <View style={styles.chartGrid}>
        {/* Daily Distance BarChart */}
        <GlassPanel style={styles.panel}>
          <SectionTitle icon="analytics">{t('Daily Distance')}</SectionTitle>
          {dailyChartData.length > 0 ? (
            <ChartBars
              data={dailyChartData.map(d => ({
                label: d.date,
                value: d.distance,
              }))}
              color={CHART_COLORS[1]}
              format={formatDistance}
              accessibilityLabel={`${t('Daily Distance')} (${distanceUnit})`}
            />
          ) : (
            <EmptyState
              title={t('Daily Distance')}
              message={t('No daily distance data available.')}
            />
          )}
        </GlassPanel>

        {/* Efficiency Over Time */}
        <GlassPanel style={styles.panel}>
          <SectionTitle icon="trendUp">{t('Daily Efficiency')}</SectionTitle>
          {efficiencyChartData.length > 0 ? (
            <ChartBars
              data={efficiencyChartData.map(d => ({
                label: d.date,
                value: d.efficiency,
              }))}
              color={CHART_COLORS[3]}
              format={v => `${fmtNumber(v, 0)} ${efficiencyUnit}`}
              accessibilityLabel={`${t(
                'Daily Efficiency',
              )} (${efficiencyUnit})`}
            />
          ) : (
            <EmptyState
              title={t('Daily Efficiency')}
              message={t('No efficiency data available.')}
            />
          )}
        </GlassPanel>
      </View>

      {/* ── Section 5: Efficiency Metrics ── */}
      <GlassPanel style={styles.panel}>
        <SectionTitle icon="trendUp">{t('Efficiency Metrics')}</SectionTitle>
        <View style={styles.chartGrid}>
          <GlassPanel style={styles.effCard}>
            <AppText variant="caption" tone="muted">
              {efficiencyUnit}
            </AppText>
            <AppText
              variant="display"
              weight="bold"
              style={{ color: CHART_COLORS[0] }}
            >
              {fmtNumber(avgEfficiency, 0)}
            </AppText>
            <Badge variant={efficiencyBand.variant}>
              {efficiencyBand.label}
            </Badge>
          </GlassPanel>

          <GlassPanel style={styles.effCard}>
            <AppText variant="caption" tone="muted">
              {t('CO₂ Saved')}
            </AppText>
            <AppText
              variant="display"
              weight="bold"
              style={{ color: CHART_COLORS[1] }}
            >
              {fmtNumber(stats?.co2_saved_kg ?? 0, 1)}
            </AppText>
            <Badge variant="success">{t('kg CO₂')}</Badge>
          </GlassPanel>

          <GlassPanel style={styles.effCard}>
            <AppText variant="caption" tone="muted">
              {t('Avg Energy/Day')}
            </AppText>
            <AppText
              variant="display"
              weight="bold"
              style={{ color: CHART_COLORS[3] }}
            >
              {formatEnergy(avgEnergyPerDay)}
            </AppText>
            <Badge variant="info">{t('per day')}</Badge>
          </GlassPanel>
        </View>
      </GlassPanel>

      {/* ── Section 6: Daily Energy History Table ── */}
      <GlassPanel style={styles.panel}>
        <SectionTitle icon="analytics">
          {t('Daily Energy History')}
        </SectionTitle>
        {sortedDailyRows.length > 0 ? (
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeaderRow]}>
              {historyColumns.map(col => {
                const active = col.key === sortKey;
                const indicator = active
                  ? sortDir === 'asc'
                    ? ' ▲'
                    : ' ▼'
                  : '';
                return (
                  <Pressable
                    key={col.key}
                    disabled={!col.sortable}
                    onPress={() => col.sortable && onSort(col.key)}
                    style={styles.tableCell}
                  >
                    <AppText
                      variant="caption"
                      tone={active ? 'accent' : 'muted'}
                      weight="semibold"
                      numberOfLines={1}
                    >
                      {col.header}
                      {indicator}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            {pagedRows.map(row => (
              <View key={row.date} style={styles.tableRow}>
                {historyColumns.map(col => (
                  <View key={col.key} style={styles.tableCell}>
                    {col.render(row)}
                  </View>
                ))}
              </View>
            ))}

            {pageCount > 1 ? (
              <View style={styles.pagination}>
                <Pressable
                  accessibilityRole="button"
                  disabled={safePage <= 0}
                  onPress={() => setHistoryPage(p => Math.max(0, p - 1))}
                  style={({ pressed }) => [
                    styles.pageButton,
                    (safePage <= 0 || pressed) && styles.dim30,
                  ]}
                >
                  <AppText variant="caption" weight="semibold" tone="secondary">
                    {t('Prev')}
                  </AppText>
                </Pressable>
                <AppText variant="caption" tone="muted">
                  {safePage + 1} / {pageCount}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  disabled={safePage >= pageCount - 1}
                  onPress={() =>
                    setHistoryPage(p => Math.min(pageCount - 1, p + 1))
                  }
                  style={({ pressed }) => [
                    styles.pageButton,
                    (safePage >= pageCount - 1 || pressed) && styles.dim30,
                  ]}
                >
                  <AppText variant="caption" weight="semibold" tone="secondary">
                    {t('Next')}
                  </AppText>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : (
          <EmptyState
            title={t('Daily Energy History')}
            message={t('No energy history records available.')}
          />
        )}
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
  },
  pillGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surfaceGlass,
  },
  pillActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitleText: {
    color: colors.textPrimary,
  },
  flowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  flowRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  flowNode: {
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
    minWidth: 96,
  },
  flowNodeCenter: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    minWidth: 140,
  },
  flowArrow: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  flowArrowLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  flowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  flowBottomRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  flowMini: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 120,
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
  },
  dim30: {
    opacity: 0.3,
  },
  dim50: {
    opacity: 0.5,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 150,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  metricHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metricLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    flexShrink: 1,
  },
  metricValue: {
    marginTop: spacing.xs,
  },
  skeletonCard: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 150,
    height: 120,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
  },
  chartGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  barList: {
    gap: spacing.xs,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  barLabel: {
    width: 52,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  barValue: {
    minWidth: 72,
    textAlign: 'right',
  },
  effCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 150,
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  table: {
    gap: spacing.xs,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHeaderRow: {
    borderBottomColor: colors.borderAccent,
  },
  tableCell: {
    flex: 1,
    minWidth: 0,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  pageButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surfaceGlass,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
});

const badgeStyles = StyleSheet.create({
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  neutral: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  info: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
});

const badgeText = StyleSheet.create({
  success: {
    color: colors.success,
  },
  neutral: {
    color: colors.textSecondary,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  info: {
    color: colors.accent,
  },
});
