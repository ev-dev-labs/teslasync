// Native parity port of web/src/features/driving/pages/DrivetrainHealthPage.tsx.
//
// DrivetrainHealthPage is the motor/inverter/battery thermal dashboard. It is a
// thin orchestrator: it fetches drivetrain health, drives, driving stats, the
// latest motor snapshot, motor history and live HV-isolation state, derives a
// sensor list + several chart-data memos, and composes twelve sibling sections
// (HealthOverview, HealthGaugeGrid, TemperatureGauges, TemperatureMetricCards,
// ThermalLoadPanel, LiveMotorStatus, StatorTempChart, TorqueHistoryChart,
// TemperatureTrendChart, PowerOutputChart, HealthRecommendations, DetailCards)
// under a PageContainer with a VehicleSelect + RangePicker action row. When the
// health query has no data a single EmptyState shows instead.
//
// The web original composes the shared DOM page kit (PageContainer, GlassPanel,
// Grid, Badge, Card, KVList, MetricCard, MetricBar, InlineMetric, AnimatedNumber,
// RadialGauge, AlertBanner, EmptyState, Skeleton, FadeIn/Stagger), the Recharts
// Line/Area chart trees, lucide SVG icons, react-i18next, the app-level
// useSelectedVehicle / useVehicleLive / useUnits / usePageTitle / useDateFormat /
// useUrlState hooks and the @/lib/unitConversion SI converters + @/lib/numberFormat
// formatters. React Native has no DOM, Recharts/SVG, Tailwind, lucide, browser
// URL/SSE or wired react-i18next, so — following the established self-contained
// page idiom (CostAnalysisPage, FleetComparePage) — this port reproduces the
// page with RN primitives + the shared native parity building blocks, imports the
// two CONVERTED siblings, reproduces the other ten inline, and documents every
// adaptation in the sidecar:
//
//   - The two CONVERTED siblings are imported, not re-inlined: the native
//     drivetrain-health/TemperatureTrendChart (tempTrendData) and
//     HealthRecommendations (overallHealth) — exactly the web wiring.
//   - The ten not-yet-converted siblings + the ./constants + ./helpers modules
//     (HEALTH_SCORE / HEALTH_COLOR / tempSeverityColor / tempNeonColor /
//     displayTemp / healthBadge tone) are reproduced inline with native
//     View/AppText/GlassPanel/RadialGauge/SemanticIcon/ChartContainer layers,
//     preserving every section, label, i18n key + default, colour intent and the
//     per-section data shaping.
//   - The real data hooks are called unchanged: useDrivetrainHealth / useDrives /
//     useDrivingStats / useMotorLatest / useMotorHistory (native web-parity
//     hooks), so every API path is preserved.
//   - @/hooks/useUnits + @/hooks/useDateFormat are derived from the native
//     useSettings() AppSettings query exactly as the web hooks derive them
//     (unit_of_length === 'mi', unit_of_temp === 'F'); the SI converters
//     (convertDistanceFromSI / convertSpeedFromSI / convertTempFromSI /
//     convertEnergyFromSI) and the formatTemperature / formatEnergy / fmtNumber /
//     fmtInt formatters are inlined verbatim from @/lib/unitConversion +
//     @/lib/numberFormat (same SI math, same precision resolution, same '—'
//     nullish fallback, en-US grouping — matching the already-converted siblings).
//     No unit math is invented.
//   - @/hooks/useSelectedVehicle has no native global selection context, so the
//     `vehicleId` name is preserved as local state seeded to the first
//     useVehicles() vehicle; the actions-row VehicleSelect becomes a native
//     segmented pill group (the CostAnalysisPage idiom).
//   - useUrlString('from'/'to') + useUrlBatch (URL query state) have no native
//     URL; `startDate` / `endDate` / `setRangeBatch` keep their exact names as
//     local state, and the web RangePicker becomes a native preset range control.
//   - useVehicleLive (browser SSE) -> a native useVehicleLiveSignals poll that
//     parses only the IsolationResistance signal this page consumes; the
//     `/signals/{id}/live` path is preserved (documented).
//   - usePageTitle (document.title) has no native analogue -> the same translated
//     title renders in the on-screen header instead.
//   - Recharts (Stator/Torque/Power charts) -> the shared native ChartContainer +
//     a hand-drawn multi-series dot/grid/reference-line trace (the converted
//     TemperatureTrendChart idiom); the accessible data-table fallback is owned by
//     ChartContainer via data + dataColumns. PowerOutputChart's URL-persisted
//     useHiddenSeries declutter has no native URL, so both series always show.
//   - lucide icons (Zap/Cpu/BatteryCharging/Activity/Thermometer/Heart/Shield/
//     TrendingUp/Cog/CheckCircle/AlertTriangle) map onto the shared native
//     SemanticIcon glyph set; GlassPanel `glow` -> a tinted border by health.
//   - react-i18next useTranslation -> a native key/English-default `t` fallback
//     that preserves every drivetrain.* key + default verbatim.
//
// State names (vehicleId, startDate, endDate), every API path, the unit handling
// (SI distance/speed/temperature converted only at the display boundary), the
// sensors / chartData / tempTrendData / avgPowerMax / peakPower / minRegenPower /
// motorChartData memos and the section order are preserved. No DOM, Recharts,
// Leaflet, framer-motion, lucide-react, or old web UI components are imported.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useDrivetrainHealth,
  useDrives,
  useDrivingStats,
  type Drive,
  type DrivetrainHealthData,
  type DrivingStats,
} from '../../../api/hooks/useDriving';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicleLiveSignals} from '../../../api/hooks/useTelemetry';
import {
  useMotorHistory,
  useMotorLatest,
  useVehicles,
  type MotorSnapshot,
} from '../../../api/hooks/useVehicles';
import {ChartContainer, RadialGauge} from '../../../components/charts';
import {HealthRecommendations} from '../components/drivetrain-health/HealthRecommendations';
import {TemperatureTrendChart} from '../components/drivetrain-health/TemperatureTrendChart';

/* ─── i18n fallback ─────────────────────────────────────────────────────────
   react-i18next is not wired in native; i18next returns the supplied default
   when a translation is missing. The fallback keeps every drivetrain.* key +
   English default verbatim at the call sites and supports {{var}} interpolation
   (used by drivetrain.health.<status>). */

type TVars = Record<string, string | number>;

function t(_key: string, fallback: string, vars?: TVars): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const value = vars[k];
    return value == null ? '' : String(value);
  });
}

/* ─── Inlined SI converters + formatters (verbatim from @/lib/unitConversion +
   @/lib/numberFormat; the native lib module is not a converted target). ─────── */

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '°C' | '°F';
type EnergyUnitPref = 'Wh' | 'kWh';

interface UnitPref {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
  energy: EnergyUnitPref;
  precision?: number;
}

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
  }
}

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Mirrors @/lib/numberFormat fmtNumber: safeNumber guard + en-US grouping (the
// global locale/precision settings are not wired natively, matching the already-
// converted drivetrain siblings).
function fmtNumber(v: unknown, decimals = 0): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

function resolvePrecision(
  override: number | undefined,
  prefPrecision: number | undefined,
  fallback: number,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
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

// Mirrors @/lib/unitConversion formatTemperature (DEFAULT_PRECISION.temperature = 1,
// no space before the °unit) with the '—' nullish fallback.
function formatTemperatureWith(
  celsius: number | null | undefined,
  pref: UnitPref,
  precision?: number,
): string {
  if (!isFiniteNumber(celsius)) {
    return '\u2014';
  }
  const digits = resolvePrecision(precision, pref.precision, 1);
  return `${fmtNumber(
    convertTempFromSI(celsius, pref.temperature),
    digits,
  )}${pref.temperature}`;
}

// Mirrors @/lib/unitConversion formatEnergy (DEFAULT_PRECISION.energy = 2, space
// before the unit) with the '—' nullish fallback.
function formatEnergyWith(
  wh: number | null | undefined,
  pref: UnitPref,
  precision?: number,
): string {
  if (!isFiniteNumber(wh)) {
    return '\u2014';
  }
  const digits = resolvePrecision(precision, pref.precision, 2);
  return `${fmtNumber(convertEnergyFromSI(wh, pref.energy), digits)} ${pref.energy}`;
}

function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(decimalPrecision) || decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

// Mirrors @/hooks/useUnits: derives the distance/speed/temperature prefs from
// useSettings exactly as web's deriveDistance/deriveSpeed/deriveTemperature do.
function useUnits(): {unitPrefs: UnitPref} {
  const {data: settings} = useSettings();
  const distance: DistanceUnitPref =
    settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  const speed: SpeedUnitPref = settings?.unit_of_length === 'mi' ? 'mph' : 'km/h';
  const temperature: TemperatureUnitPref =
    settings?.unit_of_temp === 'F' ? '°F' : '°C';
  const precision = derivePrecision(settings?.decimal_precision);
  return useMemo(
    () => ({
      unitPrefs: {distance, speed, temperature, energy: 'kWh', precision},
    }),
    [distance, speed, temperature, precision],
  );
}

/* ─── Inlined date helpers (mirror @/hooks/useDateFormat formatTime /
   formatDateShort with the '—' invalid fallback). ────────────────────────────── */

interface DateHelpers {
  formatDateShort: (iso: string | Date | null | undefined) => string;
  formatTime: (iso: string | Date | null | undefined) => string;
}

function useDateHelpers(): DateHelpers {
  const {data: settings} = useSettings();
  const locale =
    settings?.locale && settings.locale.trim().length > 0
      ? settings.locale
      : undefined;
  return useMemo<DateHelpers>(() => {
    const formatDateShort = (iso: string | Date | null | undefined): string => {
      if (!iso) {
        return '\u2014';
      }
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) {
        return '\u2014';
      }
      return d.toLocaleDateString(locale, {day: 'numeric', month: 'short'});
    };
    const formatTime = (iso: string | Date | null | undefined): string => {
      if (!iso) {
        return '\u2014';
      }
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) {
        return '\u2014';
      }
      return d.toLocaleTimeString(locale ?? [], {
        hour: '2-digit',
        minute: '2-digit',
      });
    };
    return {formatDateShort, formatTime};
  }, [locale]);
}

/* ─── Inlined useVehicleLive (only the IsolationResistance signal this page
   consumes); preserves the `/signals/{id}/live` path via useVehicleLiveSignals. */

function useIsolationResistance(vehicleId?: number): number | null {
  const {data} = useVehicleLiveSignals(vehicleId);
  return useMemo(() => {
    const signals = data?.signals;
    if (!signals) {
      return null;
    }
    const entry = (signals as Record<string, unknown>).IsolationResistance;
    const raw =
      entry && typeof entry === 'object' && 'value' in entry
        ? (entry as {value: unknown}).value
        : entry;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }, [data]);
}

/* ─── Inlined ./constants + ./helpers ───────────────────────────────────────── */

type HealthStatus = 'good' | 'warning' | 'critical';

const HEALTH_SCORE: Record<HealthStatus, number> = {
  good: 95,
  warning: 60,
  critical: 25,
};

const HEALTH_COLOR: Record<HealthStatus, string> = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
};

type SemanticTone = 'success' | 'warning' | 'danger';

function healthBadgeTone(health: HealthStatus): SemanticTone {
  if (health === 'good') {
    return 'success';
  }
  if (health === 'warning') {
    return 'warning';
  }
  return 'danger';
}

function tempSeverityColor(celsius: number | null, max: number): string {
  if (celsius === null) {
    return '#6b7280';
  }
  const ratio = celsius / max;
  if (ratio >= 0.85) {
    return HEALTH_COLOR.critical;
  }
  if (ratio >= 0.65) {
    return HEALTH_COLOR.warning;
  }
  return HEALTH_COLOR.good;
}

type NeonTone = 'green' | 'amber' | 'red';

function tempNeonColor(celsius: number | null, max: number): NeonTone {
  if (celsius === null) {
    return 'green';
  }
  const ratio = celsius / max;
  if (ratio >= 0.85) {
    return 'red';
  }
  if (ratio >= 0.65) {
    return 'amber';
  }
  return 'green';
}

function displayTemp(
  celsius: number | null,
  formatTemperature: (c: number | null | undefined, precision?: number) => string,
): string {
  if (celsius === null) {
    return '\u2014';
  }
  return formatTemperature(celsius);
}

const NEON_COLOR: Record<NeonTone | 'purple' | 'cyan', string> = {
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#8b5cf6',
  cyan: '#06b6d4',
};

interface TempSensor {
  key: string;
  labelKey: string;
  defaultLabel: string;
  value: number | null;
  maxTemp: number;
  color: string;
  icon: SemanticIconName;
}

interface ChartDataPoint {
  date: string;
  powerMax: number;
  powerMin: number;
  outsideTemp: number | null;
  distance: number;
}

interface MotorChartDataPoint {
  time: string;
  stator: number | null;
  statorRel: number | null;
  statorRer: number | null;
  torque: number | null;
  speed: number | null;
  axle: number | null;
}

/* ─── Small native presentational primitives ────────────────────────────────── */

function FadeIn({children}: {children: React.ReactNode; delay?: number}) {
  return <View style={styles.fadeIn}>{children}</View>;
}

function PanelHeading({
  icon,
  children,
}: {
  icon?: SemanticIconName;
  children: string;
}) {
  return (
    <View style={styles.panelHeading}>
      {icon ? <SemanticIcon decorative name={icon} size="sm" /> : null}
      <AppText
        tone="muted"
        variant="caption"
        weight="semibold"
        style={styles.panelHeadingText}>
        {children}
      </AppText>
    </View>
  );
}

interface KVItem {
  label: string;
  value: string;
}

function KVList({items}: {items: KVItem[]}) {
  return (
    <View style={styles.kvList}>
      {items.map(item => (
        <View key={item.label} style={styles.kvRow}>
          <AppText tone="muted" variant="caption" style={styles.kvLabel}>
            {item.label}
          </AppText>
          <AppText weight="semibold" variant="caption" style={styles.kvValue}>
            {item.value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function MetricBar({
  label,
  value,
  max,
  color,
  sublabel,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  sublabel: string;
}) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <View style={styles.metricBar}>
      <View style={styles.metricBarHeader}>
        <AppText tone="secondary" variant="caption">
          {label}
        </AppText>
        <AppText weight="semibold" variant="caption" style={{color}}>
          {sublabel}
        </AppText>
      </View>
      <View style={styles.metricBarTrack}>
        <View
          style={[
            styles.metricBarFill,
            {backgroundColor: color, width: `${ratio * 100}%` as DimensionValue},
          ]}
        />
      </View>
    </View>
  );
}

function InlineMetric({
  icon,
  iconColor,
  label,
  value,
}: {
  icon: SemanticIconName;
  iconColor: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.inlineMetric}>
      <View style={[styles.inlineMetricDot, {backgroundColor: iconColor}]}>
        <SemanticIcon decorative name={icon} size="sm" />
      </View>
      <View style={styles.flex1}>
        <AppText tone="muted" variant="caption" numberOfLines={1}>
          {label}
        </AppText>
        <AppText weight="semibold" variant="caption" numberOfLines={1}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

function MetricChip({
  label,
  value,
  subtitle,
  color,
  icon,
}: {
  label: string;
  value: string;
  subtitle?: string;
  color: string;
  icon: SemanticIconName;
}) {
  return (
    <GlassPanel style={[styles.metricChip, {borderColor: `${color}55`}]}>
      <View style={styles.metricChipHeader}>
        <SemanticIcon decorative name={icon} size="sm" />
        <AppText tone="muted" variant="caption" numberOfLines={1} style={styles.flex1}>
          {label}
        </AppText>
      </View>
      <AppText weight="bold" variant="title" style={{color}}>
        {value}
      </AppText>
      {subtitle ? (
        <AppText tone="muted" variant="caption" numberOfLines={1}>
          {subtitle}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.statBox}>
      <AppText tone="muted" variant="caption" numberOfLines={1} style={styles.statBoxLabel}>
        {label}
      </AppText>
      <AppText weight="bold" numberOfLines={1} style={[styles.statBoxValue, {color}]}>
        {value}
      </AppText>
    </View>
  );
}

/* ─── Header controls (mirror the web VehicleSelect + RangePicker action row) ── */

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
              tone={selected ? 'accent' : 'secondary'}
              variant="caption"
              numberOfLines={1}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function isoToday(): string {
  return new Date().toISOString().split('T')[0];
}

function RangePicker({
  value,
  onChange,
}: {
  value: {start: string; end: string};
  onChange: (r: {start: string; end: string}) => void;
}) {
  const presets: {label: string; days: number}[] = [
    {label: '30D', days: 30},
    {label: '90D', days: 90},
    {label: '1Y', days: 365},
  ];
  return (
    <View testID="drivetrain-health-range-picker" style={styles.rangeRow}>
      <AppText tone="muted" variant="caption" numberOfLines={1}>
        {value.start} → {value.end}
      </AppText>
      <View style={styles.pillRow}>
        {presets.map(p => (
          <Pressable
            key={p.label}
            accessibilityRole="button"
            onPress={() => onChange({end: isoToday(), start: isoDaysAgo(p.days)})}
            style={styles.pill}>
            <AppText tone="secondary" variant="caption">
              {p.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* ─── Native multi-series chart (ChartContainer + hand-drawn dot/grid/ref trace,
   the converted TemperatureTrendChart idiom; replaces the Recharts trees). ───── */

interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

interface ChartRefLine {
  value: number;
  color: string;
  label: string;
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

function chartWithin(value: number, domain: ChartDomain): boolean {
  return value >= domain.min && value <= domain.max;
}

function sampleRows<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) {
    return rows;
  }
  const step = (rows.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(rows[Math.round(i * step)]);
  }
  return out;
}

type ChartRow = Record<string, string | number | null>;

function NativeSeriesChart({
  ariaLabel,
  data,
  dataColumns,
  height,
  refLines,
  series,
  subtitle,
  title,
  xKey,
}: {
  ariaLabel: string;
  data: ChartRow[];
  dataColumns: {key: string; label: string}[];
  height: number;
  refLines?: ChartRefLine[];
  series: ChartSeries[];
  subtitle: string;
  title: string;
  xKey: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const points = useMemo(() => sampleRows(data, CHART_MAX_COLUMNS), [data]);

  const domain = useMemo(() => {
    const values: number[] = [];
    data.forEach(row => {
      series.forEach(s => {
        const v = row[s.key];
        if (typeof v === 'number' && Number.isFinite(v)) {
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
      : Math.min(Math.max(selectedIndex ?? points.length - 1, 0), points.length - 1);
  const selected = points[activeIndex];

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  return (
    <ChartContainer
      ariaLabel={ariaLabel}
      data={data}
      dataColumns={dataColumns}
      height={height}
      subtitle={subtitle}
      title={title}>
      <View style={styles.chartContent}>
        <View style={styles.chartFrame}>
          <View style={styles.chartYAxis}>
            {yTicks.map((tick, index) => (
              <AppText
                key={`y-${index}`}
                numberOfLines={1}
                tone="muted"
                variant="caption"
                style={styles.chartYTick}>
                {fmtInt(tick)}
              </AppText>
            ))}
          </View>

          <View style={styles.chartPlotColumn}>
            <View
              accessible
              accessibilityLabel={ariaLabel}
              accessibilityRole="image"
              style={styles.chartPlotArea}>
              {CHART_GRID_LINES.map(line => (
                <View
                  key={`grid-${line}`}
                  pointerEvents="none"
                  style={[styles.chartGridLine, {top: `${line}%` as DimensionValue}]}
                />
              ))}

              {(refLines ?? []).map(ref =>
                chartWithin(ref.value, domain) ? (
                  <View
                    key={`ref-${ref.label}`}
                    pointerEvents="none"
                    style={[
                      styles.chartRefLine,
                      {
                        borderTopColor: ref.color,
                        bottom: `${chartPct(ref.value, domain).toFixed(
                          2,
                        )}%` as DimensionValue,
                      },
                    ]}>
                    <AppText
                      numberOfLines={1}
                      variant="caption"
                      style={[styles.chartRefLabel, {color: ref.color}]}>
                      {ref.label}
                    </AppText>
                  </View>
                ) : null,
              )}

              <View style={styles.chartColumnsRow}>
                {points.map((point, index) => {
                  const isSelected = index === activeIndex;
                  return (
                    <Pressable
                      key={`col-${index}`}
                      accessibilityLabel={String(point[xKey] ?? '')}
                      accessibilityRole="button"
                      accessibilityState={{selected: isSelected}}
                      onPress={() => handleSelect(index)}
                      style={styles.chartSampleColumn}>
                      {isSelected ? (
                        <View pointerEvents="none" style={styles.chartSelectedColumn} />
                      ) : null}
                      {series.map(s => {
                        const v = point[s.key];
                        if (typeof v !== 'number' || !Number.isFinite(v)) {
                          return null;
                        }
                        return (
                          <View
                            key={s.key}
                            pointerEvents="none"
                            style={[
                              styles.chartDotWrap,
                              {bottom: `${chartPct(v, domain).toFixed(2)}%` as DimensionValue},
                            ]}>
                            <View style={[styles.chartDot, {backgroundColor: s.color}]} />
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
                  tone="muted"
                  variant="caption"
                  style={styles.chartXTick}>
                  {String(tick?.[xKey] ?? '')}
                </AppText>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.chartLegendRow}>
          {series.map(s => (
            <View key={s.key} style={styles.chartLegendItem}>
              <View style={[styles.chartLegendSwatch, {backgroundColor: s.color}]} />
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
              {String(selected[xKey] ?? '')}
            </AppText>
            <View style={styles.chartTooltipRow}>
              {series.map(s => {
                const v = selected[s.key];
                const text =
                  typeof v === 'number' && Number.isFinite(v) ? fmtInt(v) : '\u2014';
                return (
                  <View key={s.key} style={styles.chartTooltipChip}>
                    <View
                      style={[styles.chartTooltipChipDot, {backgroundColor: s.color}]}
                    />
                    <AppText
                      numberOfLines={1}
                      tone="secondary"
                      variant="caption">
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

/* ─── Sections (inline reproductions of the not-yet-converted siblings) ──────── */

function HealthOverview({
  overallHealth,
  healthScore,
  motorStatus,
}: {
  overallHealth: HealthStatus;
  healthScore: number;
  motorStatus: string;
}) {
  const healthColor = HEALTH_COLOR[overallHealth];
  const tone = healthBadgeTone(overallHealth);
  const title =
    overallHealth === 'good'
      ? t('drivetrain.healthGood', 'Drivetrain Healthy')
      : overallHealth === 'warning'
        ? t('drivetrain.healthWarn', 'Drivetrain Running Warm')
        : t('drivetrain.healthCrit', 'Drivetrain Overheating');

  return (
    <>
      {overallHealth !== 'good' ? (
        <FadeIn>
          <GlassPanel
            style={[
              styles.alertBanner,
              {
                backgroundColor:
                  tone === 'danger' ? colors.dangerSurface : colors.warningSurface,
                borderColor:
                  tone === 'danger' ? colors.dangerBorder : colors.warningBorder,
              },
            ]}>
            <SemanticIcon
              decorative
              name={tone === 'danger' ? 'severityCritical' : 'severityWarn'}
              size="sm"
            />
            <View style={styles.flex1}>
              <AppText weight="semibold">
                {overallHealth === 'critical'
                  ? t('drivetrain.alert.criticalTitle', 'Critical Temperature Warning')
                  : t('drivetrain.alert.warningTitle', 'Elevated Temperatures Detected')}
              </AppText>
              <AppText tone="secondary" variant="caption">
                {overallHealth === 'critical'
                  ? t(
                      'drivetrain.alert.criticalMsg',
                      'One or more drivetrain components are operating at critically high temperatures. Immediate attention is recommended.',
                    )
                  : t(
                      'drivetrain.alert.warningMsg',
                      'Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load.',
                    )}
              </AppText>
            </View>
          </GlassPanel>
        </FadeIn>
      ) : null}

      <FadeIn>
        <GlassPanel style={[styles.panel, {borderColor: `${healthColor}55`}]}>
          <View style={styles.overviewRow}>
            <View style={styles.overviewLeft}>
              <SemanticIcon
                decorative
                name={overallHealth === 'good' ? 'success' : 'severityWarn'}
                size="lg"
              />
              <View style={styles.flex1}>
                <AppText variant="title" weight="semibold">
                  {title}
                </AppText>
                <AppText tone="muted" variant="caption">
                  {t('drivetrain.motorState', 'Motor State')}: {motorStatus}
                </AppText>
              </View>
            </View>
            <View style={styles.overviewRight}>
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor:
                      tone === 'success'
                        ? colors.successSurface
                        : tone === 'warning'
                          ? colors.warningSurface
                          : colors.dangerSurface,
                    borderColor:
                      tone === 'success'
                        ? colors.successBorder
                        : tone === 'warning'
                          ? colors.warningBorder
                          : colors.dangerBorder,
                  },
                ]}>
                <View style={[styles.badgeDot, {backgroundColor: healthColor}]} />
                <AppText variant="caption" weight="semibold" style={{color: healthColor}}>
                  {t(`drivetrain.health.${overallHealth}`, overallHealth.toUpperCase())}
                </AppText>
              </View>
              <AppText weight="bold" variant="title" style={{color: healthColor}}>
                {`${healthScore}%`}
              </AppText>
            </View>
          </View>
        </GlassPanel>
      </FadeIn>
    </>
  );
}

function HealthGaugeGrid({
  overallHealth,
  healthScore,
  motorStatus,
  sensors,
  stats,
}: {
  overallHealth: HealthStatus;
  healthScore: number;
  motorStatus: string;
  sensors: TempSensor[];
  stats: DrivingStats | undefined;
}) {
  const {unitPrefs} = useUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);
  const toSpeedDisplay = (value: number) =>
    convertSpeedFromSI(value, unitPrefs.speed);
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const healthColor = HEALTH_COLOR[overallHealth];

  return (
    <FadeIn delay={0.1}>
      <View style={styles.gaugeGrid}>
        <GlassPanel style={[styles.panel, styles.gaugePanel]}>
          <RadialGauge
            color={healthColor}
            label={t('drivetrain.healthScore', 'Health Score')}
            max={100}
            size={140}
            unit="%"
            value={healthScore}
          />
          <AppText tone="muted" variant="caption" style={styles.gaugeCaption}>
            {t('drivetrain.healthScoreDesc', 'Overall drivetrain condition rating')}
          </AppText>
        </GlassPanel>

        <GlassPanel style={styles.panel}>
          <PanelHeading>{t('drivetrain.motorDetails', 'Motor Details')}</PanelHeading>
          <KVList
            items={[
              {label: t('drivetrain.motorStatus', 'Motor Status'), value: motorStatus},
              {
                label: t('drivetrain.overallHealth', 'Overall Health'),
                value: overallHealth.charAt(0).toUpperCase() + overallHealth.slice(1),
              },
              {
                label: t('drivetrain.healthScoreLabel', 'Health Score'),
                value: `${healthScore}%`,
              },
              {
                label: t('drivetrain.sensorCount', 'Active Sensors'),
                value: String(sensors.filter(s => s.value !== null).length),
              },
            ]}
          />
          <View style={styles.realtimeRow}>
            <SemanticIcon decorative name="activity" size="sm" />
            <AppText tone="muted" variant="caption">
              {t('drivetrain.realTime', 'Real-time telemetry active')}
            </AppText>
          </View>
        </GlassPanel>

        <GlassPanel style={styles.panel}>
          <PanelHeading>{t('drivetrain.driveStats', 'Drive Statistics')}</PanelHeading>
          {stats ? (
            <KVList
              items={[
                {
                  label: t('drivetrain.totalDrives', 'Total Drives'),
                  value: fmtInt(stats.totalDrives),
                },
                {
                  label: t('drivetrain.totalDistance', 'Total Distance'),
                  value: `${fmtInt(toDistanceDisplay(stats.totalDistanceKm))} ${distanceUnit}`,
                },
                {
                  label: t('drivetrain.avgSpeed', 'Avg Speed'),
                  value: `${fmtNumber(toSpeedDisplay(stats.avgSpeedKmh), 1)} ${speedUnit}`,
                },
                {
                  label: t('drivetrain.topSpeed', 'Top Speed'),
                  value: `${fmtNumber(toSpeedDisplay(stats.topSpeedKmh), 1)} ${speedUnit}`,
                },
              ]}
            />
          ) : (
            <View style={styles.skeleton}>
              {[0, 1, 2, 3].map(i => (
                <View key={i} style={styles.skeletonLine} />
              ))}
            </View>
          )}
        </GlassPanel>
      </View>
    </FadeIn>
  );
}

function TemperatureGauges({sensors}: {sensors: TempSensor[]}) {
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);
  const tempUnit = unitPrefs.temperature;

  return (
    <FadeIn delay={0.15}>
      <GlassPanel style={styles.panel}>
        <PanelHeading icon="climateHot">
          {t('drivetrain.tempGauges', 'Temperature Gauges')}
        </PanelHeading>
        <View style={styles.gaugeRow}>
          {sensors.map(sensor => (
            <View key={sensor.key} style={styles.gaugeCell}>
              <RadialGauge
                color={tempSeverityColor(sensor.value, sensor.maxTemp)}
                label={t(sensor.labelKey, sensor.defaultLabel)}
                max={toTemperatureDisplay(sensor.maxTemp)}
                unit={tempUnit}
                value={sensor.value !== null ? toTemperatureDisplay(sensor.value) : 0}
              />
              <AppText tone="muted" variant="caption" style={styles.gaugeCellCaption}>
                {`${t('drivetrain.maxLabel', 'Max')}: ${fmtNumber(
                  toTemperatureDisplay(sensor.maxTemp),
                  0,
                )}${tempUnit}`}
              </AppText>
            </View>
          ))}
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

function TemperatureMetricCards({
  sensors,
  overallHealth,
  healthScore,
  peakPower,
}: {
  sensors: TempSensor[];
  overallHealth: HealthStatus;
  healthScore: number;
  peakPower: number;
}) {
  const {unitPrefs} = useUnits();
  const formatTemperature = (value: number | null | undefined, precision?: number) =>
    formatTemperatureWith(value, unitPrefs, precision);

  return (
    <View style={styles.chipGrid}>
      {sensors.map(sensor => (
        <MetricChip
          key={sensor.key}
          color={NEON_COLOR[tempNeonColor(sensor.value, sensor.maxTemp)]}
          icon={sensor.icon}
          label={t(sensor.labelKey, sensor.defaultLabel)}
          subtitle={
            sensor.value !== null
              ? `${fmtNumber((sensor.value / sensor.maxTemp) * 100, 0)}% ${t(
                  'drivetrain.ofMax',
                  'of max',
                )}`
              : t('drivetrain.noData', 'No data')
          }
          value={displayTemp(sensor.value, formatTemperature)}
        />
      ))}
      <MetricChip
        color={
          overallHealth === 'good'
            ? NEON_COLOR.green
            : overallHealth === 'warning'
              ? NEON_COLOR.amber
              : NEON_COLOR.red
        }
        icon="heart"
        label={t('drivetrain.healthScore', 'Health Score')}
        value={`${healthScore}%`}
      />
      <MetricChip
        color={NEON_COLOR.purple}
        icon="bolt"
        label={t('drivetrain.peakPower', 'Peak Power')}
        value={peakPower > 0 ? `${fmtInt(peakPower)} kW` : '\u2014'}
      />
    </View>
  );
}

function ThermalLoadPanel({
  sensors,
  peakPower,
  avgPowerMax,
  stats,
}: {
  sensors: TempSensor[];
  peakPower: number;
  avgPowerMax: number;
  stats: DrivingStats | undefined;
}) {
  const {unitPrefs} = useUnits();
  const formatTemperature = (value: number | null | undefined, precision?: number) =>
    formatTemperatureWith(value, unitPrefs, precision);

  return (
    <FadeIn delay={0.2}>
      <GlassPanel style={styles.panel}>
        <PanelHeading icon="activity">
          {t('drivetrain.thermalMetrics', 'Thermal Load Indicators')}
        </PanelHeading>
        <View style={styles.barList}>
          {sensors.map(sensor => (
            <MetricBar
              key={sensor.key}
              color={tempSeverityColor(sensor.value, sensor.maxTemp)}
              label={t(sensor.labelKey, sensor.defaultLabel)}
              max={sensor.maxTemp}
              sublabel={displayTemp(sensor.value, formatTemperature)}
              value={sensor.value ?? 0}
            />
          ))}
        </View>

        <View style={styles.inlineMetricGrid}>
          <InlineMetric
            icon="bolt"
            iconColor={NEON_COLOR.purple}
            label={t('drivetrain.peakPower', 'Peak Power')}
            value={peakPower > 0 ? `${fmtInt(peakPower)} kW` : '\u2014'}
          />
          <InlineMetric
            icon="trendUp"
            iconColor={NEON_COLOR.cyan}
            label={t('drivetrain.avgPower', 'Avg Power')}
            value={avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '\u2014'}
          />
          <InlineMetric
            icon="activity"
            iconColor={NEON_COLOR.green}
            label={t('drivetrain.drivesLabel', 'Drives')}
            value={stats ? fmtInt(stats.totalDrives) : '\u2014'}
          />
          <InlineMetric
            icon="security"
            iconColor={NEON_COLOR.amber}
            label={t('drivetrain.regenRatio', 'Regen Ratio')}
            value={stats ? `${fmtNumber(stats.regenRatio * 100, 1)}%` : '\u2014'}
          />
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

function LiveMotorStatus({
  motorLatest,
  isolationResistance,
}: {
  motorLatest: MotorSnapshot | null | undefined;
  isolationResistance?: number | null;
}) {
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);
  const tempUnit = unitPrefs.temperature;
  const hasData = motorLatest != null;

  const isolationColor =
    isolationResistance == null || isolationResistance <= 0
      ? colors.textMuted
      : isolationResistance >= 500
        ? NEON_COLOR.green
        : isolationResistance >= 100
          ? NEON_COLOR.amber
          : NEON_COLOR.red;

  return (
    <FadeIn delay={0.22}>
      <GlassPanel style={styles.panel}>
        <PanelHeading icon="settings">
          {t('drivetrain.liveMotor', 'Live Motor Status')}
        </PanelHeading>
        {hasData ? (
          <>
            <View style={styles.statBoxRow}>
              <StatBox
                color={NEON_COLOR.cyan}
                label={t('drivetrain.shiftState', 'Shift State')}
                value={motorLatest?.shift_state ?? '\u2014'}
              />
              <StatBox
                color={NEON_COLOR.purple}
                label={t('drivetrain.power', 'Power')}
                value={
                  motorLatest?.power_kw != null
                    ? `${fmtNumber(motorLatest.power_kw)} kW`
                    : '\u2014'
                }
              />
              <StatBox
                color={NEON_COLOR.green}
                label={t('drivetrain.regen', 'Regen')}
                value={
                  motorLatest?.regen_kw != null
                    ? `${fmtNumber(motorLatest.regen_kw)} kW`
                    : '\u2014'
                }
              />
              <StatBox
                color={colors.textPrimary}
                label={t('drivetrain.source', 'Source')}
                value={motorLatest?.source ?? '\u2014'}
              />
            </View>
            <View style={styles.inlineMetricGrid}>
              <InlineMetric
                icon="activity"
                iconColor={NEON_COLOR.cyan}
                label={t('drivetrain.rpmFront', 'Front Motor RPM')}
                value={
                  motorLatest?.motor_rpm_front != null
                    ? `${fmtInt(motorLatest.motor_rpm_front)} RPM`
                    : '\u2014'
                }
              />
              <InlineMetric
                icon="activity"
                iconColor={NEON_COLOR.purple}
                label={t('drivetrain.rpmRear', 'Rear Motor RPM')}
                value={
                  motorLatest?.motor_rpm_rear != null
                    ? `${fmtInt(motorLatest.motor_rpm_rear)} RPM`
                    : '\u2014'
                }
              />
              <InlineMetric
                icon="bolt"
                iconColor={NEON_COLOR.cyan}
                label={t('drivetrain.torqueFront', 'Front Torque')}
                value={
                  motorLatest?.torque_nm_front != null
                    ? `${fmtNumber(motorLatest.torque_nm_front)} Nm`
                    : '\u2014'
                }
              />
              <InlineMetric
                icon="bolt"
                iconColor={NEON_COLOR.purple}
                label={t('drivetrain.torqueRear', 'Rear Torque')}
                value={
                  motorLatest?.torque_nm_rear != null
                    ? `${fmtNumber(motorLatest.torque_nm_rear)} Nm`
                    : '\u2014'
                }
              />
              <InlineMetric
                icon="climateHot"
                iconColor={NEON_COLOR.red}
                label={t('drivetrain.motorTempFront', 'Front Motor Temp')}
                value={
                  motorLatest?.motor_temp_c_front != null
                    ? `${fmtNumber(toTemperatureDisplay(motorLatest.motor_temp_c_front))} ${tempUnit}`
                    : '\u2014'
                }
              />
              <InlineMetric
                icon="climateHot"
                iconColor={NEON_COLOR.red}
                label={t('drivetrain.motorTempRear', 'Rear Motor Temp')}
                value={
                  motorLatest?.motor_temp_c_rear != null
                    ? `${fmtNumber(toTemperatureDisplay(motorLatest.motor_temp_c_rear))} ${tempUnit}`
                    : '\u2014'
                }
              />
              <InlineMetric
                icon="climateHot"
                iconColor={NEON_COLOR.amber}
                label={t('drivetrain.inverterTemp', 'Inverter Temp')}
                value={
                  motorLatest?.inverter_temp_c != null
                    ? `${fmtNumber(toTemperatureDisplay(motorLatest.inverter_temp_c))} ${tempUnit}`
                    : '\u2014'
                }
              />
              <InlineMetric
                icon="climateHot"
                iconColor={NEON_COLOR.green}
                label={t('drivetrain.batteryTemp', 'Battery Temp')}
                value={
                  motorLatest?.battery_temp_c != null
                    ? `${fmtNumber(toTemperatureDisplay(motorLatest.battery_temp_c))} ${tempUnit}`
                    : '\u2014'
                }
              />
              <InlineMetric
                icon="security"
                iconColor={isolationColor}
                label={t('drivetrain.isolationResistance', 'HV Isolation')}
                value={
                  isolationResistance != null && isolationResistance > 0
                    ? `${fmtNumber(isolationResistance)} kΩ`
                    : '\u2014'
                }
              />
            </View>
          </>
        ) : (
          <EmptyState
            message={t('drivetrain.noLiveMotor', 'No live motor telemetry yet')}
            title={t('drivetrain.noLiveMotorTitle', 'No Live Motor Telemetry')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

function StatorTempChart({data}: {data: MotorChartDataPoint[]}) {
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);
  const tempUnit = unitPrefs.temperature;

  if (data.length <= 1) {
    return null;
  }

  return (
    <FadeIn delay={0.23}>
      <NativeSeriesChart
        ariaLabel={t(
          'drivetrain.statorTempHistory.aria',
          'Front, rear-left and rear-right motor stator temperature history line chart',
        )}
        data={data.map(d => ({
          stator: d.stator,
          statorRel: d.statorRel,
          statorRer: d.statorRer,
          time: d.time,
        }))}
        dataColumns={[
          {key: 'time', label: t('drivetrain.col.time', 'Time')},
          {key: 'stator', label: `${t('drivetrain.col.stator', 'Stator')} (${tempUnit})`},
          {
            key: 'statorRel',
            label: `${t('drivetrain.col.statorRel', 'Rear-Left')} (${tempUnit})`,
          },
          {
            key: 'statorRer',
            label: `${t('drivetrain.col.statorRer', 'Rear-Right')} (${tempUnit})`,
          },
        ]}
        height={280}
        refLines={[
          {
            color: '#4ade80',
            label: t('drivetrain.normal', 'Normal'),
            value: toTemperatureDisplay(60),
          },
          {
            color: '#fbbf24',
            label: t('drivetrain.warm', 'Warm'),
            value: toTemperatureDisplay(80),
          },
        ]}
        series={[
          {
            color: '#ef4444',
            key: 'stator',
            label: `${t('drivetrain.statorTemp', 'Stator Temp')} (${tempUnit})`,
          },
          {
            color: '#a855f7',
            key: 'statorRel',
            label: `${t('drivetrain.statorTempRearLeft', 'Rear-Left Stator Temp')} (${tempUnit})`,
          },
          {
            color: '#06b6d4',
            key: 'statorRer',
            label: `${t('drivetrain.statorTempRearRight', 'Rear-Right Stator Temp')} (${tempUnit})`,
          },
        ]}
        subtitle={t(
          'drivetrain.statorTempSub',
          'Motor stator temperature over recent snapshots',
        )}
        title={t('drivetrain.statorTempHistory', 'Stator Temperature History')}
        xKey="time"
      />
    </FadeIn>
  );
}

function TorqueHistoryChart({data}: {data: MotorChartDataPoint[]}) {
  if (data.length <= 1 || !data.some(d => d.torque !== null)) {
    return null;
  }

  return (
    <FadeIn delay={0.24}>
      <NativeSeriesChart
        ariaLabel={t(
          'drivetrain.torqueHistory.aria',
          'Motor inverter torque output history area chart',
        )}
        data={data.map(d => ({time: d.time, torque: d.torque}))}
        dataColumns={[
          {key: 'time', label: t('drivetrain.col.time', 'Time')},
          {key: 'torque', label: t('drivetrain.col.torque', 'Torque (Nm)')},
        ]}
        height={280}
        refLines={[{color: '#64748b', label: '0', value: 0}]}
        series={[
          {color: '#00f0ff', key: 'torque', label: `${t('drivetrain.torque', 'Torque')} (Nm)`},
        ]}
        subtitle={t('drivetrain.torqueHistorySub', 'Drive inverter torque output over time')}
        title={t('drivetrain.torqueHistory', 'Motor Torque')}
        xKey="time"
      />
    </FadeIn>
  );
}

function PowerOutputChart({data}: {data: ChartDataPoint[]}) {
  if (data.length <= 1) {
    return null;
  }

  return (
    <FadeIn delay={0.3}>
      <NativeSeriesChart
        ariaLabel={t(
          'drivetrain.powerOutput.aria',
          'Per-drive peak and regen motor power output history area chart',
        )}
        data={data.map(d => ({
          date: d.date,
          powerMax: d.powerMax,
          powerMin: d.powerMin,
        }))}
        dataColumns={[
          {key: 'date', label: t('drivetrain.col.date', 'Date')},
          {key: 'powerMax', label: t('drivetrain.col.powerMax', 'Peak (kW)')},
          {key: 'powerMin', label: t('drivetrain.col.powerMin', 'Regen (kW)')},
        ]}
        height={300}
        refLines={[{color: '#64748b', label: '0', value: 0}]}
        series={[
          {color: '#8b5cf6', key: 'powerMax', label: t('drivetrain.powerMax', 'Peak Power (kW)')},
          {color: '#ef4444', key: 'powerMin', label: t('drivetrain.powerMin', 'Regen Power (kW)')},
        ]}
        subtitle={t('drivetrain.powerOutputSub', 'Peak and regen power per drive over time')}
        title={t('drivetrain.powerOutput', 'Power Output History')}
        xKey="date"
      />
    </FadeIn>
  );
}

function DetailCards({
  health,
  peakPower,
  avgPowerMax,
  minRegenPower,
  stats,
}: {
  health: DrivetrainHealthData;
  peakPower: number;
  avgPowerMax: number;
  minRegenPower: number;
  stats: DrivingStats | undefined;
}) {
  const {unitPrefs} = useUnits();
  const formatTemperature = (value: number | null | undefined, precision?: number) =>
    formatTemperatureWith(value, unitPrefs, precision);
  const formatEnergy = (value: number | null | undefined, precision?: number) =>
    formatEnergyWith(value, unitPrefs, precision);

  return (
    <FadeIn delay={0.4}>
      <View style={styles.detailGrid}>
        <GlassPanel style={styles.panel}>
          <PanelHeading>
            {t('drivetrain.temperatures', 'Temperature Details')}
          </PanelHeading>
          <KVList
            items={[
              {
                label: t('drivetrain.frontMotorTemp', 'Front Motor Temp'),
                value: displayTemp(health.frontMotorTempC, formatTemperature),
              },
              {
                label: t('drivetrain.rearMotorTemp', 'Rear Motor Temp'),
                value: displayTemp(health.rearMotorTempC, formatTemperature),
              },
              {
                label: t('drivetrain.inverterTemp', 'Inverter Temp'),
                value: displayTemp(health.inverterTempC, formatTemperature),
              },
              {
                label: t('drivetrain.batteryTemp', 'Battery Temp'),
                value: displayTemp(health.batteryTempC, formatTemperature),
              },
            ]}
          />
        </GlassPanel>

        <GlassPanel style={styles.panel}>
          <PanelHeading>{t('drivetrain.powerSummary', 'Power Summary')}</PanelHeading>
          <KVList
            items={[
              {
                label: t('drivetrain.peakPowerLabel', 'Peak Power'),
                value: peakPower > 0 ? `${fmtInt(peakPower)} kW` : '\u2014',
              },
              {
                label: t('drivetrain.avgPowerLabel', 'Avg Peak Power'),
                value: avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '\u2014',
              },
              {
                label: t('drivetrain.maxRegenLabel', 'Max Regen'),
                value:
                  minRegenPower < 0
                    ? `${fmtNumber(Math.abs(minRegenPower), 1)} kW`
                    : '\u2014',
              },
              {
                label: t('drivetrain.regenLabel', 'Total Regen'),
                value: stats ? formatEnergy(stats.regenEnergyWh, 1) : '\u2014',
              },
              {
                label: t('drivetrain.co2Label', 'CO₂ Saved'),
                value: stats ? `${fmtNumber(stats.co2SavedKg, 1)} kg` : '\u2014',
              },
            ]}
          />
        </GlassPanel>
      </View>
    </FadeIn>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */

export default function DrivetrainHealthPage() {
  // usePageTitle(t('drivetrain.title')) sets document.title on web; no native
  // analogue, so the same translated title renders in the on-screen header.
  const {formatDateShort, formatTime} = useDateHelpers();

  // useSelectedVehicle source-of-truth -> local state seeded to the first vehicle.
  const {data: vehicles} = useVehicles();
  const vehicleList = useMemo(() => vehicles ?? [], [vehicles]);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  useEffect(() => {
    if (vehicleId == null && vehicleList.length > 0) {
      setVehicleId(vehicleList[0].id);
    }
  }, [vehicleId, vehicleList]);
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const vehicleOptions: VehicleOption[] = vehicleList.map(v => ({
    id: v.id,
    label: v.display_name,
  }));

  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const setRangeBatch = useCallback((r: {from?: string; to?: string}) => {
    if (r.from !== undefined) {
      setStartDate(r.from);
    }
    if (r.to !== undefined) {
      setEndDate(r.to);
    }
  }, []);

  const {data: health, isLoading: healthLoading} = useDrivetrainHealth(vehicleIdStr);
  const {data: drives} = useDrives(vehicleIdStr);
  const {data: stats} = useDrivingStats(vehicleIdStr);
  const {data: motorLatest} = useMotorLatest(vehicleId ?? 0, 5_000);
  const {data: motorHistory} = useMotorHistory(vehicleId ?? 0, 200);
  const isolationResistance = useIsolationResistance(vehicleId ?? undefined);

  // Display-boundary SI converters. useUrlState/useUnits keep these stable so the
  // chartData / motorChartData memos below don't recompute every render (web's
  // page-level toSpeedDisplay was only referenced in a dependency array and is
  // dropped natively — each section derives its own speed converter).
  const {unitPrefs} = useUnits();
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );

  const overallHealth: HealthStatus = health?.overallHealth ?? 'good';
  const healthScore = HEALTH_SCORE[overallHealth];

  const sensors: TempSensor[] = useMemo(() => {
    if (!health) {
      return [];
    }
    return [
      {
        color: '#06b6d4',
        defaultLabel: 'Front Motor',
        icon: 'bolt',
        key: 'frontMotor',
        labelKey: 'drivetrain.frontMotor',
        maxTemp: 150,
        value: health.frontMotorTempC,
      },
      {
        color: '#8b5cf6',
        defaultLabel: 'Rear Motor',
        icon: 'bolt',
        key: 'rearMotor',
        labelKey: 'drivetrain.rearMotor',
        maxTemp: 150,
        value: health.rearMotorTempC,
      },
      {
        color: '#f59e0b',
        defaultLabel: 'Inverter',
        icon: 'cpu',
        key: 'inverter',
        labelKey: 'drivetrain.inverter',
        maxTemp: 120,
        value: health.inverterTempC,
      },
      {
        color: '#10b981',
        defaultLabel: 'Battery',
        icon: 'batteryCharging',
        key: 'battery',
        labelKey: 'drivetrain.battery',
        maxTemp: 60,
        value: health.batteryTempC,
      },
    ];
  }, [health]);

  const chartData: ChartDataPoint[] = useMemo(() => {
    if (!drives?.length) {
      return [];
    }
    // Filter drives to selected date range; chart shows the resulting series
    // (capped at 30 points so the trend stays readable on small viewports).
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    const endMs = new Date(`${endDate}T23:59:59`).getTime();
    return drives
      .filter((d: Drive) => {
        const ts = new Date(d.startTs).getTime();
        return Number.isFinite(ts) && ts >= startMs && ts <= endMs;
      })
      .slice()
      .sort(
        (a: Drive, b: Drive) =>
          new Date(a.startTs).getTime() - new Date(b.startTs).getTime(),
      )
      .slice(-30)
      .map((d: Drive) => ({
        date: formatDateShort(d.startTs),
        distance: toDistanceDisplay(d.distanceM),
        outsideTemp: d.outsideTempAvgC ?? null,
        powerMax: (d.avgPowerW ?? 0) / 1000,
        powerMin: 0,
      }));
     
  }, [drives, startDate, endDate, toDistanceDisplay, formatDateShort]);

  const tempTrendData = useMemo(
    () => chartData.filter(d => d.outsideTemp !== null),
    [chartData],
  );

  const avgPowerMax = useMemo(() => {
    if (!chartData.length) {
      return 0;
    }
    return chartData.reduce((acc, d) => acc + d.powerMax, 0) / chartData.length;
  }, [chartData]);

  const peakPower = useMemo(() => {
    if (!chartData.length) {
      return 0;
    }
    return Math.max(...chartData.map(d => d.powerMax));
  }, [chartData]);

  const minRegenPower = useMemo(() => {
    if (!chartData.length) {
      return 0;
    }
    return Math.min(...chartData.map(d => d.powerMin));
  }, [chartData]);

  const motorChartData: MotorChartDataPoint[] = useMemo(() => {
    const history = motorHistory ?? [];
    if (history.length === 0) {
      return [];
    }
    return history.map((s: MotorSnapshot) => ({
      axle: s.motor_rpm_front ?? s.motor_rpm_rear ?? null,
      speed: null, // no direct power signal in motor pivot; field unused by charts
      stator: s.motor_temp_c_front != null ? toTemperatureDisplay(s.motor_temp_c_front) : null,
      statorRel: s.motor_temp_c_rear != null ? toTemperatureDisplay(s.motor_temp_c_rear) : null,
      statorRer: s.inverter_temp_c != null ? toTemperatureDisplay(s.inverter_temp_c) : null,
      time: s.ts ? formatTime(s.ts) : '',
      torque: s.torque_nm_front ?? s.torque_nm_rear ?? null,
    }));
  }, [motorHistory, toTemperatureDisplay, formatTime]);

  return (
    <ScrollView
      testID="drivetrain-health-page"
      contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <AppText variant="title" weight="bold">
          {t('drivetrain.title', 'Drivetrain Health')}
        </AppText>
        <AppText tone="muted">
          {t('drivetrain.subtitle', 'Motor, inverter, and battery thermal status')}
        </AppText>
        <View style={styles.actions}>
          <VehicleSelect
            onChange={setVehicleId}
            options={vehicleOptions}
            value={vehicleId}
          />
          <RangePicker
            onChange={r => setRangeBatch({from: r.start, to: r.end})}
            value={{end: endDate, start: startDate}}
          />
        </View>
      </View>

      {healthLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : health ? (
        <View style={styles.sections}>
          <HealthOverview
            healthScore={healthScore}
            motorStatus={health.motorStatus}
            overallHealth={overallHealth}
          />
          <HealthGaugeGrid
            healthScore={healthScore}
            motorStatus={health.motorStatus}
            overallHealth={overallHealth}
            sensors={sensors}
            stats={stats}
          />
          <TemperatureGauges sensors={sensors} />
          <TemperatureMetricCards
            healthScore={healthScore}
            overallHealth={overallHealth}
            peakPower={peakPower}
            sensors={sensors}
          />
          <ThermalLoadPanel
            avgPowerMax={avgPowerMax}
            peakPower={peakPower}
            sensors={sensors}
            stats={stats}
          />
          {motorLatest ? (
            <LiveMotorStatus
              isolationResistance={isolationResistance}
              motorLatest={motorLatest}
            />
          ) : null}
          <StatorTempChart data={motorChartData} />
          <TorqueHistoryChart data={motorChartData} />
          <TemperatureTrendChart data={tempTrendData} />
          <PowerOutputChart data={chartData} />
          <HealthRecommendations overallHealth={overallHealth} />
          <DetailCards
            avgPowerMax={avgPowerMax}
            health={health}
            minRegenPower={minRegenPower}
            peakPower={peakPower}
            stats={stats}
          />
        </View>
      ) : (
        <EmptyState
          message={t('drivetrain.noData', 'No drivetrain health data available yet')}
          title={t('drivetrain.empty.title', 'No Drivetrain Data')}
        />
      )}
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
    alignItems: 'flex-start',
    borderRadius: 16,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  barList: {
    gap: spacing.md,
    marginTop: spacing.sm,
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
  chartRefLabel: {
    position: 'absolute',
    right: 4,
    top: 1,
  },
  chartRefLine: {
    borderStyle: 'dashed',
    borderTopWidth: 1,
    height: 0,
    left: 0,
    position: 'absolute',
    right: 0,
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
    width: 40,
  },
  chartYTick: {
    textAlign: 'left',
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  fadeIn: {
    width: '100%',
  },
  flex1: {
    flex: 1,
  },
  gaugeCell: {
    alignItems: 'center',
    flexBasis: '45%',
    flexGrow: 1,
    gap: spacing.xs,
  },
  gaugeCellCaption: {
    textAlign: 'center',
  },
  gaugeCaption: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  gaugeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gaugePanel: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  inlineMetric: {
    alignItems: 'center',
    flexBasis: '45%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
  },
  inlineMetricDot: {
    alignItems: 'center',
    borderRadius: 8,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  inlineMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  kvLabel: {
    flex: 1,
  },
  kvList: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  kvRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  kvValue: {
    textAlign: 'right',
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  metricBar: {
    gap: spacing.xs,
  },
  metricBarFill: {
    borderRadius: 999,
    height: 8,
  },
  metricBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricBarTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  metricChip: {
    flexBasis: '30%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 150,
    padding: spacing.md,
  },
  metricChipHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  overviewLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  overviewRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  overviewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  panel: {
    flexGrow: 1,
    padding: spacing.lg,
  },
  panelHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  panelHeadingText: {
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  pill: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
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
  realtimeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sections: {
    gap: spacing.lg,
  },
  skeleton: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  skeletonLine: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    height: 14,
    width: '100%',
  },
  statBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '45%',
    flexGrow: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  statBoxLabel: {
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statBoxRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statBoxValue: {
    fontSize: 18,
  },
});
