// Native parity port of
// web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx.
//
// The web module renders the driving-dynamics "Drive Analytics" block: a
// FadeIn-wrapped header (an <h2> title + a <RangePicker> bound to startDate /
// endDate), then a FadeIn'd two-column <Grid> holding a Speed Distribution
// Recharts <BarChart> (drives bucketed by average speed, one #3b82f6 Bar over the
// SPEED_BUCKETS_RANGES labels) and an Acceleration Patterns Recharts
// <ScatterChart> (one #a855f7 dot per drive plotting peak power kW vs trip
// distance, plus a #eab308 dashed ReferenceLine at the average peak power), and
// finally a FadeIn'd Power Profile Recharts <AreaChart> (the last 20 drives'
// peak #3b82f6 + regen #ef4444 power as two stacked areas over the drive-date
// XAxis). All three live inside the shared exportable <ChartContainer>.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site (the parity bundle ships
//     no i18n runtime).
//   • @/components/layout <Grid cols={{default:1, lg:2}}> -> a phone-first
//     stacked column (the web default column count is 1) — the established native
//     Grid collapse (StatisticsPage / VehicleHeroCard) — so the two panels stack.
//   • @/lib/dateFormat formatDateShort -> inlined verbatim ("Apr 4" via
//     toLocaleDateString {month:'short',day:'numeric'}, "—" guard) because the
//     @/lib/* tree is not ported into the native bundle.
//   • `import type { Drive } from '@/types/driving'` -> the already-ported native
//     Drive interface (same SI field shape) re-exported from
//     ../../../../api/hooks/useDriving.
//   • `import { SPEED_BUCKETS_RANGES } from './helpers'` -> inlined locally (the
//     same 0–30 … 120+ ranges) because the driving-dynamics ./helpers module is
//     not yet ported into the native bundle (the BatteryLevelChart precedent).
//   • the shared web <ChartContainer> -> the already-ported native ChartContainer
//     (same title/subtitle/ariaLabel/data/dataColumns/height/exportable API),
//     keeping the exportable Speed-range / Drives and Drive / Max kW / Regen kW
//     tables and the export filenames.
//   • @/components/forms <RangePicker> -> the already-ported native RangePicker
//     (same value {start,end} + onChange contract), wired to call
//     onStartDateChange(r.start) + onEndDateChange(r.end).
//   • @/components/motion <FadeIn delay> -> the already-ported native FadeIn (same
//     opacity/slide entry + reduced-motion fallback) at delays 0.45 / 0.5 / 0.55.
//   • the Speed Distribution Recharts ResponsiveContainer/BarChart/Bar/XAxis/
//     YAxis/CartesianGrid/Tooltip(+ChartGradient #3b82f6) -> a native-safe
//     horizontal bar list (the BatteryLevelChart convention): one #3b82f6 bar per
//     speed bucket scaled to the shared max count (matching Recharts' auto YAxis),
//     each labelled with its range and its always-visible count (the hover-only
//     Tooltip has no native equivalent).
//   • the Acceleration Patterns Recharts ScatterChart/Scatter/XAxis/YAxis/
//     CartesianGrid/Tooltip/ReferenceLine -> a native-safe scatter plot: one
//     #a855f7 dot per drive absolutely positioned by distance (x) and peak power
//     kW (y) inside a zero-anchored, grid-lined plot area, with the #eab308 dashed
//     average-power ReferenceLine + "Avg" label preserved and min/max axis ticks
//     (distance carries the distanceUnit, power the " kW" unit); an empty drive
//     set shows a placeholder instead of hiding the panel.
//   • the Power Profile Recharts ResponsiveContainer/AreaChart/Area×2/XAxis/YAxis/
//     CartesianGrid/Tooltip/Legend/ReferenceLine(+areaGradient/AREA_DEFAULTS) ->
//     the already-ported native <AreaChartWrapper> (the PowerOutputChart
//     convention), drawing the powerMax #3b82f6 / powerMin #ef4444 series over the
//     'label' date axis with native grid/axes + an always-visible latest-value
//     summary (RN has no hover tooltip); the YAxis " kW" label maps to the
//     yFormatter unit suffix, the Legend folds into that summary, and the
//     ReferenceLine y={0} needs no equivalent (the wrapper domain is zero-anchored
//     so 0 sits on the baseline).
// No DOM elements, react-i18next, Recharts, Leaflet, react-dom, or web UI-kit
// modules are imported into the native output.

import React, {useCallback, useMemo} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import type {Drive} from '../../../../api/hooks/useDriving';
import {AreaChartWrapper, ChartContainer} from '../../../../components/charts';
import {RangePicker} from '../../../../components/forms/RangePicker';
import {FadeIn} from '../../../../components/motion/FadeIn';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. A stable useCallback identity keeps the hook honest.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/dateFormat formatDateShort ─────────────────────────── */

// web formatDateShort: short date "Apr 4" ({month:'short',day:'numeric'}); "—"
// for nullish / invalid input. The host device locale is used (undefined).
function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/* ─── inlined ./helpers SPEED_BUCKETS_RANGES ───────────────────────────── */

// web SPEED_BUCKETS_RANGES: the average-speed buckets the distribution groups
// drives into; `max: Infinity` is the open-ended top bucket.
const SPEED_BUCKETS_RANGES = [
  {min: 0, max: 30, label: '0–30'},
  {min: 30, max: 60, label: '30–60'},
  {min: 60, max: 90, label: '60–90'},
  {min: 90, max: 120, label: '90–120'},
  {min: 120, max: Infinity, label: '120+'},
] as const;

// web ChartGradient id="speedFill" color="#3b82f6" / Bar fill -> bucket bar blue.
const SPEED_BAR_COLOR = '#3b82f6';
// web Scatter fill="#a855f7" -> per-drive acceleration dot purple.
const SCATTER_DOT_COLOR = '#a855f7';
// web ReferenceLine stroke="#eab308" -> average peak-power line amber.
const AVG_LINE_COLOR = '#eab308';
// web Area powerMax stroke="#3b82f6" / areaGradient powerMaxGrad -> peak power.
const POWER_MAX_COLOR = '#3b82f6';
// web Area powerMin stroke="#ef4444" / areaGradient powerMinGrad -> regen power.
const POWER_MIN_COLOR = '#ef4444';

const SCATTER_PLOT_HEIGHT = 260;

interface SpeedBucket {
  range: string;
  count: number;
}

interface AccelPoint {
  distance: number;
  powerMax: number;
}

interface PowerPoint {
  index: number;
  label: string;
  powerMax: number;
  powerMin: number;
}

interface DriveAnalyticsSectionProps {
  filteredDrives: Drive[];
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
  toDistanceDisplay: (v: number) => number;
  toSpeedDisplay: (v: number) => number;
  distanceUnit: string;
  speedUnit: string;
}

export default function DriveAnalyticsSection({
  filteredDrives,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  toDistanceDisplay,
  toSpeedDisplay,
  distanceUnit,
  speedUnit,
}: DriveAnalyticsSectionProps) {
  const {t} = useTranslation();

  const speedDistribution = useMemo<SpeedBucket[]>(() => {
    const buckets = SPEED_BUCKETS_RANGES.map(b => ({
      range: `${b.label} ${speedUnit}`,
      count: 0,
    }));
    for (const d of filteredDrives) {
      const spd = d.avgSpeedMps != null ? toSpeedDisplay(d.avgSpeedMps) : null;
      if (spd == null) {
        continue;
      }
      for (let i = 0; i < SPEED_BUCKETS_RANGES.length; i++) {
        const r = SPEED_BUCKETS_RANGES[i];
        const hi = r.max === Infinity ? Infinity : toSpeedDisplay(r.max);
        const lo = toSpeedDisplay(r.min);
        if (spd >= lo && spd < hi) {
          buckets[i].count += 1;
          break;
        }
      }
    }
    return buckets;
  }, [filteredDrives, toSpeedDisplay, speedUnit]);

  const accelPatterns = useMemo<AccelPoint[]>(
    () =>
      filteredDrives
        .filter(d => d.avgPowerW != null)
        .map(d => ({
          distance: Math.round(toDistanceDisplay(d.distanceM)),
          powerMax: (d.avgPowerW as number) / 1000,
        })),
    [filteredDrives, toDistanceDisplay],
  );

  const powerProfile = useMemo<PowerPoint[]>(() => {
    const recent = filteredDrives.slice(-20);
    return recent.map((d, i) => ({
      index: i + 1,
      label: formatDateShort(d.startTs),
      powerMax: (d.avgPowerW ?? 0) / 1000,
      powerMin: 0,
    }));
  }, [filteredDrives]);

  return (
    <View style={styles.root}>
      {/* Header + date filter */}
      <FadeIn delay={0.45}>
        <View style={styles.header}>
          <AppText style={styles.headerTitle} weight="semibold">
            {t('dynamics.driveAnalytics', 'Drive Analytics')}
          </AppText>
        </View>
        <RangePicker
          value={{start: startDate, end: endDate}}
          onChange={r => {
            onStartDateChange(r.start);
            onEndDateChange(r.end);
          }}
        />
      </FadeIn>

      {/* Speed Distribution + Acceleration Patterns */}
      <FadeIn delay={0.5}>
        <View style={styles.grid}>
          <ChartContainer
            title={t('dynamics.speedDistribution', 'Speed Distribution')}
            subtitle={t(
              'dynamics.speedDistDesc',
              'Drives grouped by average speed',
            )}
            ariaLabel={t(
              'dynamics.speedDistribution.aria',
              'Speed-bucket drive count distribution bar chart',
            )}
            data={speedDistribution.map(b => ({range: b.range, count: b.count}))}
            dataColumns={[
              {key: 'range', label: t('dynamics.col.range', 'Speed range')},
              {key: 'count', label: t('dynamics.col.drives', 'Drives')},
            ]}
            height={300}
            exportable
            exportFilename="speed-distribution">
            <SpeedDistributionBars buckets={speedDistribution} t={t} />
          </ChartContainer>

          {/* chart-a11y:no-table scatter chart of every drive — a per-row table here would be too dense; CSV export available */}
          <ChartContainer
            title={t('dynamics.accelPatterns', 'Acceleration Patterns')}
            subtitle={t(
              'dynamics.accelPatternsDesc',
              'Peak power vs trip distance',
            )}
            ariaLabel={t(
              'dynamics.accelPatterns.aria',
              'Per-drive scatter chart of peak power versus trip distance',
            )}
            height={300}
            exportable
            exportFilename="acceleration-patterns">
            <AccelerationScatter
              points={accelPatterns}
              distanceUnit={distanceUnit}
              t={t}
            />
          </ChartContainer>
        </View>
      </FadeIn>

      {/* Power Profile */}
      <FadeIn delay={0.55}>
        <ChartContainer
          title={t('dynamics.powerProfile', 'Power Profile')}
          subtitle={t(
            'dynamics.powerProfileDesc',
            'Peak & regen power for recent drives',
          )}
          ariaLabel={t(
            'dynamics.powerProfile.aria',
            'Recent-drives peak and regen power dual-area chart',
          )}
          data={powerProfile.map(d => ({
            label: d.label,
            powerMax: d.powerMax,
            powerMin: d.powerMin,
          }))}
          dataColumns={[
            {key: 'label', label: t('dynamics.col.drive', 'Drive')},
            {key: 'powerMax', label: t('dynamics.col.maxKw', 'Max kW')},
            {key: 'powerMin', label: t('dynamics.col.regenKw', 'Regen kW')},
          ]}
          height={320}
          exportable
          exportFilename="power-profile">
          <AreaChartWrapper
            data={powerProfile.map(d => ({
              label: d.label,
              powerMax: d.powerMax,
              powerMin: d.powerMin,
            }))}
            xKey="label"
            series={[
              {
                key: 'powerMax',
                label: t('dynamics.maxPower', 'Max Power (kW)'),
                color: POWER_MAX_COLOR,
              },
              {
                key: 'powerMin',
                label: t('dynamics.regenPower', 'Regen Power (kW)'),
                color: POWER_MIN_COLOR,
              },
            ]}
            height={320}
            yFormatter={(value: number) => `${Math.round(value)} kW`}
          />
        </ChartContainer>
      </FadeIn>
    </View>
  );
}

DriveAnalyticsSection.displayName = 'DriveAnalyticsSection';

/* ─── Speed Distribution: native-safe horizontal bar list ──────────────── */

interface SpeedDistributionBarsProps {
  buckets: SpeedBucket[];
  t: TFunc;
}

// web Recharts <BarChart> (range XAxis, count YAxis, #3b82f6 Bar named "Drives")
// -> a horizontal bar list scaled to the busiest bucket so every bar is
// proportional, with always-visible counts (RN has no hover Tooltip).
function SpeedDistributionBars({buckets, t}: SpeedDistributionBarsProps) {
  const max = Math.max(...buckets.map(b => b.count ?? 0), 1);

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={t(
        'dynamics.speedDistribution.aria',
        'Speed-bucket drive count distribution bar chart',
      )}
      style={styles.barList}>
      {buckets.map(bucket => {
        const count = bucket.count ?? 0;
        const width: DimensionValue =
          count > 0 ? `${Math.max((count / max) * 100, 2)}%` : '0%';
        return (
          <View key={bucket.range} style={styles.barRow}>
            <AppText
              numberOfLines={1}
              style={styles.barLabel}
              tone="muted"
              variant="caption">
              {bucket.range}
            </AppText>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, {width}]} />
            </View>
            <AppText style={styles.barValue} variant="caption" weight="semibold">
              {count}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/* ─── Acceleration Patterns: native-safe scatter plot ──────────────────── */

interface AccelerationScatterProps {
  points: AccelPoint[];
  distanceUnit: string;
  t: TFunc;
}

// web Recharts <ScatterChart> (distance XAxis, peak-power-kW YAxis, #a855f7 dots,
// #eab308 dashed average ReferenceLine) -> absolutely-positioned dots inside a
// zero-anchored, grid-lined plot area with the average line + min/max axis ticks.
function AccelerationScatter({
  points,
  distanceUnit,
  t,
}: AccelerationScatterProps) {
  const layout = useMemo(() => {
    if (points.length === 0) {
      return null;
    }
    const xs = points.map(p => p.distance);
    const ys = points.map(p => p.powerMax);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMaxRaw = Math.max(...ys, 0);
    const yMin = 0;
    const yMax = yMaxRaw > 0 ? yMaxRaw : 1;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const avg = ys.reduce((sum, v) => sum + v, 0) / ys.length;
    return {xMin, xMax, yMin, yMax, xSpan, ySpan, avg};
  }, [points]);

  return (
    <View style={styles.scatter}>
      <View style={styles.scatterYAxis}>
        {layout ? (
          <>
            <AppText style={styles.axisTick} variant="caption">
              {`${Math.round(layout.yMax)} kW`}
            </AppText>
            <AppText style={styles.axisTick} variant="caption">
              {`${Math.round((layout.yMax + layout.yMin) / 2)} kW`}
            </AppText>
            <AppText style={styles.axisTick} variant="caption">
              {`${Math.round(layout.yMin)} kW`}
            </AppText>
          </>
        ) : null}
      </View>

      <View style={styles.scatterBody}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={t(
            'dynamics.accelPatterns.aria',
            'Per-drive scatter chart of peak power versus trip distance',
          )}
          style={styles.scatterPlot}>
          {[0, 50, 100].map(line => (
            <View
              key={`grid-${line}`}
              pointerEvents="none"
              style={[styles.scatterGrid, {top: `${line}%` as DimensionValue}]}
            />
          ))}

          {layout
            ? points.map((p, i) => {
                const left: DimensionValue = `${
                  ((p.distance - layout.xMin) / layout.xSpan) * 100
                }%`;
                const bottom: DimensionValue = `${Math.min(
                  Math.max(((p.powerMax - layout.yMin) / layout.ySpan) * 100, 0),
                  100,
                )}%`;
                return (
                  <View
                    key={`${p.distance}-${p.powerMax}-${i}`}
                    pointerEvents="none"
                    style={[styles.scatterDot, {left, bottom}]}
                  />
                );
              })
            : null}

          {layout ? (
            <View
              pointerEvents="none"
              style={[
                styles.avgLine,
                {bottom: `${(layout.avg / layout.ySpan) * 100}%` as DimensionValue},
              ]}>
              <AppText style={styles.avgLabel} variant="caption">
                {t('dynamics.avg', 'Avg')}
              </AppText>
            </View>
          ) : null}

          {layout ? null : (
            <View style={styles.scatterEmpty}>
              <AppText tone="muted" variant="caption">
                {t('dynamics.drives', 'Drives')}
              </AppText>
            </View>
          )}
        </View>

        {layout ? (
          <View style={styles.scatterXAxis}>
            <AppText style={styles.axisTick} variant="caption">
              {`${Math.round(layout.xMin)} ${distanceUnit}`}
            </AppText>
            <AppText
              style={[styles.axisTick, styles.axisTickEnd]}
              variant="caption">
              {`${Math.round(layout.xMax)} ${distanceUnit}`}
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
    width: '100%',
  },
  header: {
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0.2,
  },
  grid: {
    gap: spacing.md,
    width: '100%',
  },
  barList: {
    gap: spacing.sm,
    width: '100%',
  },
  barRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  barLabel: {
    width: 88,
  },
  barTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    flex: 1,
    height: 12,
    overflow: 'hidden',
  },
  barFill: {
    backgroundColor: SPEED_BAR_COLOR,
    borderRadius: 4,
    height: '100%',
  },
  barValue: {
    color: colors.textPrimary,
    textAlign: 'right',
    width: 32,
  },
  scatter: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  scatterYAxis: {
    height: SCATTER_PLOT_HEIGHT,
    justifyContent: 'space-between',
    paddingBottom: 18,
    width: 48,
  },
  scatterBody: {
    flex: 1,
    gap: spacing.xs,
  },
  scatterPlot: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: SCATTER_PLOT_HEIGHT,
    overflow: 'hidden',
    position: 'relative',
  },
  scatterGrid: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.72,
    position: 'absolute',
    right: 0,
  },
  scatterDot: {
    backgroundColor: SCATTER_DOT_COLOR,
    borderRadius: 4,
    height: 8,
    marginBottom: -4,
    marginLeft: -4,
    position: 'absolute',
    width: 8,
  },
  avgLine: {
    borderColor: AVG_LINE_COLOR,
    borderStyle: 'dashed',
    borderTopWidth: 1,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  avgLabel: {
    color: AVG_LINE_COLOR,
    paddingHorizontal: spacing.xs,
    position: 'absolute',
    right: 0,
    top: 2,
  },
  scatterEmpty: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  scatterXAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 18,
  },
  axisTick: {
    color: colors.textMuted,
  },
  axisTickEnd: {
    textAlign: 'right',
  },
});
