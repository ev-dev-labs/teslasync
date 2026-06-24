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
import { SectionHeader } from '../data/SectionHeader';
import { EmptyState } from '../feedback/EmptyState';
import { AppText } from '../ui/AppText';
import { PremiumCard } from '../ui/PremiumCard';

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

interface MapRouteSummaryProps {
  title: string;
  subtitle?: string;
  startLabel: string;
  endLabel: string;
  distanceLabel: string;
  durationLabel: string;
  points: RoutePoint[];
  emptyLabel: string;
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
        eyebrow="Native route summary"
        icon="mapPinned"
      />

      {validPoints.length < 2 || bounds == null ? (
        <EmptyState title="No route geometry" message={emptyLabel} />
      ) : (
        <>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${title} route summary from ${startLabel} to ${endLabel} with ${validPoints.length} coordinate points`}
            style={styles.routeCanvas}>
            <View style={styles.routeBackdrop} />
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
                      styles.routeDot,
                      {
                        left: `${point.x * 100}%` as DimensionValue,
                        top: `${point.y * 100}%` as DimensionValue,
                      },
                      index === 0 && styles.startDot,
                      index === projectedDots.length - 1 && styles.endDot,
                    ]}
                  />
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
  routeDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.background,
    marginLeft: -6,
    marginTop: -6,
  },
  startDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.success,
    marginLeft: -9,
    marginTop: -9,
  },
  endDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    marginLeft: -9,
    marginTop: -9,
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
