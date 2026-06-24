import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type {
  BatteryDegradationAnalytics,
  BatteryHealth,
  EnergyStats,
  Vehicle,
} from '../../api/types';
import {
  ChartSummary,
  type ChartSummaryDatum,
} from '../../components/charts/ChartSummary';
import { KeyValueRow } from '../../components/data/KeyValueRow';
import { ListRow } from '../../components/data/ListRow';
import {
  MetricGrid,
  type MetricGridItem,
} from '../../components/data/MetricGrid';
import { ScreenSection } from '../../components/data/ScreenSection';
import { spacing } from '../../theme/tokens';
import {
  formatDistanceKm,
  formatDistanceM,
  formatEfficiencyWhKm,
  formatPercent,
} from './formatOperationsValue';
import { OperationsMessage } from './OperationsMessage';

interface RangeProjectionSectionProps {
  vehicle: Vehicle | null;
  battery: BatteryHealth | undefined;
  degradation: BatteryDegradationAnalytics | undefined;
  energy: EnergyStats | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function currentRangeKm(
  battery: BatteryHealth | undefined,
  degradation: BatteryDegradationAnalytics | undefined,
): number | undefined {
  return degradation?.current_range ?? battery?.estimated_range_current_km;
}

function newRangeKm(battery: BatteryHealth | undefined): number | undefined {
  return battery?.estimated_range_new_km;
}

export function RangeProjectionSection({
  vehicle,
  battery,
  degradation,
  energy,
  isLoading,
  hasError,
}: RangeProjectionSectionProps) {
  const currentRange = currentRangeKm(battery, degradation);
  const originalRange = newRangeKm(battery);
  const rangeGap =
    currentRange != null && originalRange != null
      ? Math.max(originalRange - currentRange, 0)
      : undefined;
  const projectionData = useMemo<ChartSummaryDatum[]>(() => {
    const projectionPoints =
      degradation?.prediction?.projection_points ?? degradation?.projections;
    if (projectionPoints && projectionPoints.length > 0) {
      return projectionPoints.slice(0, 8).map(point => ({
        id: point.month,
        label: point.month,
        value: point.health,
        formattedValue: formatPercent(point.health, 1),
        icon: 'range' as const,
      }));
    }

    const trendPoints = degradation?.monthly_trend;
    if (trendPoints && trendPoints.length > 0) {
      return trendPoints.slice(-8).map(point => ({
        id: point.month,
        label: point.month,
        value: point.avg_range,
        formattedValue: formatDistanceKm(point.avg_range),
        icon: 'range' as const,
      }));
    }

    return (battery?.monthly_trend ?? []).slice(-8).map(point => ({
      id: point.month,
      label: point.month,
      value: point.range_km,
      formattedValue: formatDistanceKm(point.range_km),
      icon: 'range' as const,
    }));
  }, [
    battery?.monthly_trend,
    degradation?.monthly_trend,
    degradation?.prediction?.projection_points,
    degradation?.projections,
  ]);
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'range-current',
        label: 'Current range',
        value: formatDistanceKm(currentRange),
        helper: 'Battery or degradation analytics',
        tone: 'success',
        icon: 'range',
      },
      {
        id: 'range-new',
        label: 'New range',
        value: formatDistanceKm(originalRange),
        helper: 'Estimated original range',
        tone: 'neutral',
        icon: 'target',
      },
      {
        id: 'range-gap',
        label: 'Range gap',
        value: formatDistanceKm(rangeGap),
        helper: 'New range minus current range',
        tone: rangeGap && rangeGap > 40 ? 'warning' : 'accent',
        icon: 'trendDown',
      },
      {
        id: 'range-efficiency',
        label: 'Efficiency',
        value: formatEfficiencyWhKm(
          energy?.avg_efficiency_wh_per_m == null
            ? undefined
            : energy.avg_efficiency_wh_per_m * 1000,
        ),
        helper: `Distance ${formatDistanceM(energy?.total_distance_m)}`,
        tone: 'neutral',
        icon: 'efficiency',
      },
    ],
    [
      currentRange,
      energy?.avg_efficiency_wh_per_m,
      energy?.total_distance_m,
      originalRange,
      rangeGap,
    ],
  );

  return (
    <ScreenSection
      title="Projected range analytics"
      subtitle="Projected-range and analytics/range route parity comes from battery health, degradation projections, and SI energy totals."
    >
      {!vehicle ? (
        <OperationsMessage
          title="Range analytics waiting for a vehicle"
          message="Projected range requires a selected vehicle before querying battery and energy endpoints."
          tone="empty"
          icon="range"
        />
      ) : isLoading && !battery && !degradation && !energy ? (
        <OperationsMessage
          title="Loading projected range"
          message="Fetching battery health, degradation analytics, and energy totals."
          tone="loading"
          icon="loading"
        />
      ) : hasError && !battery && !degradation && !energy ? (
        <OperationsMessage
          title="Projected range unavailable"
          message="Range analytics will render when battery or energy endpoints recover."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <MetricGrid items={metrics} />
          <ChartSummary
            title="Range projection summary"
            subtitle="Accessible native chart for returned projection, degradation, or battery range points."
            metricLabel="Current projected range"
            metricValue={formatDistanceKm(currentRange)}
            data={projectionData}
            emptyLabel="Range projection points will appear when battery or degradation analytics return trend data."
            icon="range"
            sourceLabel="Range chart uses backend battery/degradation analytics only"
            dataTableLabel="Range projection points"
          />
          <View style={styles.list}>
            <ListRow
              title="Projected range route"
              subtitle="Native projected-range uses current battery range, degradation, and projection fields without model-generated forecasts."
              meta="/projected-range"
              icon="range"
              detail={
                <View>
                  <KeyValueRow
                    label="Projected 80% date"
                    value={degradation?.projected_80pct_date ?? '-'}
                  />
                  <KeyValueRow
                    label="Capacity source"
                    value={degradation?.capacity_source ?? '-'}
                  />
                </View>
              }
            />
            <ListRow
              title="Analytics range route"
              subtitle="Range analytics remain tied to returned battery and energy fields rather than synthetic route planning."
              meta="/analytics/range"
              icon="analytics"
              detail={
                <View>
                  <KeyValueRow
                    label="Health"
                    value={formatPercent(
                      degradation?.current_health ?? battery?.health_score,
                      1,
                    )}
                  />
                  <KeyValueRow
                    label="Degradation"
                    value={formatPercent(
                      degradation?.current_degradation ??
                        battery?.degradation_pct,
                      1,
                    )}
                  />
                </View>
              }
            />
          </View>
        </View>
      )}
    </ScreenSection>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
});
