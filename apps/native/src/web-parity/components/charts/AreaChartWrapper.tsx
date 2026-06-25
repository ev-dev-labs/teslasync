// Native parity port of web/src/components/charts/AreaChartWrapper.tsx.
// Replaces Recharts/DOM rendering with React Native chart layers and a
// non-interactive latest-value summary because hover tooltips are unavailable.

import React, {forwardRef, useMemo} from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

interface SeriesConfig {
  key: string;
  label: string;
  color: string;
}

interface AreaChartWrapperProps extends Omit<ViewProps, 'style'> {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesConfig[];
  height?: number;
  xFormatter?: (value: string) => string;
  yFormatter?: (value: number) => string;
  className?: string;
  style?: StyleProp<ViewStyle>;
  'data-testid'?: string;
}

interface NativeSeries extends SeriesConfig {
  nativeColor: string;
}

interface ChartValue {
  formatted: string;
  value: number | null;
}

interface ChartPoint {
  index: number;
  xLabel: string;
  values: Record<string, ChartValue>;
}

interface ChartDomain {
  max: number;
  min: number;
}

const DEFAULT_HEIGHT = 300;
const GRID_LINES = [0, 50, 100] as const;
const FALLBACK_PALETTE = [
  colors.accent,
  colors.violet,
  colors.success,
  colors.warning,
] as const;

export const AreaChartWrapper = forwardRef<View, AreaChartWrapperProps>(
  function AreaChartWrapper(
    {
      data,
      xKey,
      series,
      height = DEFAULT_HEIGHT,
      xFormatter,
      yFormatter,
      className: _className,
      style,
      testID,
      'data-testid': dataTestID,
      ...rest
    },
    ref,
  ) {
    const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);
    const safeSeries = useMemo(
      () => (Array.isArray(series) ? series : []),
      [series],
    );
    const nativeSeries = useMemo(
      () =>
        safeSeries.map((item, index) => ({
          ...item,
          nativeColor: resolveChartColor(item.color, index),
        })),
      [safeSeries],
    );
    const points = useMemo(
      () => buildChartPoints(safeData, xKey, nativeSeries, xFormatter, yFormatter),
      [nativeSeries, safeData, xFormatter, xKey, yFormatter],
    );
    const domain = useMemo(() => buildDomain(points, nativeSeries), [
      nativeSeries,
      points,
    ]);
    const xTicks = useMemo(() => pickXTicks(points), [points]);
    const yTicks = useMemo(
      () => [domain.max, (domain.max + domain.min) / 2, domain.min],
      [domain],
    );
    const latestPoint = points[points.length - 1];

    return (
      <View
        {...rest}
        ref={ref}
        style={[styles.root, style]}
        testID={testID ?? dataTestID}>
        <View
          accessible
          accessibilityLabel={buildAccessibilityLabel(points, nativeSeries)}
          accessibilityRole="image"
          style={[styles.chartFrame, {height}]}>
          <View style={styles.yAxis}>
            {yTicks.map((tick, index) => (
              <AppText
                key={`${tick}-${index}`}
                numberOfLines={1}
                style={styles.axisLabel}
                variant="caption">
                {formatY(tick, yFormatter)}
              </AppText>
            ))}
          </View>

          <View style={styles.chartContent}>
            <View style={styles.plotArea}>
              {GRID_LINES.map(line => (
                <View
                  key={`grid-${line}`}
                  pointerEvents="none"
                  style={[styles.gridLine, {top: `${line}%` as DimensionValue}]}
                />
              ))}

              {nativeSeries.map(item => (
                <View key={item.key} pointerEvents="none" style={styles.seriesLayer}>
                  {points.map(point => {
                    const pointValue = point.values[item.key]?.value;

                    return (
                      <View key={`${item.key}-${point.index}`} style={styles.column}>
                        {pointValue == null ? null : (
                          <View
                            style={[
                              styles.areaFill,
                              {
                                backgroundColor: withAlpha(item.nativeColor, 0.24),
                                borderTopColor: item.nativeColor,
                                height: heightForValue(pointValue, domain),
                              },
                            ]}>
                            <View
                              style={[
                                styles.pointDot,
                                {backgroundColor: item.nativeColor},
                              ]}
                            />
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>

            <View style={styles.xAxis}>
              {xTicks.map(tick => (
                <AppText
                  key={`${tick.index}-${tick.xLabel}`}
                  numberOfLines={1}
                  style={styles.xAxisLabel}
                  variant="caption">
                  {tick.xLabel || '-'}
                </AppText>
              ))}
            </View>
          </View>
        </View>

        <View
          accessible
          accessibilityLabel="Latest chart values"
          accessibilityRole="summary"
          style={styles.legend}>
          {nativeSeries.map(item => {
            const latestValue = latestPoint?.values[item.key];

            return (
              <View key={item.key} style={styles.legendItem}>
                <View
                  pointerEvents="none"
                  style={[styles.legendDot, {backgroundColor: item.nativeColor}]}
                />
                <AppText numberOfLines={1} style={styles.legendLabel} variant="caption">
                  {item.label}
                </AppText>
                <AppText
                  numberOfLines={1}
                  style={styles.legendValue}
                  variant="caption"
                  weight="semibold">
                  {latestValue?.formatted ?? '-'}
                </AppText>
              </View>
            );
          })}
        </View>
      </View>
    );
  },
);

AreaChartWrapper.displayName = 'AreaChartWrapper';

function buildChartPoints(
  data: Record<string, unknown>[],
  xKey: string,
  series: NativeSeries[],
  xFormatter: ((value: string) => string) | undefined,
  yFormatter: ((value: number) => string) | undefined,
): ChartPoint[] {
  return data.map((row, index) => {
    const values: Record<string, ChartValue> = {};

    series.forEach(item => {
      const value = toFiniteNumber(row[item.key]);
      values[item.key] = {
        formatted: value == null ? '-' : formatY(value, yFormatter),
        value,
      };
    });

    return {
      index,
      values,
      xLabel: formatX(row[xKey], xFormatter),
    };
  });
}

function buildDomain(points: ChartPoint[], series: NativeSeries[]): ChartDomain {
  let min = 0;
  let max = 0;
  let hasValue = false;

  points.forEach(point => {
    series.forEach(item => {
      const value = point.values[item.key]?.value;
      if (value == null) {
        return;
      }
      min = hasValue ? Math.min(min, value) : Math.min(0, value);
      max = hasValue ? Math.max(max, value) : Math.max(0, value);
      hasValue = true;
    });
  });

  if (!hasValue) {
    return {max: 1, min: 0};
  }
  if (min === max) {
    const padding = Math.max(Math.abs(max) * 0.1, 1);
    return {max: max + padding, min: min - padding};
  }
  return {max, min};
}

function pickXTicks(points: ChartPoint[]): ChartPoint[] {
  if (points.length <= 4) {
    return points;
  }

  const last = points.length - 1;
  const indices = [0, Math.round(last / 3), Math.round((last * 2) / 3), last];
  return Array.from(new Set(indices)).map(index => points[index]);
}

function heightForValue(value: number, domain: ChartDomain): DimensionValue {
  const span = domain.max - domain.min || 1;
  const percent = ((value - domain.min) / span) * 100;
  return `${Math.max(percent, 3)}%` as DimensionValue;
}

function toFiniteNumber(value: unknown): number | null {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatX(
  value: unknown,
  formatter: ((value: string) => string) | undefined,
): string {
  const raw = value == null ? '' : String(value);
  return formatter ? formatter(raw) : raw;
}

function formatY(
  value: number,
  formatter: ((value: number) => string) | undefined,
): string {
  return formatter ? formatter(value) : String(value);
}

function resolveChartColor(color: string, index: number): string {
  if (!color || color.includes('var(') || color === 'currentColor') {
    return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
  }
  return color;
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map(char => `${char}${char}`)
          .join('')
      : hex;

  if (/^[\da-f]{6}$/i.test(expanded)) {
    const r = parseInt(expanded.slice(0, 2), 16);
    const g = parseInt(expanded.slice(2, 4), 16);
    const b = parseInt(expanded.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return color;
}

function buildAccessibilityLabel(
  points: ChartPoint[],
  series: NativeSeries[],
): string {
  return `Area chart with ${points.length} points and ${series.length} series`;
}

const styles = StyleSheet.create({
  areaFill: {
    alignItems: 'center',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderTopWidth: 2,
    minHeight: 2,
    width: '100%',
  },
  axisLabel: {
    color: colors.textMuted,
    textAlign: 'right',
  },
  chartContent: {
    flex: 1,
    gap: spacing.xs,
  },
  chartFrame: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  column: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 2,
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
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
  },
  legendLabel: {
    color: colors.textSecondary,
    maxWidth: 112,
  },
  legendValue: {
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
  pointDot: {
    borderColor: colors.background,
    borderRadius: 3,
    borderWidth: 1,
    height: 6,
    marginTop: -4,
    width: 6,
  },
  root: {
    alignSelf: 'stretch',
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
  xAxis: {
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
    minHeight: 18,
  },
  xAxisLabel: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 22,
    width: 52,
  },
});
