// Native parity port of web/src/features/system/components/FSMTimelineChart.tsx.
//
// The web component buckets a list of FSM transitions into fixed time windows
// (<=6h -> 10min, <=24h -> 30min, else 2h) and renders them as a Recharts
// STACKED AreaChart (one stacked series per FSM name, coloured from
// CHART_COLORS) inside the shared <ChartContainer>, falling back to
// <EmptyState> when there is no data.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - The bucketing useMemo (bucketMs thresholds, zero-filled bucket map, fill,
//     sort, "HH:MM" label) is ported VERBATIM -- same numbers, same logic, same
//     `buckets`/`fsmTypes` outputs and the `[transitions, hours]` dependency.
//   - `@/components/charts` ChartContainer -> the already-ported native
//     ChartContainer (title + ariaLabel + height). CHART_COLORS -> the native
//     parity colour ramp (the same Okabe-Ito values the web hook resolves to);
//     the per-series colour stays `CHART_COLORS[i % CHART_COLORS.length]`.
//   - Recharts AreaChart/Area/XAxis/YAxis/CartesianGrid/Tooltip/
//     ResponsiveContainer + chartGrid/axisTick are DOM/SVG-only and the native
//     recharts barrel only renders an "unavailable" placeholder, so the stacked
//     area is reproduced with React Native <View> primitives: a bordered plot
//     box with 0/50/100% grid lines and one flex column per time bucket whose
//     per-FSM segments stack from the bottom (column-reverse, first FSM at the
//     bottom like Recharts stackId="1"), each segment filled at 30% alpha (web
//     fillOpacity={0.3}) with a full-colour top edge (web stroke). A compact
//     y-axis (max / mid / 0 integer ticks, web allowDecimals={false}) and a
//     space-between x-axis of up to four evenly-spaced bucket times stand in for
//     the Recharts axes. The hover <Tooltip> has no touch analog, so a colour
//     legend (FSM name -> colour) carries the series identity instead. Per the
//     web `chart-a11y:no-table` note the per-row detail lives in the separate
//     transition list view, so no fallback data table is added here.
//   - `@/components/feedback` EmptyState -> the native EmptyState (title +
//     message); the web only passes a message, so the chart title is reused as
//     the required native title and the message stays `emptyMessage ?? t(...)`.
//   - `@/types/fsm` FSMTransition -> the native FSMTransition from the ported
//     useFSM hook (identical shape).
//   - react-i18next useTranslation -> a local fallback shim returning the
//     English copy verbatim while preserving every i18n key.

import React, {useMemo} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import type {FSMTransition} from '../../../api/hooks/useFSM';
import {CHART_COLORS, ChartContainer} from '../../../components/charts';

interface FSMTimelineChartProps {
  transitions: FSMTransition[];
  hours: number;
  emptyMessage?: string;
}

interface TimelineBucket {
  time: string;
  [fsmType: string]: string | number;
}

// react-i18next is unavailable in native parity; this shim returns the English
// fallback copy verbatim while preserving the i18n keys.
function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

const CHART_HEIGHT = 260;
const PLOT_HEIGHT = 160;
const GRID_LINES = [0, 50, 100] as const;
const X_LABEL_COUNT = 4;
const SEGMENT_STROKE_WIDTH = 1.5;
const SEGMENT_FILL_ALPHA = 0.3;

export function FSMTimelineChart({
  transitions,
  hours,
  emptyMessage,
}: FSMTimelineChartProps) {
  const t = useNativeTranslation();

  const {buckets, fsmTypes} = useMemo(() => {
    if (transitions.length === 0) {
      return {buckets: [] as TimelineBucket[], fsmTypes: [] as string[]};
    }

    // Determine bucket size: <=6h -> 10min, <=24h -> 30min, else 2h
    const bucketMs =
      hours <= 6 ? 10 * 60_000 : hours <= 24 ? 30 * 60_000 : 2 * 60 * 60_000;

    const now = Date.now();
    const start = now - hours * 60 * 60_000;

    // Collect FSM names
    const typeSet = new Set<string>();
    for (const tr of transitions) {
      typeSet.add(tr.fsm_name);
    }
    const types = Array.from(typeSet).sort();

    // Create buckets
    const bucketMap = new Map<number, Record<string, number>>();
    for (let ts = start; ts <= now; ts += bucketMs) {
      const key = Math.floor(ts / bucketMs) * bucketMs;
      const record: Record<string, number> = {};
      for (const type of types) {
        record[type] = 0;
      }
      bucketMap.set(key, record);
    }

    // Fill buckets
    for (const tr of transitions) {
      const ts = new Date(tr.ts).getTime();
      const key = Math.floor(ts / bucketMs) * bucketMs;
      const bucket = bucketMap.get(key);
      if (bucket) {
        bucket[tr.fsm_name] = (bucket[tr.fsm_name] ?? 0) + 1;
      }
    }

    // Convert to array
    const result: TimelineBucket[] = Array.from(bucketMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, counts]) => {
        const d = new Date(ts);
        const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(
          d.getMinutes(),
        ).padStart(2, '0')}`;
        return {time: timeStr, ...counts};
      });

    return {buckets: result, fsmTypes: types};
  }, [transitions, hours]);

  const maxTotal = useMemo(() => {
    let max = 0;
    for (const bucket of buckets) {
      let sum = 0;
      for (const type of fsmTypes) {
        sum += toCount(bucket[type]);
      }
      if (sum > max) {
        max = sum;
      }
    }
    return max;
  }, [buckets, fsmTypes]);

  const xLabels = useMemo(() => pickXLabels(buckets), [buckets]);
  const denom = maxTotal > 0 ? maxTotal : 1;
  const yTicks = [maxTotal, Math.round(maxTotal / 2), 0];

  return (
    <ChartContainer
      ariaLabel={t(
        'fsm.timelineChart.aria',
        'FSM transitions over time stacked area chart',
      )}
      height={CHART_HEIGHT}
      title={t('fsm.timelineChart', 'Transitions Over Time')}>
      {buckets.length > 0 ? (
        <View style={styles.root}>
          {/* Legend replaces the unavailable Recharts hover tooltip. */}
          <View style={styles.legend}>
            {fsmTypes.map((type, i) => (
              <View key={type} style={styles.legendItem}>
                <View
                  pointerEvents="none"
                  style={[
                    styles.legendDot,
                    {backgroundColor: CHART_COLORS[i % CHART_COLORS.length]},
                  ]}
                />
                <AppText
                  numberOfLines={1}
                  style={styles.legendLabel}
                  variant="caption">
                  {type}
                </AppText>
              </View>
            ))}
          </View>

          <View
            accessibilityLabel={buildChartLabel(buckets.length, fsmTypes.length)}
            accessibilityRole="image"
            accessible
            style={styles.chartFrame}>
            <View style={styles.yAxis}>
              {yTicks.map((tick, index) => (
                <AppText
                  key={`${tick}-${index}`}
                  numberOfLines={1}
                  style={styles.axisLabel}
                  tone="muted"
                  variant="caption">
                  {String(tick)}
                </AppText>
              ))}
            </View>

            <View style={styles.plotArea}>
              {GRID_LINES.map(line => (
                <View
                  key={`grid-${line}`}
                  pointerEvents="none"
                  style={[styles.gridLine, {top: `${line}%` as DimensionValue}]}
                />
              ))}

              <View pointerEvents="none" style={styles.columns}>
                {buckets.map((bucket, i) => (
                  <View key={`${bucket.time}-${i}`} style={styles.column}>
                    {/* column-reverse stacks the first FSM at the bottom, like
                        the Recharts stackId="1" series order. */}
                    <View style={styles.stack}>
                      {fsmTypes.map((type, ti) => {
                        const count = toCount(bucket[type]);
                        if (count <= 0) {
                          return null;
                        }
                        const color = CHART_COLORS[ti % CHART_COLORS.length];
                        return (
                          <View
                            key={type}
                            style={[
                              styles.segment,
                              {
                                backgroundColor: withAlpha(
                                  color,
                                  SEGMENT_FILL_ALPHA,
                                ),
                                borderTopColor: color,
                                height: `${(count / denom) *
                                  100}%` as DimensionValue,
                              },
                            ]}
                          />
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.xAxis}>
            {xLabels.map(label => (
              <AppText
                key={`${label.index}-${label.time}`}
                numberOfLines={1}
                style={styles.xAxisLabel}
                tone="muted"
                variant="caption">
                {label.time}
              </AppText>
            ))}
          </View>
        </View>
      ) : (
        <EmptyState
          message={
            emptyMessage ??
            t('fsm.noTimelineData', 'No transition data for timeline')
          }
          title={t('fsm.timelineChart', 'Transitions Over Time')}
        />
      )}
    </ChartContainer>
  );
}

function toCount(value: string | number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function pickXLabels(buckets: TimelineBucket[]): {index: number; time: string}[] {
  if (buckets.length === 0) {
    return [];
  }
  if (buckets.length <= X_LABEL_COUNT) {
    return buckets.map((bucket, index) => ({index, time: bucket.time}));
  }
  const last = buckets.length - 1;
  const indices = [0, Math.round(last / 3), Math.round((last * 2) / 3), last];
  return Array.from(new Set(indices)).map(index => ({
    index,
    time: buckets[index].time,
  }));
}

function buildChartLabel(bucketCount: number, seriesCount: number): string {
  return `Stacked transition timeline with ${bucketCount} time buckets and ${seriesCount} state machines`;
}

// Mirrors the web fillOpacity={0.3}: tints a hex chart colour to an rgba fill.
function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map(char => `${char}${char}`)
          .join('')
      : raw;
  if (/^[\da-f]{6}$/i.test(expanded)) {
    const r = parseInt(expanded.slice(0, 2), 16);
    const g = parseInt(expanded.slice(2, 4), 16);
    const b = parseInt(expanded.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

const styles = StyleSheet.create({
  axisLabel: {
    textAlign: 'right',
  },
  chartFrame: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: PLOT_HEIGHT,
  },
  column: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 1,
  },
  columns: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    gap: 1,
    paddingHorizontal: spacing.xs,
  },
  gridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.72,
    position: 'absolute',
    right: 0,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendLabel: {
    color: colors.textSecondary,
    maxWidth: 140,
  },
  plotArea: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  root: {
    gap: spacing.sm,
  },
  segment: {
    borderTopWidth: SEGMENT_STROKE_WIDTH,
    minHeight: 1,
    width: '100%',
  },
  stack: {
    flexDirection: 'column-reverse',
    height: '100%',
    justifyContent: 'flex-start',
    width: '100%',
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  xAxisLabel: {
    flex: 1,
    textAlign: 'center',
  },
  yAxis: {
    height: PLOT_HEIGHT,
    justifyContent: 'space-between',
    width: 32,
  },
});
