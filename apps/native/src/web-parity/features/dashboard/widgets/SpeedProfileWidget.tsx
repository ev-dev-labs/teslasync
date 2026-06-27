// Native parity port of
// web/src/features/dashboard/widgets/SpeedProfileWidget.tsx.
//
// A dashboard widget that visualises a vehicle's speed distribution. It reads
// the `/analytics/speed-profile` payload (via the native `useSpeedProfile`
// hook), turns each SI speed bucket into a frequency-of-readings percentage and
// an average-power efficiency value, then renders a two-series chart — bars for
// how often each speed band is driven plus an efficiency marker series — with a
// "Most Common / Peak Freq / Sweet Spot" summary row. The compact (1-col)
// layout drops the chart and shows just the summary stats; the standard/wide
// (2x4+) layout shows both, and the bucket axis labels shrink when the widget
// is not wide (web `isWide ? axisTick : axisTickSm`). When no speed data is
// available the section never hides — it falls back to an EmptyState inside the
// WidgetChartSummary (preserving the web `isEmpty` contract).
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (DriveEfficiencyChartWidget /
// BatteryHealthAnalyticsWidget) — every such dependency is reproduced inline
// with React Native primitives + the shared native building blocks and
// documented in the sidecar:
//
//   - Recharts (ComposedChart/Bar/Line/XAxis/YAxis/Tooltip/ResponsiveContainer)
//     + the chart helpers (chartGrid, chartMargin, axisTick/axisTickSm,
//     chartAnimation, fmt) are DOM/SVG-only and cannot run in React Native. The
//     dual-Y-axis bar+line ComposedChart is reproduced by an inline native
//     `SpeedProfileChart` built from RN Views (the same technique the shared
//     native AreaChartWrapper uses): frequency renders as bars normalised to its
//     own left-axis domain (web `yAxisId="freq"`, fill #6366f1) and efficiency
//     renders as dot markers normalised to its own right-axis domain (web
//     `yAxisId="eff"`, #f59e0b) — preserving the web's independent dual-scale
//     intent. RN has no touch hover layer, so the web `<Tooltip>` (which
//     formatted frequency% / efficiency on hover) is dropped; both series are
//     identified by the chart's built-in legend instead. `fmt` (web charts:
//     fmtNumber at precision, default 1) is inlined verbatim and threaded to the
//     axis tick formatters exactly as the web YAxis `tickFormatter` used it.
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell`: loading -> a skeleton block; error
//     -> a centred error box with a retry Pressable (mirrors the web
//     <QueryError>); otherwise either a titled header (icon + uppercase muted
//     title + freshness chip) over the children, or — when title-less (the
//     compact branch) — the children with the freshness chip overlaid top-right,
//     exactly like the web shell. Only the props this widget passes (title,
//     icon, loading, error, updatedAt, isFetching, isStale, isError, onRefresh)
//     are honoured.
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/
//     error) chip the shell renders — is reproduced inline as `WidgetFreshness`:
//     same isError>fetching>stale>fresh precedence, the same dot colour tiers,
//     the "just now / Nm/Nh/Nd/Nw ago" relative ladder, "updating…"/"error"
//     labels, a 30s re-render tick, and onRefresh wired to a Pressable.
//   - WidgetChartSummary + ChartSummaryStat (web .../shared) -> inline
//     `WidgetChartSummary` + local `ChartSummaryStat`: same isEmpty ->
//     EmptyState fallback, the same stat row (label + value + optional unit),
//     and the chart rendered below only when !compact. The web emptyIcon
//     (lucide Activity) has no native EmptyState slot and is dropped (the
//     activity signal is preserved by the shell header glyph).
//   - feedback EmptyState -> shared native EmptyState (web's single `message`
//     becomes the native `title`).
//   - @/hooks/useUnits -> inline `useUnits` (derives `unitPrefs.speed` from the
//     native useSettings exactly as web useUnits' deriveSpeed does:
//     unit_of_length === 'mi' -> 'mph' else 'km/h'). This widget only reads
//     `unitPrefs.speed`, so the mirror exposes just that pref.
//   - @/lib/unitConversion convertSpeedFromSI -> inlined verbatim (km/h =
//     mps*3600/1000, mph = mps*3600/1609.344) with the NIST metre constant.
//   - @/lib/numberFormat fmtNumber + fmtInt are inlined verbatim (safeNumber
//     guard, en-US grouping; fmtInt = fmtNumber(v, 0)) without useSettings-driven
//     global precision/locale wiring.
//   - lucide-react Activity has no native icon font; the header icon becomes a
//     small cyan "∿" pulse glyph (the meaningful activity signal), and the
//     EmptyState Activity icon is dropped as noted above.
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.speedProfile.* / freshness.* key + the {{var}}
//     interpolation intact.
//
// The speed-profile query is preserved unchanged: the native `useSpeedProfile`
// hook is called with `vid > 0 ? String(vid) : undefined` (same `/analytics/
// speed-profile?vehicle_id=...` path, same `enabled` gating) and useVehicles()
// is called unchanged for the vehicle fallback. State names (vehicles, vid,
// unitPrefs, toSpeedDisplay, speedUnit, data, isLoading, error, isFetching,
// isStale, isError, dataUpdatedAt, refetch, chartData, sweetSpot, peakFreq,
// peakBucket, isCompact, isWide, hasData, stats, tick) are preserved. Pure
// helpers (buildChartData, formatBucketLabel, findSweetSpot, ChartDatum) are
// ported verbatim. No DOM, react-router, framer-motion, lucide-react, Recharts,
// Leaflet, or old web UI components are imported into the native output.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useSpeedProfile} from '../../../api/hooks/useDriving';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.*/freshness.* key verbatim and applying the same
// {{var}} interpolation as the web `t` (useTranslation('dashboard')).
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Inlined formatters (web @/lib/numberFormat) ─────────────────────────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision. The web global precision
// defaults to 2 (set by useSettings, which this widget does not wire), so 2 is
// the faithful unconfigured default.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web fmtInt — integer with locale separators (fmtNumber at precision 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// web charts `fmt` — fmtNumber at the given precision (default 1). Threaded to
// the chart axis formatters exactly as the web YAxis tickFormatter used it.
function fmt(v: unknown, decimals = 1): string {
  return fmtNumber(v, decimals);
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ─────── */

type SpeedUnitPref = 'km/h' | 'mph';

interface UnitPrefs {
  speed: SpeedUnitPref;
}

// NIST metre constants + seconds-per-hour (web lib/unitConversion).
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;

// Pure SI -> display converter, verbatim from web lib/unitConversion.
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

// Mirrors web useUnits: derive the speed preference from useSettings exactly as
// web's deriveSpeed does (unit_of_length === 'mi' -> 'mph' else 'km/h'). This
// widget only reads `unitPrefs.speed`, so the mirror exposes just it.
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const speed: SpeedUnitPref =
    settings?.unit_of_length === 'mi' ? 'mph' : 'km/h';
  return useMemo(() => ({unitPrefs: {speed}}), [speed]);
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── Chart summary types (web .../shared WidgetChartSummary) ──────────────── */

interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

/* ─── Chart datum + pure helpers (web source L17-68) ──────────────────────── */

interface ChartDatum {
  bucket: string;
  frequency: number;
  efficiency: number;
}

function buildChartData(
  data: ReturnType<typeof useSpeedProfile>['data'],
  toSpeedDisplay: (mph: number) => number,
): ChartDatum[] {
  const distribution = data?.distribution ?? [];
  const totalReadings = distribution.reduce(
    (sum, b) => sum + (b.readings ?? 0),
    0,
  );

  return distribution.map(b => {
    const label = formatBucketLabel(
      b.speed_bucket ?? b.speedBucket ?? '',
      toSpeedDisplay,
    );
    const freq = totalReadings > 0 ? ((b.readings ?? 0) / totalReadings) * 100 : 0;
    const eff = b.avg_power_kw ?? b.avgPowerKw ?? 0;
    return {bucket: label, frequency: freq, efficiency: eff};
  });
}

/** Convert bucket label to user's speed unit, e.g. "20-40" → "32-64" */
function formatBucketLabel(
  bucket: string,
  toSpeedDisplay: (mph: number) => number,
): string {
  const parts = bucket.split('-');
  if (parts.length === 2) {
    const lo = parseFloat(parts[0]);
    const hi = parseFloat(parts[1]);
    if (!isNaN(lo) && !isNaN(hi)) {
      return `${fmtInt(toSpeedDisplay(lo))}-${fmtInt(toSpeedDisplay(hi))}`;
    }
  }
  // "80+" style bucket
  const num = parseFloat(bucket);
  if (!isNaN(num)) {
    return `${fmtInt(toSpeedDisplay(num))}+`;
  }
  return bucket;
}

/** Find the bucket with the best (lowest avg_power_w) efficiency */
function findSweetSpot(chartData: ChartDatum[]): string {
  const withEff = chartData.filter(d => d.efficiency > 0);
  if (withEff.length === 0) {
    return '\u2014';
  }
  let best = withEff[0];
  for (const d of withEff) {
    if (d.efficiency < best.efficiency) {
      best = d;
    }
  }
  return best.bucket;
}

/* ─── WidgetFreshness (web data-display DataFreshness 4-state chip) ────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

// web FRESHNESS_COLORS dot tiers (emerald-400 / sky-400 / amber-400 / red-400).
const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

// web DataFreshness.formatRelativeTime — minute/hour/day/week relative ladder.
function formatFreshnessRelative(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

function useThirtySecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

function WidgetFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  useThirtySecondTick(!!updatedAt && updatedAt > 0);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const relativeTime =
    updatedAt && updatedAt > 0 && !isFetching
      ? formatFreshnessRelative(updatedAt)
      : isFetching
        ? t('freshness.updating', 'updating\u2026')
        : isError
          ? t('freshness.error', 'error')
          : '';

  const refreshable = !!onRefresh && !isFetching;

  return (
    <Pressable
      accessibilityRole={onRefresh ? 'button' : 'text'}
      accessibilityLabel={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {
              state: status,
            })
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="speed-profile-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="speed-profile-freshness-dot"
      />
      {relativeTime ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.freshnessLabel}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── WidgetShell (web .../WidgetShell.tsx subset) ────────────────────────── */

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  if (loading) {
    return <View style={styles.skeleton} testID="speed-profile-loading" />;
  }

  if (error) {
    return (
      <View style={styles.errorBox} testID="speed-profile-error">
        <AppText tone="danger" weight="semibold" numberOfLines={3}>
          {error}
        </AppText>
        {onRefresh ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            testID="speed-profile-error-retry">
            <AppText variant="caption" tone="accent">
              {t('common.retry', 'Retry')}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const freshness = (
    <WidgetFreshness
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={onRefresh}
    />
  );

  const body = <View style={styles.shellBody}>{children}</View>;

  // Title-less widgets (the compact branch) overlay the freshness chip in the
  // top-right corner, exactly like the web shell.
  if (!title) {
    return (
      <View style={styles.shell} testID="speed-profile-widget">
        <View style={styles.freshnessOverlay}>{freshness}</View>
        {body}
      </View>
    );
  }

  return (
    <View style={styles.shell} testID="speed-profile-widget">
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleRow}>
          {icon}
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shellTitle}>
            {title}
          </AppText>
        </View>
        {freshness}
      </View>
      {body}
    </View>
  );
}

/* ─── ActivityGlyph (web header lucide Activity, text-neon-cyan) ───────────── */

function ActivityGlyph({style}: {style?: StyleProp<ViewStyle>}) {
  return (
    <View style={[styles.activityGlyph, style]} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" style={styles.activityGlyphText}>
        {'\u223F'}
      </AppText>
    </View>
  );
}

/* ─── WidgetChartSummary (web .../shared WidgetChartSummary) ───────────────── */

function WidgetChartSummary({
  stats,
  chart,
  compact,
  emptyMessage,
  isEmpty,
}: {
  stats: ChartSummaryStat[];
  chart: React.ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  isEmpty?: boolean;
}) {
  if (isEmpty) {
    return (
      <View testID="speed-profile-empty">
        <EmptyState title={emptyMessage ?? 'No data available'} message="" />
      </View>
    );
  }

  return (
    <View style={styles.summaryRoot}>
      {stats.length > 0 ? (
        <View style={styles.statRow} testID="speed-profile-stats">
          {stats.map(stat => (
            <View key={stat.label} style={styles.statItem}>
              <AppText
                variant="caption"
                tone="muted"
                numberOfLines={1}
                style={styles.statLabel}>
                {stat.label}
              </AppText>
              <AppText weight="semibold" numberOfLines={1} style={styles.statValue}>
                {stat.value}
                {stat.unit ? (
                  <AppText variant="caption" tone="muted" style={styles.statUnit}>
                    {' '}
                    {stat.unit}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? (
        <View style={styles.chartArea} testID="speed-profile-plot">
          {chart}
        </View>
      ) : null}
    </View>
  );
}

/* ─── SpeedProfileChart (web Recharts ComposedChart Bar + Line, dual Y-axis) ─ */

// Renders the web ComposedChart faithfully with RN Views: frequency as bars
// (left-axis domain, #6366f1) and efficiency as dot markers (right-axis domain,
// #f59e0b). Each series is normalised to its own domain, preserving the web's
// independent dual-Y-axis scaling. There is no hover tooltip on a touch surface
// (web <Tooltip> dropped); the legend identifies both series.
function SpeedProfileChart({
  data,
  freqColor,
  effColor,
  freqLabel,
  effLabel,
  formatFreq,
  formatEff,
  dense,
  height = 180,
  testID,
}: {
  data: ChartDatum[];
  freqColor: string;
  effColor: string;
  freqLabel: string;
  effLabel: string;
  formatFreq: (v: number) => string;
  formatEff: (v: number) => string;
  dense?: boolean;
  height?: number;
  testID?: string;
}) {
  const maxFreq = useMemo(
    () => data.reduce((m, d) => Math.max(m, d.frequency), 0),
    [data],
  );
  const maxEff = useMemo(
    () => data.reduce((m, d) => Math.max(m, d.efficiency), 0),
    [data],
  );
  const freqDomain = maxFreq > 0 ? maxFreq : 1;
  const effDomain = maxEff > 0 ? maxEff : 1;

  const freqTicks = [freqDomain, freqDomain / 2, 0];
  const effTicks = [effDomain, effDomain / 2, 0];

  return (
    <View style={styles.chartRoot} testID={testID}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Speed distribution chart with ${data.length} buckets`}
        style={[styles.chartFrame, {height}]}>
        <View style={styles.yAxisLeft}>
          {freqTicks.map((tickVal, index) => (
            <AppText
              key={`f-${index}`}
              variant="caption"
              numberOfLines={1}
              style={styles.axisLabelLeft}>
              {formatFreq(tickVal)}
            </AppText>
          ))}
        </View>

        <View style={styles.chartContent}>
          <View style={styles.plotArea}>
            {[0, 50, 100].map(line => (
              <View
                key={`grid-${line}`}
                pointerEvents="none"
                style={[styles.gridLine, {top: `${line}%` as DimensionValue}]}
              />
            ))}

            <View style={styles.columns}>
              {data.map((d, index) => {
                const barPct =
                  d.frequency > 0
                    ? Math.max((d.frequency / freqDomain) * 100, 2)
                    : 0;
                const effPct = Math.min((d.efficiency / effDomain) * 100, 100);
                return (
                  <View key={`${d.bucket}-${index}`} style={styles.column}>
                    {d.efficiency > 0 ? (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.effMarkerWrap,
                          {bottom: `${effPct}%` as DimensionValue},
                        ]}>
                        <View
                          style={[
                            styles.effMarker,
                            {backgroundColor: effColor, borderColor: effColor},
                          ]}
                        />
                      </View>
                    ) : null}
                    <View
                      style={[
                        styles.bar,
                        {
                          height: `${barPct}%` as DimensionValue,
                          backgroundColor: freqColor,
                        },
                      ]}
                    />
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.xAxis}>
            {data.map((d, index) => (
              <AppText
                key={`x-${d.bucket}-${index}`}
                variant="caption"
                numberOfLines={1}
                style={[styles.xAxisLabel, dense && styles.xAxisLabelDense]}>
                {d.bucket || '-'}
              </AppText>
            ))}
          </View>
        </View>

        <View style={styles.yAxisRight}>
          {effTicks.map((tickVal, index) => (
            <AppText
              key={`e-${index}`}
              variant="caption"
              numberOfLines={1}
              style={styles.axisLabelRight}>
              {formatEff(tickVal)}
            </AppText>
          ))}
        </View>
      </View>

      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel="Speed profile series"
        style={styles.legend}>
        <View style={styles.legendItem}>
          <View
            pointerEvents="none"
            style={[styles.legendDot, {backgroundColor: freqColor}]}
          />
          <AppText variant="caption" numberOfLines={1} style={styles.legendLabel}>
            {freqLabel}
          </AppText>
        </View>
        <View style={styles.legendItem}>
          <View
            pointerEvents="none"
            style={[styles.legendDot, {backgroundColor: effColor}]}
          />
          <AppText variant="caption" numberOfLines={1} style={styles.legendLabel}>
            {effLabel}
          </AppText>
        </View>
      </View>
    </View>
  );
}

/* ─── SpeedProfileWidget ──────────────────────────────────────────────────── */

export default function SpeedProfileWidget({vehicleId, size}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {unitPrefs} = useUnits();
  const speedPref = unitPrefs.speed;
  const toSpeedDisplay = useCallback(
    (value: number) => convertSpeedFromSI(value, speedPref),
    [speedPref],
  );

  const speedUnit = unitPrefs.speed;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSpeedProfile(vid > 0 ? String(vid) : undefined);

  const chartData = useMemo(
    () => buildChartData(data, toSpeedDisplay),
    [data, toSpeedDisplay],
  );

  const sweetSpot = useMemo(() => {
    // API provides optimal speed as SI m/s — toSpeedDisplay = convertSpeedFromSI
    // already expects m/s so it can be passed straight through.
    const optimal = data?.optimalSpeedMps ?? 0;
    if (optimal > 0) {
      return `${fmtInt(toSpeedDisplay(optimal))}`;
    }
    return findSweetSpot(chartData);
  }, [data, chartData, toSpeedDisplay]);

  const peakFreq = useMemo(() => {
    let max = 0;
    for (const d of chartData) {
      if (d.frequency > max) {
        max = d.frequency;
      }
    }
    return max;
  }, [chartData]);

  const peakBucket = useMemo(() => {
    const peak = chartData.find(d => d.frequency === peakFreq);
    return peak?.bucket ?? '\u2014';
  }, [chartData, peakFreq]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0 && chartData.some(d => d.frequency > 0);

  // ── Compact (1-col): summary stats only ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}>
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.speedProfile.noData', 'No speed data')}
          stats={
            hasData
              ? [
                  {
                    label: t('widget.speedProfile.mostCommon', 'Most Common'),
                    value: peakBucket,
                    unit: speedUnit,
                  },
                  {
                    label: t('widget.speedProfile.sweetSpot', 'Sweet Spot'),
                    value: sweetSpot,
                    unit: speedUnit,
                  },
                ]
              : []
          }
          chart={null}
        />
      </WidgetShell>
    );
  }

  // ── Standard (2×4+): stat header + composed chart ──
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.speedProfile.mostCommon', 'Most Common'),
          value: peakBucket,
          unit: speedUnit,
        },
        {
          label: t('widget.speedProfile.peakFreq', 'Peak Freq'),
          value: `${fmtNumber(peakFreq, 1)}%`,
        },
        {
          label: t('widget.speedProfile.sweetSpot', 'Sweet Spot'),
          value: sweetSpot,
          unit: speedUnit,
        },
      ]
    : [];

  // web `tick = isWide ? axisTick : axisTickSm` — Recharts tick styling. Native
  // axis styling is internal to SpeedProfileChart; the wide/narrow distinction
  // is preserved by shrinking the bucket axis labels when the widget is narrow.
  const dense = !isWide;

  return (
    <WidgetShell
      title={t('widget.speedProfile.title', 'Speed Profile')}
      icon={<ActivityGlyph />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.speedProfile.noData', 'No speed data')}
        stats={stats}
        chart={
          <SpeedProfileChart
            data={chartData}
            freqColor="#6366f1"
            effColor="#f59e0b"
            freqLabel={t('widget.speedProfile.frequency', 'Frequency')}
            effLabel={t('widget.speedProfile.efficiency', 'Wh/mi')}
            formatFreq={(v: number) => `${fmt(v, 0)}%`}
            formatEff={(v: number) => fmt(v, 0)}
            dense={dense}
            testID="speed-profile-chart"
          />
        }
      />
    </WidgetShell>
  );
}

SpeedProfileWidget.displayName = 'SpeedProfileWidget';

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    position: 'relative',
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  freshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  skeleton: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  errorBox: {
    flex: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.sm,
    padding: spacing.md,
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    flexShrink: 0,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  activityGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityGlyphText: {
    color: colors.accent,
  },
  summaryRoot: {
    flex: 1,
    minHeight: 0,
    rowGap: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.lg,
    rowGap: spacing.xs,
    paddingTop: spacing.xs,
  },
  statItem: {
    flexShrink: 1,
    minWidth: 0,
  },
  statLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  statValue: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  statUnit: {
    fontSize: 10,
  },
  chartArea: {
    flex: 1,
    minHeight: 0,
    paddingTop: spacing.xs,
  },
  chartRoot: {
    alignSelf: 'stretch',
    rowGap: spacing.sm,
    width: '100%',
  },
  chartFrame: {
    flexDirection: 'row',
    columnGap: spacing.sm,
    width: '100%',
  },
  yAxisLeft: {
    justifyContent: 'space-between',
    paddingBottom: 22,
    width: 38,
  },
  yAxisRight: {
    justifyContent: 'space-between',
    paddingBottom: 22,
    width: 38,
  },
  axisLabelLeft: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    textAlign: 'right',
  },
  axisLabelRight: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    textAlign: 'left',
  },
  chartContent: {
    flex: 1,
    rowGap: spacing.xs,
  },
  plotArea: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  gridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.72,
    position: 'absolute',
    right: 0,
  },
  columns: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    columnGap: 2,
    alignItems: 'flex-end',
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  column: {
    flex: 1,
    minWidth: 2,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    position: 'relative',
  },
  bar: {
    width: '78%',
    maxWidth: 32,
    minHeight: 2,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  effMarkerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  effMarker: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    marginBottom: -3,
  },
  xAxis: {
    flexDirection: 'row',
    columnGap: spacing.xs,
    justifyContent: 'space-between',
    minHeight: 18,
  },
  xAxisLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  xAxisLabelDense: {
    fontSize: 9,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  legendItem: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    columnGap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  legendLabel: {
    color: colors.textSecondary,
    maxWidth: 140,
  },
});
