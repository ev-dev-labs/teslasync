// Native parity port of web/src/features/driving/components/SOCRouteChart.tsx.
//
// The web component renders the trip-planner "Battery Along Route" card: a
// shared `ChartContainer` (title + ariaLabel + accessible data table built from
// the `{distance, soc}` rows) wrapping a Recharts `ResponsiveContainer` >
// `AreaChart` (height 300) that plots the planned state-of-charge curve as a
// green->yellow->red gradient `Area` over a distance X axis (0-100% SOC Y axis),
// with a red dashed `ReferenceLine` at the minimum arrival SOC and one blue
// dashed `ReferenceLine` per charge stop. When the SOC curve is empty it instead
// renders an `EmptyState` inside the same `ChartContainer`.
//
// Native substitutions (no DOM, Recharts, Leaflet, framer-motion, or web UI
// components are imported):
//   * `ChartContainer` (@/components/charts) -> the already-ported native-safe
//     web-parity `ChartContainer` (same title/ariaLabel/data/dataColumns/height
//     contract; it renders the accessible fallback data table from `data` +
//     `dataColumns`, exactly as the web container does).
//   * Recharts `ResponsiveContainer`/`AreaChart`/`Area`/`XAxis`/`YAxis`/
//     `CartesianGrid`/`Tooltip`/`ReferenceLine` and the SVG `<defs>`/
//     `<linearGradient>`/`<stop>` gradient (none of which render in React Native
//     without an SVG chart backend) -> a self-contained native plot built from
//     `View`s: 0/25/50/75/100% SOC gridlines, a bottom-anchored column per SOC
//     point coloured by the same green(>=50)/yellow(>=20)/red SOC bands the web
//     gradient encodes, a red dashed horizontal reference line at `minArrivalSOC`
//     and a blue dashed vertical reference line at every charge-stop distance,
//     plus a labelled marker legend that preserves the web "Min {x}%" and
//     "\u26a1 Stop {n}" reference-line labels (RN has no `strokeDasharray`, so the
//     dashed pattern is approximated with `borderStyle: 'dashed'`). The Recharts
//     hover `Tooltip` is a browser pointer interaction with no native plot to
//     attach to and is documented as omitted.
//   * `EmptyState` (@/components/feedback) -> the native `components/feedback`
//     EmptyState (it requires a `title`, so the chart title key is reused for the
//     title and the original empty-message key is preserved verbatim).
//   * react-i18next `useTranslation().t` -> a self-contained fallback that
//     returns the English fallback string, preserving every i18n key + default.
//   * `TripSOCPoint`/`TripChargeStop` (@/types/driving) -> the identical types
//     exported by the already-ported native `web-parity/api/hooks/useDriving`.
//
// The `chartData` and `stopDistances` `useMemo` derivations (including the round,
// leg-boundary matching, and cumulative-distance logic) are preserved verbatim;
// no unit conversion is performed (the web plots `distance_m` rounded to 0.1 and
// labels the axis "km" with no conversion, so this port does the same).

import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {colors, spacing} from '../../../../theme/tokens';
import {ChartContainer} from '../../../components/charts';
import type {
  TripChargeStop,
  TripSOCPoint,
} from '../../../api/hooks/useDriving';

type NativeTFunction = (key: string, fallback: string) => string;

// The web component read `t` from react-i18next. Native parity has no i18n
// runtime wired yet, so this returns the English fallback string, preserving the
// i18n key/fallback intent for the title, aria label, empty message, and the two
// data-table column labels.
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (_key, fallback) => fallback, []);
}

// SOC bands matching the web green->yellow->red gradient stops (#22c55e top,
// #eab308 mid, #ef4444 bottom). High SOC reads green, low SOC reads red.
const SOC_GREEN = '#22c55e';
const SOC_YELLOW = '#eab308';
const SOC_RED = '#ef4444';
// Reference-line colours from the web ReferenceLine strokes.
const MIN_ARRIVAL_COLOR = '#ef4444';
const CHARGE_STOP_COLOR = '#3b82f6';

const PLOT_HEIGHT = 300;
const SOC_GRID_LINES = [0, 25, 50, 75, 100] as const;
const SOC_AXIS_TICKS = [100, 75, 50, 25, 0] as const;
const MAX_X_TICKS = 4;

interface SOCRouteChartProps {
  socCurve: TripSOCPoint[];
  chargeStops: TripChargeStop[];
  minArrivalSOC: number;
}

interface ChartPoint {
  distance: number;
  soc: number;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function socBandColor(soc: number): string {
  if (soc >= 50) {
    return SOC_GREEN;
  }
  if (soc >= 20) {
    return SOC_YELLOW;
  }
  return SOC_RED;
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  if (!/^[\da-f]{6}$/i.test(value)) {
    return hex;
  }
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Mirrors Recharts placing a numeric ReferenceLine at x={dist} across the chart's
// distance domain: returns the left offset (0-100%) of `dist` within the data.
function xFractionPercent(dist: number, minDist: number, span: number): number {
  return clampPercent(((dist - minDist) / span) * 100);
}

// Picks up to four evenly spaced X-axis ticks, matching the AreaChart axis cadence.
function pickXTicks(points: ChartPoint[]): ChartPoint[] {
  if (points.length <= MAX_X_TICKS) {
    return points;
  }
  const last = points.length - 1;
  const indices = [0, Math.round(last / 3), Math.round((last * 2) / 3), last];
  return Array.from(new Set(indices)).map(index => points[index]);
}

export function SOCRouteChart({
  socCurve,
  chargeStops,
  minArrivalSOC,
}: SOCRouteChartProps) {
  const t = useNativeTranslationFallback();

  const chartData = useMemo<ChartPoint[]>(
    () =>
      (socCurve ?? []).map(pt => ({
        distance: Math.round(pt.distance_m * 10) / 10,
        soc: Math.round(pt.soc * 10) / 10,
      })),
    [socCurve],
  );

  // Find charge stop distances for reference lines
  const stopDistances = useMemo(() => {
    const distances: number[] = [];
    let cumDist = 0;
    for (const stop of chargeStops ?? []) {
      // Charge stops align with leg boundaries in soc_curve
      const matchPt = (socCurve ?? []).find(
        pt =>
          pt.distance_m > cumDist &&
          Math.abs(pt.soc - stop.charge_from_soc) < 5,
      );
      if (matchPt) {
        distances.push(Math.round(matchPt.distance_m));
        cumDist = matchPt.distance_m;
      }
    }
    return distances;
  }, [socCurve, chargeStops]);

  if (chartData.length === 0) {
    // chart-a11y:no-table empty-state branch wraps a placeholder, no series available to tabulate
    return (
      <ChartContainer
        title={t('tripPlanner.socChart.title', 'Battery Along Route')}
        ariaLabel={t(
          'tripPlanner.socChart.aria',
          'Planned route battery state-of-charge area chart',
        )}
        height={PLOT_HEIGHT}>
        {/* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */}
        <EmptyState
          title={t('tripPlanner.socChart.title', 'Battery Along Route')}
          message={t(
            'tripPlanner.socChart.empty',
            'Plan a trip to see the SOC curve',
          )}
        />
      </ChartContainer>
    );
  }

  const distances = chartData.map(p => p.distance);
  const minDist = Math.min(...distances);
  const maxDist = Math.max(...distances);
  const span = maxDist - minDist || 1;
  const minArrivalPct = clampPercent(minArrivalSOC);
  const xTicks = pickXTicks(chartData);

  return (
    <ChartContainer
      title={t('tripPlanner.socChart.title', 'Battery Along Route')}
      ariaLabel={t(
        'tripPlanner.socChart.aria',
        'Planned route battery state-of-charge area chart',
      )}
      data={chartData.map(p => ({
        distance: p.distance,
        soc: p.soc,
      }))}
      dataColumns={[
        {key: 'distance', label: t('tripPlanner.socChart.col.distance', 'Distance')},
        {key: 'soc', label: t('tripPlanner.socChart.col.soc', 'SOC %')},
      ]}
      height={PLOT_HEIGHT}>
      <View style={styles.chartBody}>
        <View style={styles.chartFrame}>
          <View style={styles.yAxis}>
            {SOC_AXIS_TICKS.map(tick => (
              <AppText
                key={`y-${tick}`}
                numberOfLines={1}
                style={styles.axisLabel}
                variant="caption">
                {tick}
              </AppText>
            ))}
          </View>

          <View style={styles.plotCol}>
            <AppText style={styles.yTitle} tone="muted" variant="caption">
              SOC %
            </AppText>
            <View
              accessible
              accessibilityLabel={t(
                'tripPlanner.socChart.aria',
                'Planned route battery state-of-charge area chart',
              )}
              accessibilityRole="image"
              style={styles.plot}>
              {SOC_GRID_LINES.map(line => (
                <View
                  key={`grid-${line}`}
                  pointerEvents="none"
                  style={[styles.gridLine, {bottom: `${line}%`}]}
                />
              ))}

              <View pointerEvents="none" style={styles.columns}>
                {chartData.map((point, index) => {
                  const band = socBandColor(point.soc);
                  return (
                    <View key={`col-${index}`} style={styles.column}>
                      <View
                        style={[
                          styles.columnFill,
                          {
                            backgroundColor: withAlpha(band, 0.28),
                            borderTopColor: band,
                            height: `${clampPercent(point.soc)}%`,
                          },
                        ]}
                      />
                    </View>
                  );
                })}
              </View>

              {/* Min arrival SOC reference line */}
              <View
                pointerEvents="none"
                style={[
                  styles.refLineH,
                  {bottom: `${minArrivalPct}%`, borderTopColor: MIN_ARRIVAL_COLOR},
                ]}
              />

              {/* Charge stop vertical lines */}
              {stopDistances.map((dist, i) => (
                <View
                  key={`stop-${i}`}
                  pointerEvents="none"
                  style={[
                    styles.refLineV,
                    {
                      borderLeftColor: CHARGE_STOP_COLOR,
                      left: `${xFractionPercent(dist, minDist, span)}%`,
                    },
                  ]}
                />
              ))}
            </View>

            <View style={styles.xAxis}>
              {xTicks.map((tick, index) => (
                <AppText
                  key={`x-${tick.distance}-${index}`}
                  numberOfLines={1}
                  style={styles.xAxisLabel}
                  variant="caption">
                  {tick.distance}
                </AppText>
              ))}
            </View>
            <AppText style={styles.xTitle} tone="muted" variant="caption">
              km
            </AppText>
          </View>
        </View>

        {/* Reference-line marker legend (preserves the web ReferenceLine labels). */}
        <View style={styles.markers}>
          <View style={styles.markerItem}>
            <View
              pointerEvents="none"
              style={[styles.markerDash, {borderTopColor: MIN_ARRIVAL_COLOR}]}
            />
            <AppText style={styles.markerText} variant="caption">
              {`Min ${minArrivalSOC}%`}
            </AppText>
          </View>
          {stopDistances.map((dist, i) => (
            <View key={`marker-stop-${i}`} style={styles.markerItem}>
              <View
                pointerEvents="none"
                style={[styles.markerDash, {borderTopColor: CHARGE_STOP_COLOR}]}
              />
              <AppText style={styles.markerText} variant="caption">
                {`\u26a1 Stop ${i + 1}`}
              </AppText>
            </View>
          ))}
        </View>
      </View>
    </ChartContainer>
  );
}

SOCRouteChart.displayName = 'SOCRouteChart';

const styles = StyleSheet.create({
  axisLabel: {
    color: colors.textMuted,
    textAlign: 'right',
  },
  chartBody: {
    gap: spacing.sm,
  },
  chartFrame: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: PLOT_HEIGHT,
    width: '100%',
  },
  column: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 1,
  },
  columnFill: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    borderTopWidth: 2,
    minHeight: 2,
    width: '100%',
  },
  columns: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 1,
    paddingHorizontal: spacing.xs,
  },
  gridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.7,
    position: 'absolute',
    right: 0,
  },
  markerDash: {
    borderStyle: 'dashed',
    borderTopWidth: 1,
    width: 18,
  },
  markerItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  markerText: {
    color: colors.textSecondary,
  },
  markers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  plot: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  plotCol: {
    flex: 1,
  },
  refLineH: {
    borderStyle: 'dashed',
    borderTopWidth: 1,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  refLineV: {
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    bottom: 0,
    position: 'absolute',
    top: 0,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    minHeight: 16,
  },
  xAxisLabel: {
    color: colors.textMuted,
    flex: 1,
    textAlign: 'center',
  },
  xTitle: {
    textAlign: 'right',
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 36,
    paddingTop: 18,
    width: 36,
  },
  yTitle: {
    marginBottom: spacing.xs,
  },
});
