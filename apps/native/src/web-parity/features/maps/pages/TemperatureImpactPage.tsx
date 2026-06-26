// TemperatureImpactPage — native parity port of
// web/src/features/maps/pages/TemperatureImpactPage.tsx.
//
// "How outside temperature affects driving efficiency": a vehicle picker in the
// header, an AI cabin-temperature narrator, a 4-up summary MetricCard strip, a
// Temperature-vs-Efficiency scatter chart, an Efficiency-by-Temperature-Range
// bucket chart, an Optimal-Temperature analysis panel with per-bucket badges,
// and a contextual Tips & Recommendations panel. Everything is driven by a
// single `/analytics/temperature-impact?vehicle_id=` query whose SI points
// (outside_temp °C, efficiency_wh_km Wh/km) are converted at the display
// boundary (convertTempFromSI + the inline Wh/km→Wh/mi KM_PER_MILE factor).
//
// Native adaptations (conversion-contract rules 4-7; behavior / state names /
// API path / query key / unit handling / i18n intent preserved):
//   - react-i18next `useTranslation` (web L3) -> an inline native t(key,
//     fallback|opts, vars?) shim preserving every temperature.*/tempImpact.*/
//     error.*/common.* key, the English defaults, {{range}}/{{efficiency}}/
//     {{unit}}/{{count}}/{{worst}}/{{delta}} interpolation, AND the i18next
//     `{ ..., defaultValue }` option-object call shape.
//   - lucide-react icons (web L4-6: Thermometer/Snowflake/Sun/Lightbulb/
//     TrendingUp/Activity/AlertCircle) -> emoji glyphs carrying the same visual
//     intent (lucide-react is browser-only SVG).
//   - `@/components/layout` PageContainer (web L8) -> an inline RN PageScaffold
//     (ScrollView header with title/subtitle/actions + web-style loading spinner
//     short-circuit).
//   - `@/components/ui` GlassPanel/Badge (web L9) -> the shared native GlassPanel
//     (with an inline padding + optional green-glow style) + an inline RN Badge.
//   - `@/components/data-display` MetricCard (web L10) -> an inline RN MetricCard
//     preserving label/value/icon-glyph/color/subtitle.
//   - `@/components/feedback` AlertBanner/EmptyState (web L11) -> inline RN
//     equivalents.
//   - `@/components/motion` FadeIn (web L13) -> a structural passthrough wrapper
//     (the `delay` prop is preserved + ignored; RN has no entrance primitive).
//   - `@/components/forms` VehicleSelect (web L14) -> an inline read-only native
//     vehicle chip (no router/picker is wired into this parity page; documented).
//   - `@/components/charts` Recharts ScatterChart/LineChart + axes/grid/tooltip/
//     ReferenceLine (web L15-19) -> native-safe charts: an absolutely-positioned
//     ScatterPlot (per-point bucket fill + an average ReferenceLine) and a
//     per-bucket BucketBarChart, because Recharts depends on browser DOM/SVG.
//     `CHART_COLORS` is the native chartUtils parity palette (web L16).
//   - `@/hooks/useSelectedVehicle` (web L21) -> an inline native useSelectedVehicle
//     reading the native useVehicles list (defaults to the first vehicle like the
//     web provider seed; URL/localStorage precedence is router-only).
//   - `@/hooks/usePageTitle` (web L22) -> a native-safe no-op (RN has no
//     document.title); the call site + argument are preserved.
//   - `@/hooks/useUnits` (web L23) -> an inline native useUnits reading the native
//     useSettings (same unit_of_length/unit_of_temp derivation).
//   - `@/lib/numberFormat` fmtNumber (web L24) + `@/lib/unitConversion`
//     convertTempFromSI (web L25) + `@/lib/errorMessage` getErrorMessage (web L12)
//     -> ported inline. `@/lib/cn` (web L26) is unused (RN uses StyleSheet).
//   - `@/api/client` request (web L27) -> the native ../../../api/client request,
//     used by the same inline useQuery (same ['temperature-impact', vehicleId]
//     key, same path, same `enabled`, same `res.points ?? []`).
//   - `@/components/ai/AICabinTemperatureImpactNarrative` (web L28) -> the native
//     parity component of the same name, rendered with the same vehicleId arg.
//
// No DOM/Recharts/Leaflet/react-router/react-i18next/framer-motion/lucide/old
// web-UI imports reach the native output — only react, react-native primitives,
// the canonical AppText + GlassPanel + theme tokens, the native chartUtils
// CHART_COLORS, the native request client + useVehicles/useSettings hooks, and
// the converted AICabinTemperatureImpactNarrative. See the .parity.json sidecar
// for the line-by-line source map.

import React, {useCallback, useEffect, useMemo, type ReactNode} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {CHART_COLORS} from '../../../components/charts/chartUtils';
import {request} from '../../../api/client';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import {AICabinTemperatureImpactNarrative} from '../../../components/ai/AICabinTemperatureImpactNarrative';

/* ── i18n: native-safe t() (web react-i18next useTranslation, L3) ──────────── */

type TVars = Record<string, string | number>;
interface TOptions {
  defaultValue?: string;
  [key: string]: string | number | undefined;
}
type NativeT = (key: string, a?: string | TOptions, b?: TVars) => string;

function interpolate(template: string, vars: TVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

/**
 * Covers the three web call shapes used by this page:
 *   t('key', 'Fallback')
 *   t('key', 'Fallback {{n}}', { n })
 *   t('key', { range, defaultValue: 'Fallback {{range}}' })   // i18next options
 */
function translate(key: string, a?: string | TOptions, b?: TVars): string {
  let fallback = key;
  let vars: TVars = {};
  if (typeof a === 'string') {
    fallback = a;
    if (b) {
      vars = b;
    }
  } else if (a && typeof a === 'object') {
    const {defaultValue, ...rest} = a;
    fallback = typeof defaultValue === 'string' ? defaultValue : key;
    const collected: TVars = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) {
        collected[k] = v;
      }
    }
    vars = collected;
  }
  return interpolate(fallback, vars);
}

function useTranslation(): {t: NativeT} {
  return {t: translate};
}

/* ── usePageTitle (web @/hooks/usePageTitle, L22) — no document.title in RN ── */

function usePageTitle(title: string): void {
  useEffect(() => {
    // No-op in React Native: there is no browser tab / document.title to write.
  }, [title]);
}

/* ── numberFormat (web @/lib/numberFormat fmtNumber, L24) ──────────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Web fmtNumber defaults to the global decimal precision (2) and en-US locale.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/* ── errorMessage (web @/lib/errorMessage getErrorMessage, L12) ────────────── */

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ── unitConversion (web @/lib/unitConversion convertTempFromSI, L25) ──────── */

type TemperatureUnitPref = '°C' | '°F';
type DistanceUnitPref = 'km' | 'mi';

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

/* ── useUnits (web @/hooks/useUnits, L23) — reads native useSettings ───────── */

interface UnitPrefsLite {
  distance: DistanceUnitPref;
  temperature: TemperatureUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const distance: DistanceUnitPref = data?.unit_of_length === 'mi' ? 'mi' : 'km';
  const temperature: TemperatureUnitPref =
    data?.unit_of_temp === 'F' ? '°F' : '°C';
  const unitPrefs = useMemo<UnitPrefsLite>(
    () => ({distance, temperature}),
    [distance, temperature],
  );
  return {unitPrefs};
}

/* ── useSelectedVehicle (web @/hooks/useSelectedVehicle, L21) ──────────────── */

// Web composes react-router useMatch/useSearchParams over a localStorage-backed
// provider seeded to the first vehicle. Native has neither router nor that
// provider wired here, so we read the native useVehicles list and default to the
// first vehicle exactly like the web provider's seed (documented).
function useSelectedVehicle(): {vehicleId: number | null; vehicleName?: string} {
  const {data} = useVehicles();
  if (data && data.length > 0) {
    const first = data[0];
    return {vehicleId: first.id, vehicleName: first.display_name};
  }
  return {vehicleId: null};
}

/* ----------------------------------------------------------------*/
/*  Types (web L34-53) */
/* ----------------------------------------------------------------*/

interface TempEfficiencyPoint {
  outside_temp: number;
  efficiency_wh_km: number;
  distance_km: number;
  drive_date: string;
}

interface BucketDef {
  label: string;
  min: number;
  max: number;
  color: string;
}

interface BucketAvg {
  label: string;
  avg: number;
  count: number;
  color: string;
}

/* ----------------------------------------------------------------*/
/*  Constants (web L59-86) */
/* ----------------------------------------------------------------*/

/* Wh/km -> Wh/mi conversion factor.
   No convertEfficiencyFromSI helper exists in lib/unitConversion, so we keep the
   inline km-per-mile factor here (mirrors the web source). */
const KM_PER_MILE = 1.609344;

const TEMP_BUCKETS_C = [
  {min: -50, max: 0, color: '#3b82f6'},
  {min: 0, max: 10, color: '#06b6d4'},
  {min: 10, max: 20, color: '#10b981'},
  {min: 20, max: 30, color: '#f59e0b'},
  {min: 30, max: 60, color: '#ef4444'},
] as const;

function getTempBucketIndex(temp: number): number {
  const idx = TEMP_BUCKETS_C.findIndex(b => temp >= b.min && temp < b.max);
  return idx >= 0 ? idx : 2;
}

function bucketLabel(
  b: (typeof TEMP_BUCKETS_C)[number],
  toTemperatureDisplay: (c: number) => number,
  tempUnit: string,
  idx: number,
): string {
  if (idx === 0) {
    return `< ${Math.round(toTemperatureDisplay(b.max))}${tempUnit}`;
  }
  if (idx === TEMP_BUCKETS_C.length - 1) {
    return `> ${Math.round(toTemperatureDisplay(b.min))}${tempUnit}`;
  }
  return `${Math.round(toTemperatureDisplay(b.min))}–${Math.round(
    toTemperatureDisplay(b.max),
  )}${tempUnit}`;
}

/* ── Icon glyph (lucide-react → emoji, browser-only SVG replaced, L4-6) ─────── */

const GLYPH = {
  Thermometer: '🌡️',
  Snowflake: '❄️',
  Sun: '☀️',
  Lightbulb: '💡',
  TrendingUp: '📈',
  Activity: '📊',
  AlertCircle: '⚠️',
} as const;

function GlyphIcon({
  glyph,
  color,
  size = 16,
}: {
  glyph: string;
  color?: string;
  size?: number;
}): React.ReactElement {
  return (
    <AppText style={[{fontSize: size}, color ? {color} : null]}>
      {glyph}
    </AppText>
  );
}

/* ── Badge (web @/components/ui Badge, L9) ─────────────────────────────────── */

type BadgeVariant = 'success' | 'neutral' | 'warning' | 'info' | 'danger';

const BADGE_TONES: Record<
  BadgeVariant,
  {bg: string; border: string; text: string}
> = {
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  warning: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    text: colors.warning,
  },
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    text: colors.danger,
  },
  info: {
    bg: colors.accentSoft,
    border: colors.borderAccent,
    text: colors.accent,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
};

function Badge({
  variant = 'neutral',
  dot = false,
  children,
}: {
  variant?: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
}): React.ReactElement {
  const tone = BADGE_TONES[variant];
  return (
    <View style={[styles.badge, {backgroundColor: tone.bg, borderColor: tone.border}]}>
      {dot ? (
        <View style={[styles.badgeDot, {backgroundColor: tone.text}]} />
      ) : null}
      <AppText variant="caption" weight="semibold" style={{color: tone.text}}>
        {children}
      </AppText>
    </View>
  );
}

/* ── FadeIn (web @/components/motion FadeIn, L13) — structural passthrough ───── */

function FadeIn({
  children,
}: {
  delay?: number;
  children: ReactNode;
}): React.ReactElement {
  // The web entrance animation (+`delay`) is a non-essential flourish; RN has no
  // equivalent primitive wired here, so this is a structural wrapper.
  return <View>{children}</View>;
}

/* ── Panel (web @/components/ui GlassPanel, L9 — padding + optional glow) ───── */

function Panel({
  glow,
  children,
  style,
}: {
  glow?: 'green';
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return (
    <GlassPanel style={[styles.panel, glow === 'green' ? styles.panelGlowGreen : null, style]}>
      {children}
    </GlassPanel>
  );
}

/* ── AlertBanner (web @/components/feedback AlertBanner, L11) ───────────────── */

function AlertBanner({children}: {children: ReactNode}): React.ReactElement {
  return (
    <View style={styles.alertBanner}>
      <GlyphIcon glyph={GLYPH.AlertCircle} size={18} />
      <AppText style={styles.alertText}>{children}</AppText>
    </View>
  );
}

/* ── EmptyBlock (web @/components/feedback EmptyState, L11) ─────────────────── */

function EmptyBlock({
  glyph,
  message,
}: {
  glyph: string;
  message: string;
}): React.ReactElement {
  return (
    <View style={styles.emptyBlock}>
      <GlyphIcon glyph={glyph} size={28} />
      <AppText tone="muted">{message}</AppText>
    </View>
  );
}

/* ── MetricCard (web @/components/data-display MetricCard, L10) ─────────────── */

type MetricColor = 'cyan' | 'green' | 'purple';

const METRIC_COLOR_HEX: Record<MetricColor, string> = {
  cyan: colors.accent,
  green: colors.success,
  purple: colors.violet,
};

function MetricCard({
  label,
  value,
  glyph,
  color,
  subtitle,
}: {
  label: string;
  value: string | number;
  glyph: string;
  color: MetricColor;
  subtitle?: string;
}): React.ReactElement {
  const hex = METRIC_COLOR_HEX[color];
  return (
    <GlassPanel style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <GlyphIcon glyph={glyph} color={hex} size={16} />
        <AppText
          variant="caption"
          tone="muted"
          weight="semibold"
          style={styles.metricLabel}>
          {label}
        </AppText>
      </View>
      <AppText variant="title" weight="bold" style={{color: hex}}>
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

/* ── ScatterPlot (web @/components/charts ScatterChart, L15-19, L300-352) ────── */

interface ScatterPoint {
  x: number;
  y: number;
  fill: string;
}

/**
 * Native-safe replacement for the Recharts Temperature-vs-Efficiency scatter.
 * Recharts depends on browser DOM/SVG, so points are placed with absolute
 * percentage positioning inside a plot area, colored per temperature bucket,
 * with a dashed average ReferenceLine when an average is supplied.
 */
function ScatterPlot({
  points,
  avg,
  xUnit,
  yLabel,
  avgColor,
  emptyLabel,
}: {
  points: ScatterPoint[];
  avg: number | null;
  xUnit: string;
  yLabel: string;
  avgColor: string;
  emptyLabel: string;
}): React.ReactElement {
  const bounds = useMemo(() => {
    if (points.length === 0) {
      return null;
    }
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (avg != null) {
      yMin = Math.min(yMin, avg);
      yMax = Math.max(yMax, avg);
    }
    return {
      xMin: Math.min(...xs),
      xMax: Math.max(...xs),
      yMin,
      yMax,
    };
  }, [points, avg]);

  const place = (value: number, lo: number, hi: number): number => {
    if (hi <= lo) {
      return 50;
    }
    return Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
  };

  if (!bounds) {
    return (
      <View style={styles.scatterPlot}>
        <EmptyBlock glyph={GLYPH.Activity} message={emptyLabel} />
      </View>
    );
  }

  const avgBottom =
    avg != null ? place(avg, bounds.yMin, bounds.yMax) : null;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${yLabel} versus temperature scatter with ${points.length} drives`}
      style={styles.scatterPlot}>
      <View style={styles.scatterArea}>
        {avgBottom != null ? (
          <View
            pointerEvents="none"
            style={[
              styles.scatterAvgLine,
              {bottom: `${avgBottom}%` as DimensionValue, borderColor: avgColor},
            ]}
          />
        ) : null}
        {points.map((p, i) => (
          <View
            key={`${p.x}-${p.y}-${i}`}
            pointerEvents="none"
            style={[
              styles.scatterDot,
              {
                left: `${place(p.x, bounds.xMin, bounds.xMax)}%` as DimensionValue,
                bottom: `${place(p.y, bounds.yMin, bounds.yMax)}%` as DimensionValue,
                backgroundColor: p.fill,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.scatterAxis}>
        <AppText variant="caption" tone="muted">
          {Math.round(bounds.xMin)}
          {xUnit}
        </AppText>
        <AppText variant="caption" tone="muted">
          {Math.round(bounds.xMax)}
          {xUnit}
        </AppText>
      </View>
    </View>
  );
}

/* ── BucketBarChart (web @/components/charts LineChart, L354-391) ──────────── */

/**
 * Native-safe replacement for the Recharts "Efficiency by Temperature Range"
 * line chart. The discrete bucket series is rendered as per-bucket horizontal
 * bars (one row per temperature range), colored with each bucket's color.
 */
function BucketBarChart({
  data,
  effLabel,
  emptyLabel,
}: {
  data: BucketAvg[];
  effLabel: string;
  emptyLabel: string;
}): React.ReactElement {
  const max = Math.max(...data.map(d => d.avg), 1);
  if (data.length === 0) {
    return <EmptyBlock glyph={GLYPH.Activity} message={emptyLabel} />;
  }
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`Average efficiency by temperature range in ${effLabel}`}
      style={styles.bucketChart}>
      {data.map(d => (
        <View key={d.label} style={styles.bucketRow}>
          <AppText variant="caption" tone="secondary" style={styles.bucketLabel}>
            {d.label}
          </AppText>
          <View style={styles.bucketTrack}>
            <View
              style={[
                styles.bucketFill,
                {
                  width: `${Math.max((d.avg / max) * 100, d.count > 0 ? 4 : 0)}%` as DimensionValue,
                  backgroundColor: d.count > 0 ? d.color : colors.border,
                },
              ]}
            />
          </View>
          <AppText variant="caption" weight="semibold" style={styles.bucketValue}>
            {d.count > 0 ? fmtNumber(d.avg) : '—'}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/* ── VehicleChip (web @/components/forms VehicleSelect, L14) ────────────────── */

function VehicleChip({name}: {name?: string}): React.ReactElement {
  return (
    <View style={styles.vehicleChip}>
      <GlyphIcon glyph="🚗" size={13} />
      <AppText variant="caption" weight="semibold" tone="secondary">
        {name ?? '—'}
      </AppText>
    </View>
  );
}

/* ── PageScaffold (web @/components/layout PageContainer, L8) ───────────────── */

function PageScaffold({
  title,
  subtitle,
  actions,
  loading,
  children,
}: {
  title: string;
  subtitle: string;
  actions: ReactNode;
  loading: boolean;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView
      style={styles.scaffold}
      contentContainerStyle={styles.scaffoldContent}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="title" weight="bold">
            {title}
          </AppText>
          <AppText tone="secondary">{subtitle}</AppText>
        </View>
        <View style={styles.headerActions}>{actions}</View>
      </View>
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ================================================================ */
/*  Component (web L92-478) */
/* ================================================================ */

export default function TemperatureImpactPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('temperature.title', 'Temperature Impact'));

  /* --- unit conversion (SI display) ---
     Backend `/analytics/temperature-impact` emits points with:
       outside_temp: °C SI (from ambient_temp_c_avg)
       efficiency_wh_km: Wh/km (already derived in SQL)
       distance_km: km (already derived in SQL)
     We convert outside_temp via convertTempFromSI and Wh/km -> Wh/mi inline
     using KM_PER_MILE because there is no convertEfficiencyFromSI helper. */
  const {unitPrefs} = useUnits();
  const tempUnit = unitPrefs.temperature;
  const isMiles = unitPrefs.distance === 'mi';
  const effLabel = isMiles ? 'Wh/mi' : 'Wh/km';

  const toTemperatureDisplay = useCallback(
    (c: number) => convertTempFromSI(c, tempUnit),
    [tempUnit],
  );

  /* Efficiency: API returns Wh/km — convert to Wh/mi if user prefers miles */
  const toDispEff = useCallback(
    (whKm: number): number => (isMiles ? whKm * KM_PER_MILE : whKm),
    [isMiles],
  );

  /* Build display bucket labels */
  const tempBuckets: BucketDef[] = useMemo(
    () =>
      TEMP_BUCKETS_C.map((b, i) => ({
        label: bucketLabel(b, toTemperatureDisplay, tempUnit, i),
        min: b.min,
        max: b.max,
        color: b.color,
      })),
    [toTemperatureDisplay, tempUnit],
  );

  /* --- vehicles --- */
  const {vehicleId: selectedId, vehicleName} = useSelectedVehicle();
  const vehicleId = selectedId != null ? String(selectedId) : '';

  /* --- temperature data --- */
  const {
    data: points,
    isLoading,
    error: dataError,
  } = useQuery({
    queryKey: ['temperature-impact', vehicleId],
    queryFn: async () => {
      const res = await request<{points: TempEfficiencyPoint[]}>(
        `/analytics/temperature-impact?vehicle_id=${vehicleId}`,
      );
      return res.points ?? [];
    },
    enabled: vehicleId !== '',
  });

  const anyError = dataError as Error | undefined;

  /* --- derived stats --- */
  const stats = useMemo(() => {
    if (!points?.length) {
      return null;
    }

    const avgEff =
      points.reduce((s, p) => s + p.efficiency_wh_km, 0) / points.length;

    const bucketCounts = new Map<number, number[]>();
    for (const p of points) {
      const idx = getTempBucketIndex(p.outside_temp);
      const arr = bucketCounts.get(idx) ?? [];
      arr.push(p.efficiency_wh_km);
      bucketCounts.set(idx, arr);
    }

    const bucketAvgs: BucketAvg[] = tempBuckets.map((b, i) => {
      const vals = bucketCounts.get(i) ?? [];
      const avg = vals.length
        ? vals.reduce((s, v) => s + v, 0) / vals.length
        : 0;
      return {label: b.label, avg: toDispEff(avg), count: vals.length, color: b.color};
    });

    const withData = bucketAvgs.filter(b => b.count > 0);
    const best = withData.reduce((a, b) => (b.avg < a.avg ? b : a), withData[0]);
    const worst = withData.reduce((a, b) => (b.avg > a.avg ? b : a), withData[0]);

    return {avgEff: toDispEff(avgEff), bucketAvgs, best, worst, total: points.length};
  }, [points, tempBuckets, toDispEff]);

  /* --- scatter data with colour per point --- */
  const scatterData = useMemo<ScatterPoint[]>(
    () =>
      (points ?? []).map(p => ({
        x: toTemperatureDisplay(p.outside_temp),
        y: toDispEff(p.efficiency_wh_km),
        fill: TEMP_BUCKETS_C[getTempBucketIndex(p.outside_temp)].color,
      })),
    [points, toTemperatureDisplay, toDispEff],
  );

  /* --- contextual tips --- */
  const tips = useMemo(() => {
    const items: {glyph: string; text: string; variant: BadgeVariant}[] = [];
    if (!stats) {
      return items;
    }
    if (stats.best) {
      items.push({
        glyph: GLYPH.TrendingUp,
        text: t('tempImpact.tipOptimal', {
          range: stats.best.label,
          defaultValue: 'Best efficiency observed in the {{range}} range',
        }),
        variant: 'success',
      });
    }
    const cold = stats.bucketAvgs[0];
    if (cold && cold.count > 0) {
      items.push({
        glyph: GLYPH.Snowflake,
        text: t(
          'tempImpact.tipCold',
          'Precondition your cabin in cold weather to reduce battery drain',
        ),
        variant: 'info',
      });
    }
    const hot = stats.bucketAvgs[TEMP_BUCKETS_C.length - 1];
    if (hot && hot.count > 0) {
      items.push({
        glyph: GLYPH.Sun,
        text: t(
          'tempImpact.tipHot',
          'Park in shade during hot weather to preserve battery efficiency',
        ),
        variant: 'warning',
      });
    }
    return items;
  }, [stats, t]);

  /* --- vehicle selector action --- */
  const vehicleSelector = <VehicleChip name={vehicleName} />;

  // hasData removed
  const bestLabel = stats?.best?.label;

  /* ================================================================ */
  /*  Render */
  /* ================================================================ */

  return (
    <PageScaffold
      title={t('tempImpact.title', 'Temperature Impact')}
      subtitle={t(
        'tempImpact.subtitle',
        'How outside temperature affects driving efficiency',
      )}
      loading={isLoading}
      actions={vehicleSelector}>
      <View style={styles.stack}>
        {anyError ? (
          <AlertBanner>
            {t('error.loadFailed', 'Failed to load data')}:{' '}
            {getErrorMessage(anyError)}
          </AlertBanner>
        ) : null}

        {/* AI cabin-temperature-impact narrator (rendered above the charts so the
            narration contextualises the bucketed-efficiency chart + seasonal
            trend; the withAiFeature HOC gates visibility — in ai_mode='off' this
            section is entirely absent, ADR-015 §I5 + §I6). */}
        <AICabinTemperatureImpactNarrative
          vehicleId={vehicleId !== '' ? vehicleId : undefined}
        />

        {/* ── Summary MetricCards ───────────────────────────────── */}
        <View style={styles.metricGrid}>
          <FadeIn>
            <MetricCard
              label={t('tempImpact.avgEfficiency', 'Avg Efficiency')}
              value={stats ? `${fmtNumber(stats.avgEff)} ${effLabel}` : '—'}
              glyph={GLYPH.Thermometer}
              color="cyan"
            />
          </FadeIn>
          <FadeIn delay={0.05}>
            <MetricCard
              label={t('tempImpact.bestRange', 'Best Temp Range')}
              value={stats?.best?.label ?? '—'}
              glyph={GLYPH.TrendingUp}
              color="green"
              subtitle={
                stats?.best ? `${fmtNumber(stats.best.avg)} ${effLabel}` : undefined
              }
            />
          </FadeIn>
          <FadeIn delay={0.1}>
            <MetricCard
              label={t('tempImpact.worstRange', 'Worst Temp Range')}
              value={stats?.worst?.label ?? '—'}
              glyph={GLYPH.Sun}
              color="purple"
              subtitle={
                stats?.worst ? `${fmtNumber(stats.worst.avg)} ${effLabel}` : undefined
              }
            />
          </FadeIn>
          <FadeIn delay={0.15}>
            <MetricCard
              label={t('tempImpact.totalPoints', 'Total Data Points')}
              value={stats?.total ?? 0}
              glyph={GLYPH.Thermometer}
              color="cyan"
            />
          </FadeIn>
        </View>

        {/* ── Scatter Chart: Temperature vs Efficiency ─────────── */}
        <FadeIn delay={0.2}>
          <Panel>
            <AppText weight="semibold" style={styles.panelTitle}>
              {t('tempImpact.scatterTitle', 'Temperature vs Efficiency')}
            </AppText>
            <AppText variant="caption" tone="muted" style={styles.axisCaption}>
              {`${t('tempImpact.temperature', 'Temperature')} (${tempUnit})`} ·{' '}
              {`${t('tempImpact.efficiency', 'Efficiency')} (${effLabel})`}
            </AppText>
            <ScatterPlot
              points={scatterData}
              avg={stats ? stats.avgEff : null}
              xUnit={tempUnit}
              yLabel={t('tempImpact.efficiency', 'Efficiency')}
              avgColor={CHART_COLORS[1]}
              emptyLabel={t('common.noData', 'No data available')}
            />
          </Panel>
        </FadeIn>

        {/* ── Line Chart: Efficiency by Temperature Range ──────── */}
        <FadeIn delay={0.25}>
          <Panel>
            <AppText weight="semibold" style={styles.panelTitle}>
              {t('tempImpact.bucketTitle', 'Efficiency by Temperature Range')}
            </AppText>
            <AppText variant="caption" tone="muted" style={styles.axisCaption}>
              {`${t('tempImpact.avgEff', 'Avg Efficiency')} (${effLabel})`}
            </AppText>
            <BucketBarChart
              data={stats?.bucketAvgs ?? []}
              effLabel={effLabel}
              emptyLabel={t('common.noData', 'No data available')}
            />
          </Panel>
        </FadeIn>

        {/* ── Optimal Temperature Analysis ─────────────────────── */}
        {stats?.best ? (
          <FadeIn delay={0.3}>
            <Panel glow="green">
              <View style={styles.optimalRow}>
                <GlyphIcon glyph={GLYPH.Thermometer} color={colors.success} size={28} />
                <View style={styles.optimalCopy}>
                  <AppText weight="semibold" style={styles.panelTitle}>
                    {t('tempImpact.optimalTitle', 'Optimal Temperature Analysis')}
                  </AppText>
                  <AppText tone="secondary" style={styles.optimalDesc}>
                    {t('tempImpact.optimalDesc', {
                      range: stats.best.label,
                      efficiency: fmtNumber(stats.best.avg),
                      unit: effLabel,
                      count: stats.best.count,
                      defaultValue:
                        'Your most efficient temperature range is {{range}} with an average of {{efficiency}} {{unit}} across {{count}} drives.',
                    })}
                  </AppText>
                  {stats.worst && stats.best.label !== stats.worst.label ? (
                    <AppText variant="caption" tone="muted" style={styles.optimalDelta}>
                      {t('tempImpact.optimalDelta', {
                        worst: stats.worst.label,
                        delta: fmtNumber(stats.worst.avg - stats.best.avg),
                        unit: effLabel,
                        defaultValue:
                          'Compared to the worst range ({{worst}}), you save {{delta}} {{unit}} on average.',
                      })}
                    </AppText>
                  ) : null}
                  <View style={styles.badgeRow}>
                    {stats.bucketAvgs
                      .filter(b => b.count > 0)
                      .map(b => (
                        <Badge
                          key={b.label}
                          variant={b.label === bestLabel ? 'success' : 'neutral'}>
                          {b.label}: {fmtNumber(b.avg)} {effLabel}
                        </Badge>
                      ))}
                  </View>
                </View>
              </View>
            </Panel>
          </FadeIn>
        ) : null}

        {/* ── Tips & Recommendations ──────────────────────────── */}
        <FadeIn delay={0.35}>
          <Panel>
            <View style={styles.tipsTitleRow}>
              <GlyphIcon glyph={GLYPH.Lightbulb} color={colors.warning} size={16} />
              <AppText weight="semibold" style={styles.panelTitle}>
                {t('tempImpact.tipsTitle', 'Recommendations')}
              </AppText>
            </View>
            {tips.length > 0 ? (
              <View style={styles.tipsList}>
                {tips.map(tip => (
                  <View key={tip.text} style={styles.tipRow}>
                    <GlyphIcon glyph={tip.glyph} size={16} />
                    <View style={styles.tipBadge}>
                      <Badge variant={tip.variant} dot>
                        {tip.text}
                      </Badge>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyBlock
                glyph={GLYPH.Activity}
                message={t('common.noData', 'No data available')}
              />
            )}
          </Panel>
        </FadeIn>
      </View>
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  scaffold: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scaffoldContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  headerActions: {
    alignItems: 'flex-end',
  },
  loadingBox: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  stack: {
    gap: spacing.lg,
  },
  vehicleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  alertText: {
    flex: 1,
    minWidth: 0,
    color: colors.danger,
  },
  emptyBlock: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 150,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metricLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    flex: 1,
    minWidth: 0,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelGlowGreen: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  panelTitle: {
    color: colors.textPrimary,
  },
  axisCaption: {
    marginTop: -spacing.xs,
  },
  scatterPlot: {
    gap: spacing.sm,
  },
  scatterArea: {
    height: 240,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  scatterAvgLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.7,
  },
  scatterDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: -4,
    marginBottom: -4,
    opacity: 0.85,
  },
  scatterAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bucketChart: {
    gap: spacing.sm,
  },
  bucketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bucketLabel: {
    width: 96,
  },
  bucketTrack: {
    flex: 1,
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  bucketFill: {
    height: '100%',
    borderRadius: 999,
  },
  bucketValue: {
    width: 56,
    textAlign: 'right',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  optimalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  optimalCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  optimalDesc: {
    marginTop: spacing.xs,
  },
  optimalDelta: {
    marginTop: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  tipsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tipsList: {
    gap: spacing.sm,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  tipBadge: {
    flex: 1,
    minWidth: 0,
  },
});
