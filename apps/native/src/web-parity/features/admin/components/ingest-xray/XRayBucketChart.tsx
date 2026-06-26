// Native parity port of
// web/src/features/admin/components/ingest-xray/XRayBucketChart.tsx.
//
// The Ingest X-Ray bucketed sample-count chart: a bar chart of `count` per
// `bucket_start` time bucket. The web original renders a Recharts BarChart inside
// the shared <ChartContainer>, which supplies the title/subtitle/aria copy,
// loading + empty states, an accessible fallback data table, and CSV/PNG export
// affordances for free.
//
// React Native has no DOM/SVG Recharts backend, so the BarChart / Bar / XAxis /
// YAxis / CartesianGrid / Tooltip / ResponsiveContainer tree is reproduced with
// native View/AppText/Pressable layers (the same idiom as the converted
// ElevationProfile and AreaChartWrapper charts): a y-axis count scale, grid
// lines, one tappable bar per bucket sized to count/maxCount, x-axis time ticks,
// and a tap-to-select summary row that reproduces the hover Tooltip's
// formatTime(label) + fmtInt(count) "Samples" content. The shared native
// ChartContainer still owns the title/subtitle/aria/loading/empty/fallback-table/
// export behaviour, driven by the same `data` / `dataColumns` / `exportable` /
// `exportFilename` props as the web source.
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/charts -> the native web-parity charts barrel (ChartContainer
//     only); the Recharts primitives are reproduced as native layers, so nothing
//     DOM/SVG is imported.
//   - useDateFormat().formatTime (locale + timezone aware via user settings) -> a
//     native-safe Intl.DateTimeFormat hour:minute formatter preserving the
//     time-of-day intent for the X axis + tooltip label.
//   - lib/numberFormat.fmtInt -> an inlined locale integer formatter with the same
//     round-to-integer / nullish -> "0" semantics.
//   - @/types/admin-diagnostics IngestXRayBucketPoint -> inlined locally (the web
//     type module is not a separate native conversion target yet).
//   - react-i18next useTranslation -> a native key/English-default fallback `t`
//     preserving every admin.xray.chart.* key + default verbatim.
//   - Bar fill var(--accent-primary) -> the native accent token color.
//
// No DOM, Recharts, Leaflet, or old web UI components are imported.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {ChartContainer} from '../../../../components/charts';

// Mirrors web @/types/admin-diagnostics.IngestXRayBucketPoint.
interface IngestXRayBucketPoint {
  bucket_start: string;
  count: number;
}

interface XRayBucketChartProps {
  buckets: IngestXRayBucketPoint[];
  loading: boolean;
}

// One pre-derived bucket: a numeric epoch (`ts`) for cheap X-axis sorting +
// formatting, the original ISO string, and the sample count.
interface BucketDatum {
  ts: number;
  bucket_start: string;
  count: number;
}

type NativeTFunction = (key: string, fallback: string) => string;

const GRID_LINES = [0, 50, 100] as const;
const BAR_MIN_PERCENT = 4;

// react-i18next is not wired in native. i18next returns the supplied default when
// a translation is missing, so the fallback returns the English default and keeps
// every admin.xray.chart.* key verbatim in source.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// useDateFormat().formatTime is locale + timezone aware via user settings; the
// native parity port keeps the time-of-day intent with Intl.DateTimeFormat.
function formatTime(value: Date | number | string | null | undefined): string {
  if (value == null) {
    return '-';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

// Mirrors web lib/numberFormat.fmtInt: locale integer, rounds to 0 decimals,
// nullish / non-finite -> 0.
function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n.toLocaleString(undefined, {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

export function XRayBucketChart({buckets, loading}: XRayBucketChartProps) {
  const t = useNativeTranslationFallback();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Pre-derive a numeric epoch so the X axis can sort + format cheaply
  // without re-parsing the ISO string on every tick.
  const series = useMemo<BucketDatum[]>(
    () =>
      (buckets ?? []).map(b => ({
        ts: Date.parse(b.bucket_start),
        bucket_start: b.bucket_start,
        count: b.count,
      })),
    [buckets],
  );

  const isEmpty = !loading && series.length === 0;

  const maxCount = useMemo(
    () => series.reduce((max, b) => Math.max(max, b.count ?? 0), 0),
    [series],
  );
  const safeMax = maxCount > 0 ? maxCount : 1;

  // allowDecimals={false} on the web Y axis -> integer count ticks.
  const yTicks = useMemo(
    () => [safeMax, safeMax / 2, 0].map(value => Math.round(value)),
    [safeMax],
  );
  const xTicks = useMemo(() => pickTimeTicks(series), [series]);

  const selected =
    selectedIndex != null && series[selectedIndex]
      ? series[selectedIndex]
      : series[series.length - 1];

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const tableData = useMemo(
    () => series.map(s => ({bucket: s.bucket_start, count: s.count})),
    [series],
  );

  return (
    <ChartContainer
      title={t('admin.xray.chart.title', 'Samples per bucket')}
      subtitle={t(
        'admin.xray.chart.subtitle',
        'Time-series of ingested telemetry rows over the selected window.',
      )}
      ariaLabel={t(
        'admin.xray.chart.ariaLabel',
        'Bar chart of ingest sample counts per time bucket.',
      )}
      loading={loading}
      empty={isEmpty}
      height={260}
      data={tableData}
      dataColumns={[
        {key: 'bucket', label: t('admin.xray.chart.cols.bucket', 'Bucket')},
        {
          key: 'count',
          label: t('admin.xray.chart.cols.count', 'Samples'),
          format: value => (typeof value === 'number' ? fmtInt(value) : '—'),
        },
      ]}
      exportable
      exportFilename="ingest-xray-buckets">
      <View style={styles.root}>
        <View style={styles.chartFrame}>
          <View style={styles.yAxis}>
            {yTicks.map((tick, index) => (
              <AppText
                key={`${tick}-${index}`}
                numberOfLines={1}
                style={styles.axisLabel}
                variant="caption">
                {fmtInt(tick)}
              </AppText>
            ))}
          </View>

          <View style={styles.plotColumn}>
            <View
              accessible
              accessibilityLabel={t(
                'admin.xray.chart.ariaLabel',
                'Bar chart of ingest sample counts per time bucket.',
              )}
              accessibilityRole="image"
              style={styles.plotArea}>
              {GRID_LINES.map(line => (
                <View
                  key={`grid-${line}`}
                  pointerEvents="none"
                  style={[styles.gridLine, {top: `${line}%` as DimensionValue}]}
                />
              ))}

              <View style={styles.seriesLayer}>
                {series.map((point, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <Pressable
                      key={`${point.bucket_start}-${index}`}
                      accessibilityHint={t(
                        'admin.xray.chart.tooltip',
                        'Samples',
                      )}
                      accessibilityLabel={`${formatTime(
                        new Date(point.ts),
                      )}: ${fmtInt(point.count)} ${t(
                        'admin.xray.chart.tooltip',
                        'Samples',
                      )}`}
                      accessibilityRole="button"
                      accessibilityState={{selected: isSelected}}
                      onPress={() => handleSelect(index)}
                      style={({pressed}) => [
                        styles.barColumn,
                        pressed && styles.barPressed,
                      ]}>
                      <View
                        pointerEvents="none"
                        style={[
                          styles.bar,
                          {height: barHeight(point.count, safeMax)},
                          isSelected && styles.barSelected,
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.xAxis}>
              {xTicks.map((tick, index) => (
                <AppText
                  key={`${tick.bucket_start}-${index}`}
                  numberOfLines={1}
                  style={styles.xAxisLabel}
                  variant="caption">
                  {formatTime(new Date(tick.ts))}
                </AppText>
              ))}
            </View>
          </View>
        </View>

        {selected ? (
          <View
            accessibilityLabel={t('admin.xray.chart.tooltip', 'Samples')}
            accessibilityRole="summary"
            style={styles.summaryRow}>
            <MetricPill
              label={t('admin.xray.chart.cols.bucket', 'Bucket')}
              value={formatTime(new Date(selected.ts))}
            />
            <MetricPill
              label={t('admin.xray.chart.tooltip', 'Samples')}
              value={fmtInt(selected.count)}
            />
          </View>
        ) : null}
      </View>
    </ChartContainer>
  );
}

function MetricPill({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.metricPill}>
      <AppText numberOfLines={1} style={styles.metricLabel} variant="caption">
        {label}
      </AppText>
      <AppText
        numberOfLines={1}
        style={styles.metricValue}
        variant="caption"
        weight="semibold">
        {value}
      </AppText>
    </View>
  );
}

// Bar height as a percentage of the plot area, scaled to the count domain
// [0, maxCount]. Empty buckets collapse to a hairline.
function barHeight(count: number, max: number): DimensionValue {
  const value = typeof count === 'number' && Number.isFinite(count) ? count : 0;
  if (value <= 0) {
    return 0;
  }
  const percent = (value / max) * 100;
  return `${Math.max(percent, BAR_MIN_PERCENT)}%` as DimensionValue;
}

// Recharts auto-thins time-axis ticks; native shows first / middle / last so the
// labels never overlap on a phone-width window.
function pickTimeTicks(data: BucketDatum[]): BucketDatum[] {
  if (data.length <= 3) {
    return data;
  }
  const last = data.length - 1;
  return [data[0], data[Math.round(last / 2)], data[last]];
}

const styles = StyleSheet.create({
  axisLabel: {
    color: colors.textMuted,
    textAlign: 'right',
  },
  bar: {
    backgroundColor: colors.accent,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    minHeight: 2,
    width: '100%',
  },
  barColumn: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 2,
  },
  barPressed: {
    opacity: 0.76,
  },
  barSelected: {
    backgroundColor: colors.accentGlow,
    borderColor: colors.accent,
    borderWidth: 1,
  },
  chartFrame: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  gridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.74,
    position: 'absolute',
    right: 0,
  },
  metricLabel: {
    color: colors.textMuted,
  },
  metricPill: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
  },
  metricValue: {
    color: colors.textPrimary,
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
  plotColumn: {
    flex: 1,
    gap: spacing.xs,
  },
  root: {
    flex: 1,
    gap: spacing.sm,
    width: '100%',
  },
  seriesLayer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    gap: 1,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 18,
  },
  xAxisLabel: {
    color: colors.textMuted,
    flex: 1,
    textAlign: 'center',
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 22,
    width: 52,
  },
});
