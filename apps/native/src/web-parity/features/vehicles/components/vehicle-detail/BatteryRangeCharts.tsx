// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx.
//
// The web original renders a responsive 2-column grid of two GlassPanels:
//   1. "Battery Overview" — a Recharts <RadialGauge> + two stat tiles
//      (battery % and rated range via <AnimatedNumber>) + a Recharts
//      <BarChart> of [Current, Remaining] on a fixed 0-100 domain.
//   2. "Drive Distance Trend" — a Recharts <AreaChart> of the recent drives'
//      distance + duration (reversed to oldest-first), or an <EmptyState>
//      when there are no drives.
// The public <BatteryRangeCharts> prop surface ({ state, drives }) and the
// derived data shapes (batteryChartData, driveChartData) are preserved verbatim.
//
// Browser-only / not-yet-ported web dependencies and how each is reproduced:
//   - Recharts (RadialGauge, BarChart, AreaChart, Bar, Area, XAxis, YAxis,
//     CartesianGrid, Tooltip, ResponsiveContainer, Legend, ChartTooltip,
//     CHART_COLORS, AREA_DEFAULTS, areaGradient) is DOM/SVG-only, so every
//     chart is reproduced with React Native primitives + an accessible data
//     table (the established native chart idiom): the RadialGauge becomes a
//     circular gauge badge with a proportional fill, the BarChart becomes two
//     vertical bars on the same 0-100 domain, and the AreaChart becomes a
//     two-series (distance + duration) grouped-bar plot with a colour legend.
//     CHART_COLORS[0] -> colors.accent, CHART_COLORS[1] -> colors.violet.
//   - lucide-react Battery/Route header icons -> shared SemanticIcon glyphs
//     ('battery' / 'trip'); the decorative Route icon inside the empty state is
//     dropped (its text message is preserved), the documented native idiom.
//   - react-i18next useTranslation -> local English-default t(key, fallback)
//     keeping every common.* / vehicles.detail.* key verbatim.
//   - @/hooks/useUnits + @/lib/unitConversion (convertDistanceFromSI) +
//     @/lib/numberFormat (the fmtNumber that <AnimatedNumber> uses) have no
//     shared native module, so the exact pieces used are inlined verbatim and
//     the user's distance-unit + locale preferences are derived from the native
//     useSettings exactly as web useUnits derives them (unit_of_length 'mi'
//     -> 'mi' else 'km'; locale; decimal_precision).
//   - @/lib/dateFormat formatDate -> inlined (date-only toLocaleDateString with
//     the '—' fallback for nullish/invalid input).
//   - @/components/data-display AnimatedNumber -> a static formatted readout
//     (no count-up animation), the established "render at rest state" idiom;
//     value math, decimals (0), and the suffix are preserved byte-faithfully.
//   - @/components/ui GlassPanel + @/components/feedback EmptyState are used
//     directly; ./helpers batteryColor is inlined verbatim.
//   - Tailwind className styling -> StyleSheet; the responsive lg:grid-cols-2
//     grid collapses to a single mobile-first column.
//
// No DOM, Recharts, Leaflet, lucide-react, or old web UI components are imported.

import React, {useMemo} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {Drive, VehicleState} from '../../../../api/types';

/* ─── i18n fallback (react-i18next is not wired in native) ─────────────────── */

// i18next returns the supplied default when a key is missing; this fallback
// returns the English default while keeping every key verbatim from the source.
function t(_key: string, fallback: string): string {
  return fallback;
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ──────── */

type DistanceUnitPref = 'km' | 'mi';

// NIST-grade factors, verbatim from web lib/unitConversion.
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

// Pure SI -> display converter, verbatim from web lib/unitConversion.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Mirrors web lib/numberFormat.fmtNumber (the formatter <AnimatedNumber> uses).
function formatNumber(
  value: number,
  locale: string,
  fractionDigits: number,
): string {
  const options = {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  };
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    // Bad locale tag — fall back to en-US so we still produce a string.
    return new Intl.NumberFormat('en-US', options).format(value);
  }
}

interface UnitsBridge {
  unitPrefs: {distance: DistanceUnitPref};
  /** Reproduces <AnimatedNumber>'s fmtNumber(value, decimals) at rest state. */
  fmtNumber: (value: number, decimals?: number) => string;
}

// Per-render bridge between user settings and the inlined formatters, derived
// exactly as web useUnits derives distance + locale from useSettings().
function useUnits(): UnitsBridge {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  const localeRaw = settings?.locale;

  return useMemo<UnitsBridge>(() => {
    const locale =
      typeof localeRaw === 'string' && localeRaw.trim() ? localeRaw : 'en-US';
    const distance: DistanceUnitPref = unitOfLength === 'mi' ? 'mi' : 'km';
    return {
      unitPrefs: {distance},
      fmtNumber: (value, decimals = 0) =>
        formatNumber(safeNumber(value), locale, decimals),
    };
  }, [unitOfLength, localeRaw]);
}

/* ─── Inlined date + battery-colour helpers ────────────────────────────────── */

// Mirrors web lib/dateFormat.formatDate (date-only, '—' fallback).
function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Verbatim from vehicle-detail/helpers.batteryColor.
function batteryColor(level: number): string {
  if (level > 60) return '#10b981';
  if (level > 25) return '#f59e0b';
  return '#ef4444';
}

// CHART_COLORS[0] / CHART_COLORS[1] equivalents for the native series.
const SERIES_DISTANCE = colors.accent;
const SERIES_DURATION = colors.violet;

function clampPct(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.max(0, Math.min(1, fraction));
}

/* ─── Public component ─────────────────────────────────────────────────────── */

interface BatteryRangeChartsProps {
  state: VehicleState;
  drives: Drive[] | undefined;
}

export function BatteryRangeCharts({state, drives}: BatteryRangeChartsProps) {
  const {unitPrefs, fmtNumber} = useUnits();

  const batteryChartData = useMemo(
    () => [
      {name: t('common.current', 'Current'), value: state.battery_level},
      {name: t('common.remaining', 'Remaining'), value: 100 - state.battery_level},
    ],
    [state.battery_level],
  );

  const driveChartData = useMemo(
    () =>
      (drives ?? [])
        .map(d => ({
          date: formatDate(d.start_ts),
          distance: Math.round(
            convertDistanceFromSI(d.distance_m ?? 0, unitPrefs.distance),
          ),
          duration: Math.round((d.duration_s ?? 0) / 60),
        }))
        .reverse(),
    [drives, unitPrefs.distance],
  );

  const distanceName = `${t('common.distance', 'Distance')} (${unitPrefs.distance})`;
  const durationName = t('common.duration', 'Duration');

  return (
    <View style={styles.grid}>
      {/* Battery overview */}
      <GlassPanel style={styles.panel}>
        <View style={styles.header}>
          <SemanticIcon name="battery" size="sm" decorative />
          <AppText variant="title" weight="bold">
            {t('vehicles.detail.batteryOverview', 'Battery Overview')}
          </AppText>
        </View>

        <View style={styles.gaugeRow}>
          <RadialGauge
            value={state.battery_level}
            max={100}
            label={t('common.battery', 'Battery')}
            unit="%"
            color={batteryColor(state.battery_level)}
            size={100}
            fmtNumber={fmtNumber}
          />
          <View style={styles.statColumn}>
            <GlassPanel style={styles.statTile}>
              <AppText variant="caption" tone="muted">
                {t('common.battery', 'Battery')}
              </AppText>
              <AppText variant="title" weight="bold">
                {`${fmtNumber(state.battery_level, 0)}%`}
              </AppText>
            </GlassPanel>
            <GlassPanel style={styles.statTile}>
              <AppText variant="caption" tone="muted">
                {t('common.range', 'Range')}
              </AppText>
              <AppText variant="title" weight="bold">
                {`${fmtNumber(
                  convertDistanceFromSI(state.rated_range, unitPrefs.distance),
                  0,
                )} ${unitPrefs.distance}`}
              </AppText>
            </GlassPanel>
          </View>
        </View>

        <BatteryBars data={batteryChartData} />
      </GlassPanel>

      {/* Recent drives distance trend */}
      <GlassPanel style={styles.panel}>
        <View style={styles.header}>
          <SemanticIcon name="trip" size="sm" decorative />
          <AppText variant="title" weight="bold">
            {t('vehicles.detail.driveTrend', 'Drive Distance Trend')}
          </AppText>
        </View>
        {driveChartData.length > 0 ? (
          <DriveTrend
            data={driveChartData}
            distanceName={distanceName}
            durationName={durationName}
            distanceUnit={unitPrefs.distance}
          />
        ) : (
          <EmptyState
            title=""
            message={t('vehicles.detail.noDriveData', 'No drive data for chart')}
          />
        )}
      </GlassPanel>
    </View>
  );
}

/* ─── RadialGauge (Recharts <RadialGauge> reproduction) ────────────────────── */

interface RadialGaugeProps {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
  size: number;
  fmtNumber: (value: number, decimals?: number) => string;
}

function RadialGauge({
  value,
  max,
  label,
  unit,
  color,
  size,
  fmtNumber,
}: RadialGaugeProps) {
  const fraction = max > 0 ? clampPct(value / max) : 0;
  const fillHeight = `${fraction * 100}%` as DimensionValue;

  return (
    <View style={styles.gauge}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${label} ${fmtNumber(value, 0)}${unit}`}
        style={[
          styles.gaugeRing,
          {width: size, height: size, borderRadius: size / 2, borderColor: color},
        ]}>
        <View
          pointerEvents="none"
          style={[styles.gaugeFill, {height: fillHeight, backgroundColor: color}]}
        />
        <AppText variant="title" weight="bold" style={styles.gaugeValue}>
          {`${fmtNumber(value, 0)}${unit}`}
        </AppText>
      </View>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

/* ─── BatteryBars (Recharts <BarChart> reproduction, 0-100 domain) ─────────── */

interface BatteryDatum {
  name: string;
  value: number;
}

function BatteryBars({data}: {data: BatteryDatum[]}) {
  return (
    <View>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Battery distribution chart with ${data.length} bars`}
        style={styles.barPlot}>
        {data.map(item => {
          const height = `${clampPct(item.value / 100) * 100}%` as DimensionValue;
          return (
            <View key={item.name} style={styles.barColumn}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {height, backgroundColor: SERIES_DISTANCE},
                  ]}
                />
              </View>
              <AppText
                variant="caption"
                tone="muted"
                numberOfLines={1}
                style={styles.axisLabel}>
                {item.name}
              </AppText>
            </View>
          );
        })}
      </View>
      <View style={styles.dataTable}>
        {data.map(item => (
          <View key={item.name} style={styles.dataRow}>
            <AppText variant="caption" tone="secondary" style={styles.dataLabel}>
              {item.name}
            </AppText>
            <AppText variant="caption" weight="semibold" style={styles.dataValue}>
              {`${Math.round(item.value)}%`}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ─── DriveTrend (Recharts <AreaChart> reproduction, two series) ───────────── */

interface DriveDatum {
  date: string;
  distance: number;
  duration: number;
}

interface DriveTrendProps {
  data: DriveDatum[];
  distanceName: string;
  durationName: string;
  distanceUnit: string;
}

function DriveTrend({
  data,
  distanceName,
  durationName,
  distanceUnit,
}: DriveTrendProps) {
  const max = Math.max(
    ...data.map(d => Math.max(d.distance, d.duration)),
    1,
  );

  return (
    <View style={styles.trend}>
      <View style={styles.legend}>
        <LegendChip color={SERIES_DISTANCE} label={distanceName} />
        <LegendChip color={SERIES_DURATION} label={durationName} />
      </View>

      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Drive distance and duration trend chart with ${data.length} points`}
        style={styles.trendPlot}>
        {data.map((item, index) => {
          const distanceHeight = `${clampPct(item.distance / max) * 100}%` as DimensionValue;
          const durationHeight = `${clampPct(item.duration / max) * 100}%` as DimensionValue;
          return (
            <View key={`${item.date}-${index}`} style={styles.trendColumn}>
              <View style={styles.trendBars}>
                <View style={styles.trendBarTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {height: distanceHeight, backgroundColor: SERIES_DISTANCE},
                    ]}
                  />
                </View>
                <View style={styles.trendBarTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {height: durationHeight, backgroundColor: SERIES_DURATION},
                    ]}
                  />
                </View>
              </View>
              <AppText
                variant="caption"
                tone="muted"
                numberOfLines={1}
                style={styles.axisLabel}>
                {item.date}
              </AppText>
            </View>
          );
        })}
      </View>

      <View style={styles.dataTable}>
        {data.map((item, index) => (
          <View key={`${item.date}-${index}`} style={styles.dataRow}>
            <AppText variant="caption" tone="secondary" style={styles.dataLabel}>
              {item.date}
            </AppText>
            <AppText variant="caption" weight="semibold" style={styles.dataValue}>
              {`${item.distance} ${distanceUnit} · ${item.duration} min`}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function LegendChip({color, label}: {color: string; label: string}) {
  return (
    <View style={styles.legendChip}>
      <View style={[styles.legendDot, {backgroundColor: color}]} />
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  gaugeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  gauge: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  gaugeRing: {
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  gaugeFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.22,
  },
  gaugeValue: {
    textAlign: 'center',
  },
  statColumn: {
    flex: 1,
    gap: spacing.sm,
  },
  statTile: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  barPlot: {
    height: 160,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  barColumn: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  barTrack: {
    flex: 1,
    justifyContent: 'flex-end',
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    minHeight: 4,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    opacity: 0.88,
  },
  axisLabel: {
    textAlign: 'center',
  },
  trend: {
    gap: spacing.md,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  trendPlot: {
    height: 200,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  trendColumn: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  trendBars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 2,
  },
  trendBarTrack: {
    flex: 1,
    justifyContent: 'flex-end',
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    overflow: 'hidden',
  },
  dataTable: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: 'hidden',
  },
  dataRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  dataLabel: {
    flex: 1,
    minWidth: 0,
  },
  dataValue: {
    textAlign: 'right',
  },
});
