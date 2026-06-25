// Native parity port of web/src/components/charts/ElevationProfile.tsx.
// Replaces Recharts area/tooltip/reference-line primitives with React Native
// chart layers while preserving the elevation gain/loss and tap-to-index API.

import React, {useCallback, useMemo} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {EmptyState} from '../../../components/feedback/EmptyState';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {ChartContainer} from './ChartContainer';
import {fmt} from './chartUtils';

export interface ElevationDataPoint {
  index: number;
  distance: number;
  elevation: number;
  speed?: number;
}

interface ElevationProfileProps {
  data: ElevationDataPoint[];
  currentIndex?: number;
  onClickIndex?: (index: number) => void;
  height?: number;
  distanceUnit?: string;
  className?: string;
}

interface ElevationDomain {
  distanceMax: number;
  distanceMin: number;
  elevationMax: number;
  elevationMin: number;
}

type NativeTFunction = (key: string, fallback: string) => string;

const ELEVATION_COLOR = '#10b981';
const CURSOR_COLOR = '#00b4d8';
const GRID_LINES = [0, 50, 100] as const;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export function ElevationProfile({
  data,
  currentIndex,
  onClickIndex,
  height = 200,
  distanceUnit = 'km',
  className,
}: ElevationProfileProps) {
  const t = useNativeTranslationFallback();
  const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const elevGain = useMemo(() => {
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < safeData.length; i++) {
      const diff = safeData[i].elevation - safeData[i - 1].elevation;
      if (diff > 0) {
        gain += diff;
      } else {
        loss += Math.abs(diff);
      }
    }
    return {gain: Math.round(gain), loss: Math.round(loss)};
  }, [safeData]);

  const cursorDistance = useMemo(() => {
    if (currentIndex == null || !safeData[currentIndex]) {
      return undefined;
    }
    return safeData[currentIndex].distance;
  }, [currentIndex, safeData]);

  const domain = useMemo(() => buildDomain(safeData), [safeData]);
  const yTicks = useMemo(
    () => [
      domain.elevationMax,
      (domain.elevationMax + domain.elevationMin) / 2,
      domain.elevationMin,
    ],
    [domain],
  );
  const xTicks = useMemo(() => pickDistanceTicks(safeData), [safeData]);
  const activePoint =
    currentIndex != null && safeData[currentIndex]
      ? safeData[currentIndex]
      : safeData[safeData.length - 1];

  const handleClick = useCallback(
    (point: ElevationDataPoint) => {
      if (!onClickIndex) {
        return;
      }
      onClickIndex(point.index);
    },
    [onClickIndex],
  );

  if (safeData.length === 0) {
    return (
      <ChartContainer
        ariaLabel={t(
          'replay.elevation.aria',
          'Elevation profile chart - no data available yet',
        )}
        className={className}
        height={height}
        title={t('replay.elevation.title', 'Elevation Profile')}>
        <EmptyState
          message={t(
            'replay.elevation.noData',
            'No elevation data available',
          )}
          title={t('replay.elevation.title', 'Elevation Profile')}
        />
      </ChartContainer>
    );
  }

  return (
    <ChartContainer
      ariaLabel={t(
        'replay.elevation.aria',
        'Elevation profile chart along the route, with total gain and loss in meters',
      )}
      className={className}
      height={height}
      subtitle={`↑ ${elevGain.gain}m  ↓ ${elevGain.loss}m`}
      title={t('replay.elevation.title', 'Elevation Profile')}>
      <View style={styles.root}>
        <View style={styles.chartFrame}>
          <View style={styles.yAxis}>
            {yTicks.map((tick, index) => (
              <AppText
                key={`${tick}-${index}`}
                numberOfLines={1}
                style={styles.axisLabel}
                variant="caption">
                {fmt(tick, 0)}
              </AppText>
            ))}
            <AppText numberOfLines={1} style={styles.axisUnit} variant="caption">
              m
            </AppText>
          </View>

          <View style={styles.plotColumn}>
            <View
              accessible
              accessibilityLabel={t(
                'replay.elevation.aria',
                'Elevation profile chart along the route, with total gain and loss in meters',
              )}
              accessibilityRole="image"
              style={styles.plotArea}>
              {GRID_LINES.map(line => (
                <View
                  key={`grid-${line}`}
                  pointerEvents="none"
                  style={[
                    styles.gridLine,
                    {top: `${line}%` as DimensionValue},
                  ]}
                />
              ))}

              <View style={styles.seriesLayer}>
                {safeData.map((point, arrayIndex) => {
                  const selected = arrayIndex === currentIndex;
                  return (
                    <Pressable
                      key={`${point.index}-${arrayIndex}`}
                      accessibilityLabel={`${t(
                        'replay.elevation.label',
                        'Elevation',
                      )}: ${fmt(point.elevation, 0)} m, ${fmt(
                        point.distance,
                        2,
                      )} ${distanceUnit}`}
                      accessibilityRole="button"
                      accessibilityState={{disabled: !onClickIndex, selected}}
                      disabled={!onClickIndex}
                      onPress={() => handleClick(point)}
                      style={({pressed}) => [
                        styles.sampleColumn,
                        pressed && styles.samplePressed,
                      ]}>
                      <View
                        pointerEvents="none"
                        style={[
                          styles.areaColumn,
                          {
                            height: heightForElevation(point.elevation, domain),
                          },
                          selected && styles.areaColumnSelected,
                        ]}>
                        <View
                          style={[
                            styles.pointDot,
                            selected && styles.pointDotSelected,
                          ]}
                        />
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {cursorDistance != null ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.referenceLine,
                    {
                      left: `${distancePercent(
                        cursorDistance,
                        domain,
                      )}%` as DimensionValue,
                    },
                  ]}
                />
              ) : null}
            </View>

            <View style={styles.xAxis}>
              {xTicks.map(tick => (
                <AppText
                  key={`${tick.index}-${tick.distance}`}
                  numberOfLines={1}
                  style={styles.xAxisLabel}
                  variant="caption">
                  {fmt(tick.distance, 1)}
                </AppText>
              ))}
            </View>
            <AppText numberOfLines={1} style={styles.xAxisUnit} variant="caption">
              {distanceUnit}
            </AppText>
          </View>
        </View>

        <View
          accessibilityLabel={t('replay.elevation.label', 'Elevation')}
          accessibilityRole="summary"
          style={styles.tooltipSummary}>
          <MetricPill
            label={distanceUnit}
            value={`${fmt(activePoint.distance, 2)} ${distanceUnit}`}
          />
          <MetricPill
            label={t('replay.elevation.label', 'Elevation')}
            value={`${fmt(activePoint.elevation, 0)} m`}
          />
        </View>
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

function buildDomain(data: ElevationDataPoint[]): ElevationDomain {
  let elevationMin = data[0]?.elevation ?? 0;
  let elevationMax = data[0]?.elevation ?? 1;
  let distanceMin = data[0]?.distance ?? 0;
  let distanceMax = data[0]?.distance ?? 1;

  data.forEach(point => {
    elevationMin = Math.min(elevationMin, point.elevation);
    elevationMax = Math.max(elevationMax, point.elevation);
    distanceMin = Math.min(distanceMin, point.distance);
    distanceMax = Math.max(distanceMax, point.distance);
  });

  if (elevationMin === elevationMax) {
    const padding = Math.max(Math.abs(elevationMax) * 0.05, 1);
    elevationMin -= padding;
    elevationMax += padding;
  }
  if (distanceMin === distanceMax) {
    distanceMax = distanceMin + 1;
  }

  return {distanceMax, distanceMin, elevationMax, elevationMin};
}

function pickDistanceTicks(data: ElevationDataPoint[]): ElevationDataPoint[] {
  if (data.length <= 3) {
    return data;
  }

  const last = data.length - 1;
  return [data[0], data[Math.round(last / 2)], data[last]];
}

function heightForElevation(
  elevation: number,
  domain: ElevationDomain,
): DimensionValue {
  const span = domain.elevationMax - domain.elevationMin || 1;
  const percent = ((elevation - domain.elevationMin) / span) * 100;
  return `${Math.max(percent, 3)}%` as DimensionValue;
}

function distancePercent(distance: number, domain: ElevationDomain): number {
  const span = domain.distanceMax - domain.distanceMin || 1;
  const percent = ((distance - domain.distanceMin) / span) * 100;
  return Math.min(Math.max(percent, 0), 100);
}

const styles = StyleSheet.create({
  areaColumn: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.24)',
    borderTopColor: ELEVATION_COLOR,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderTopWidth: 2,
    minHeight: 3,
    width: '100%',
  },
  areaColumnSelected: {
    backgroundColor: 'rgba(0, 180, 216, 0.26)',
    borderTopColor: CURSOR_COLOR,
  },
  axisLabel: {
    color: colors.textMuted,
    textAlign: 'right',
  },
  axisUnit: {
    color: colors.textMuted,
    textAlign: 'right',
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
  pointDot: {
    backgroundColor: ELEVATION_COLOR,
    borderColor: colors.background,
    borderRadius: 3,
    borderWidth: 1,
    height: 6,
    marginTop: -4,
    width: 6,
  },
  pointDotSelected: {
    backgroundColor: CURSOR_COLOR,
  },
  referenceLine: {
    backgroundColor: CURSOR_COLOR,
    bottom: 0,
    opacity: 0.92,
    position: 'absolute',
    top: 0,
    width: 2,
  },
  root: {
    flex: 1,
    gap: spacing.sm,
    width: '100%',
  },
  sampleColumn: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 2,
  },
  samplePressed: {
    opacity: 0.76,
  },
  seriesLayer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    gap: 1,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  tooltipSummary: {
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
  xAxisUnit: {
    color: colors.textMuted,
    textAlign: 'right',
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 38,
    width: 52,
  },
});
