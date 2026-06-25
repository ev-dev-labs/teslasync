import React, { useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import {
  ChartDataTable,
  type ChartDataTableRow,
} from '../charts/ChartDataTable';
import { SectionHeader } from '../data/SectionHeader';
import { EmptyState } from '../feedback/EmptyState';
import { AppText } from '../ui/AppText';
import { PremiumCard } from '../ui/PremiumCard';
import { StatusPill } from '../ui/StatusPill';

export interface RoutePoint {
  latitude: number;
  longitude: number;
  label?: string;
}

export interface RouteBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export interface ProjectedRoutePoint extends RoutePoint {
  x: number;
  y: number;
}

export interface RouteSegment {
  id: string;
  left: number;
  top: number;
  width: number;
  angleRad: number;
}

const maxRouteDots = 12;
const maxRouteSegmentPoints = 32;
const routeSegmentHeight = 3;
const mapGridLines = [20, 40, 60, 80];

interface MapRouteSummaryProps {
  title: string;
  subtitle?: string;
  startLabel: string;
  endLabel: string;
  distanceLabel: string;
  durationLabel: string;
  points: RoutePoint[];
  emptyLabel: string;
  parityStatusLabel?: string;
  parityDescription?: string;
  style?: StyleProp<ViewStyle>;
}

export function getRouteBounds(points: RoutePoint[]): RouteBounds | null {
  const validPoints = points.filter(
    point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
  );

  if (validPoints.length === 0) {
    return null;
  }

  return validPoints.reduce<RouteBounds>(
    (bounds, point) => ({
      minLatitude: Math.min(bounds.minLatitude, point.latitude),
      maxLatitude: Math.max(bounds.maxLatitude, point.latitude),
      minLongitude: Math.min(bounds.minLongitude, point.longitude),
      maxLongitude: Math.max(bounds.maxLongitude, point.longitude),
    }),
    {
      minLatitude: validPoints[0].latitude,
      maxLatitude: validPoints[0].latitude,
      minLongitude: validPoints[0].longitude,
      maxLongitude: validPoints[0].longitude,
    },
  );
}

export function sampleRoutePoints<T>(points: T[], maxPoints: number): T[] {
  if (maxPoints <= 0 || points.length === 0) {
    return [];
  }

  if (points.length <= maxPoints) {
    return points;
  }

  if (maxPoints === 1) {
    return [points[0]];
  }

  const lastIndex = points.length - 1;
  const interval = lastIndex / (maxPoints - 1);
  const sampledPoints: T[] = [];
  let previousIndex = -1;

  for (let index = 0; index < maxPoints; index += 1) {
    const nextIndex = index === maxPoints - 1 ? lastIndex : Math.round(index * interval);

    if (nextIndex !== previousIndex) {
      sampledPoints.push(points[nextIndex]);
      previousIndex = nextIndex;
    }
  }

  return sampledPoints;
}

export function projectRoutePoints(
  points: RoutePoint[],
  bounds: RouteBounds,
): ProjectedRoutePoint[] {
  return points
    .filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
    .map(point => ({
      ...point,
      x: normalizeCoordinate(point.longitude, bounds.minLongitude, bounds.maxLongitude),
      y: 1 - normalizeCoordinate(point.latitude, bounds.minLatitude, bounds.maxLatitude),
    }));
}

export function getRouteSegments(
  points: ProjectedRoutePoint[],
  width: number,
  height: number,
): RouteSegment[] {
  if (width <= 0 || height <= 0 || points.length < 2) {
    return [];
  }

  return points.slice(1).flatMap((point, index) => {
    const previous = points[index];
    const startX = previous.x * width;
    const startY = previous.y * height;
    const endX = point.x * width;
    const endY = point.y * height;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.hypot(deltaX, deltaY);

    if (length < 1) {
      return [];
    }

    return [
      {
        id: `${index}:${previous.latitude}:${previous.longitude}:${point.latitude}:${point.longitude}`,
        left: (startX + endX) / 2 - length / 2,
        top: (startY + endY) / 2 - routeSegmentHeight / 2,
        width: length,
        angleRad: Math.atan2(deltaY, deltaX),
      },
    ];
  });
}

export function MapRouteSummary({
  title,
  subtitle,
  startLabel,
  endLabel,
  distanceLabel,
  durationLabel,
  points,
  emptyLabel,
  parityStatusLabel,
  parityDescription = 'Route geometry is drawn with React Native views and exposed as a coordinate summary.',
  style,
}: MapRouteSummaryProps) {
  const validPoints = useMemo(
    () =>
      points.filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)),
    [points],
  );
  const bounds = useMemo(() => getRouteBounds(validPoints), [validPoints]);
  const routePath = useMemo(
    () => sampleRoutePoints(validPoints, maxRouteSegmentPoints),
    [validPoints],
  );
  const routeDots = useMemo(() => sampleRoutePoints(validPoints, maxRouteDots), [validPoints]);
  const routeTableRows = useMemo<ChartDataTableRow[]>(
    () =>
      sampleRoutePoints(validPoints, 6).map((point, index) => ({
        id: `${index}:${point.latitude}:${point.longitude}`,
        label: point.label ?? `Point ${index + 1}`,
        value: `${formatCoordinate(point.latitude)}, ${formatCoordinate(
          point.longitude,
        )}`,
      })),
    [validPoints],
  );
  const projectedPath = useMemo(
    () => (bounds ? projectRoutePoints(routePath, bounds) : []),
    [bounds, routePath],
  );
  const projectedDots = useMemo(
    () => (bounds ? projectRoutePoints(routeDots, bounds) : []),
    [bounds, routeDots],
  );
  const [canvasSize, setCanvasSize] = useState({width: 0, height: 0});
  const routeSegments = useMemo(
    () => getRouteSegments(projectedPath, canvasSize.width, canvasSize.height),
    [canvasSize.height, canvasSize.width, projectedPath],
  );
  const hasRouteGeometry = validPoints.length >= 2 && bounds != null;
  const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;

    setCanvasSize(previous =>
      previous.width === width && previous.height === height ? previous : {width, height},
    );
  }, []);

  return (
    <PremiumCard style={style} testID="map-route-summary">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        eyebrow="Universal route primitive"
        icon="mapPinned"
        trailing={
          <StatusPill
            label={
              hasRouteGeometry
                ? parityStatusLabel ?? 'Route summary ready'
                : 'Route summary unavailable'
            }
            state={hasRouteGeometry ? 'online' : 'warning'}
          />
        }
      />
      <View style={styles.parityBanner}>
        <AppText variant="caption" tone="accent" weight="semibold">
          Native parity status
        </AppText>
        <AppText variant="caption" tone="secondary">
          {parityDescription}
        </AppText>
      </View>

      {!hasRouteGeometry ? (
        <EmptyState title="No route geometry" message={emptyLabel} />
      ) : (
        <>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${title} route summary from ${startLabel} to ${endLabel} with ${validPoints.length} coordinate points`}
            style={styles.routeCanvas}>
            <View style={styles.routeBackdrop} />
            <View pointerEvents="none" style={styles.routeTileNorth} />
            <View pointerEvents="none" style={styles.routeTileSouth} />
            <View pointerEvents="none" style={styles.mapGridLayer}>
              {mapGridLines.map(line => (
                <React.Fragment key={line}>
                  <View
                    style={[
                      styles.mapGridLineVertical,
                      {left: `${line}%` as DimensionValue},
                    ]}
                  />
                  <View
                    style={[
                      styles.mapGridLineHorizontal,
                      {top: `${line}%` as DimensionValue},
                    ]}
                  />
                </React.Fragment>
              ))}
            </View>
            <View pointerEvents="none" style={styles.mapBadge}>
              <AppText variant="caption" tone="accent" weight="semibold" style={styles.uppercase}>
                Native map
              </AppText>
            </View>
            <View pointerEvents="none" style={styles.compass}>
              <AppText variant="caption" tone="accent" weight="bold">
                N
              </AppText>
            </View>
            <View onLayout={handleCanvasLayout} pointerEvents="none" style={styles.routePlot}>
              {routeSegments.map(segment => (
                <View
                  key={segment.id}
                  style={[
                    styles.routeSegment,
                    {
                      left: segment.left,
                      top: segment.top,
                      width: segment.width,
                      transform: [{rotate: `${segment.angleRad}rad`}],
                    },
                  ]}
                />
              ))}
              <View style={styles.routeDotsLayer}>
                {projectedDots.map((point, index) => (
                  <View
                    key={`${point.latitude}:${point.longitude}:${index}`}
                    style={[
                      styles.routeMarker,
                      {
                        left: `${point.x * 100}%` as DimensionValue,
                        top: `${point.y * 100}%` as DimensionValue,
                      },
                    ]}>
                    <View
                      style={[
                        styles.routeDot,
                        index === 0 && styles.startDot,
                        index === projectedDots.length - 1 && styles.endDot,
                      ]}
                    />
                    {index === 0 || index === projectedDots.length - 1 ? (
                      <AppText
                        variant="caption"
                        tone="primary"
                        weight="bold"
                        style={styles.pinLabel}>
                        {index === 0 ? 'START' : 'END'}
                      </AppText>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.endpointRow}>
            <Endpoint label="Start" value={startLabel} />
            <Endpoint label="End" value={endLabel} align="right" />
          </View>

          <View style={styles.metricRow}>
            <Metric label="Distance" value={distanceLabel} />
            <Metric label="Duration" value={durationLabel} />
            <Metric
              label="Coordinate span"
              value={`${formatCoordinate(bounds.maxLatitude - bounds.minLatitude)} lat / ${formatCoordinate(
                bounds.maxLongitude - bounds.minLongitude,
              )} lng`}
            />
          </View>
          <ChartDataTable
            label={`${title} route coordinate data`}
            rows={routeTableRows}
          />
        </>
      )}
    </PremiumCard>
  );
}

interface EndpointProps {
  label: string;
  value: string;
  align?: 'left' | 'right';
}

function Endpoint({label, value, align = 'left'}: EndpointProps) {
  return (
    <View style={[styles.endpoint, align === 'right' && styles.endpointRight]}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText weight="semibold">{value}</AppText>
    </View>
  );
}

interface MetricProps {
  label: string;
  value: string;
}

function Metric({label, value}: MetricProps) {
  return (
    <View style={styles.metric}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText weight="semibold">{value}</AppText>
    </View>
  );
}

function formatCoordinate(value: number): string {
  return value.toFixed(4);
}

function normalizeCoordinate(value: number, min: number, max: number): number {
  const span = max - min;

  if (!Number.isFinite(span) || Math.abs(span) < Number.EPSILON) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, (value - min) / span));
}

const styles = StyleSheet.create({
  routeCanvas: {
    minHeight: 156,
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  routeBackdrop: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    left: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surfaceSelected,
  },
  routeTileNorth: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    left: spacing.md,
    height: 56,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: 'rgba(53, 213, 255, 0.08)',
  },
  routeTileSouth: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    left: spacing.md,
    height: 64,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
  },
  mapGridLayer: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    left: spacing.md,
    borderRadius: 18,
    overflow: 'hidden',
  },
  mapGridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.border,
  },
  mapGridLineHorizontal: {
    position: 'absolute',
    right: 0,
    left: 0,
    height: 1,
    backgroundColor: colors.border,
  },
  mapBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderAccent,
    borderBottomRightRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  compass: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderAccent,
    borderBottomLeftRadius: 14,
    backgroundColor: colors.surface,
  },
  routeSegment: {
    position: 'absolute',
    height: routeSegmentHeight,
    borderRadius: 999,
    backgroundColor: colors.borderAccent,
  },
  routePlot: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xl,
    left: spacing.xl,
  },
  routeDotsLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  routeMarker: {
    position: 'absolute',
    width: 58,
    alignItems: 'center',
    gap: 2,
    marginLeft: -29,
    marginTop: -16,
  },
  routeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.background,
  },
  startDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.success,
  },
  endDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
  },
  pinLabel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.surface,
    fontSize: 9,
    lineHeight: 13,
  },
  endpointRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  endpoint: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  endpointRight: {
    alignItems: 'flex-end',
  },
  parityBanner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  uppercase: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  metricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metric: {
    minWidth: 132,
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
});
