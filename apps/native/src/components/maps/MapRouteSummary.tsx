import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

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
  const visibleDots = validPoints.slice(0, 10);

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
            accessibilityLabel={`${title} route summary from ${startLabel} to ${endLabel}`}
            style={styles.routeCanvas}>
            <View style={styles.routeLine} />
            <View style={styles.routeDots}>
              {visibleDots.map((point, index) => (
                <View
                  key={`${point.latitude}:${point.longitude}:${index}`}
                  style={[
                    styles.routeDot,
                    index === 0 && styles.startDot,
                    index === visibleDots.length - 1 && styles.endDot,
                  ]}
                />
              ))}
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
              label="Bounds"
              value={`${formatCoordinate(bounds.minLatitude)}, ${formatCoordinate(bounds.minLongitude)}`}
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

const styles = StyleSheet.create({
  routeCanvas: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  routeLine: {
    position: 'absolute',
    right: spacing.lg,
    left: spacing.lg,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.borderAccent,
  },
  routeDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
