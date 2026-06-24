import React, { useMemo } from 'react';
import { View } from 'react-native';

import type { Drive, FleetAnalytics } from '../../api/types';
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
import { EmptyState } from '../../components/feedback/EmptyState';
import { formatDistance, formatEnergy } from '../../lib/format';

interface R0004DashboardAnalyticsSectionProps {
  drives: Drive[];
  fleet: FleetAnalytics | undefined;
  hasError: boolean;
  isLoading: boolean;
}

function formatCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return new Intl.NumberFormat().format(value);
}

function formatDistanceKm(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return formatDistance(value * 1000);
}

function formatEnergyKwh(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return formatEnergy(value * 1000);
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return `USD ${value.toFixed(2)}`;
}

function formatEfficiency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return `${value.toFixed(0)} Wh/km`;
}

function shortDate(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function driveTimestamp(drive: Drive): number | null {
  const timestamp = new Date(drive.start_ts).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function summarizeRecentWindow(drives: Drive[]) {
  const timestamps = drives
    .map(driveTimestamp)
    .filter((value): value is number => value != null);

  if (timestamps.length === 0) {
    return [];
  }

  const latest = Math.max(...timestamps);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return drives.filter(drive => {
    const timestamp = driveTimestamp(drive);
    return timestamp != null && latest - timestamp <= sevenDaysMs;
  });
}

export function R0004DashboardAnalyticsSection({
  drives,
  fleet,
  hasError,
  isLoading,
}: R0004DashboardAnalyticsSectionProps) {
  const recentDrives = useMemo(() => summarizeRecentWindow(drives), [drives]);
  const returnedDistanceM = drives.reduce(
    (sum, drive) => sum + (drive.distance_m ?? 0),
    0,
  );
  const returnedEnergyWh = drives.reduce(
    (sum, drive) => sum + (drive.energy_used_wh ?? 0),
    0,
  );
  const totalDistanceKm =
    fleet?.total_distance_km ??
    (returnedDistanceM > 0 ? returnedDistanceM / 1000 : undefined);
  const totalEnergyKwh =
    returnedEnergyWh > 0 ? returnedEnergyWh / 1000 : undefined;
  const trendSource = useMemo(
    () => fleet?.drive_analytics?.daily_trend ?? [],
    [fleet?.drive_analytics?.daily_trend],
  );
  const trendData = useMemo<ChartSummaryDatum[]>(() => {
    if (trendSource.length > 0) {
      return trendSource.slice(-8).map(point => ({
        id: point.date,
        label: shortDate(point.date),
        value: point.distance,
        formattedValue: formatDistanceKm(point.distance),
        icon: 'navigation' as const,
      }));
    }

    return recentDrives.slice(0, 8).map(drive => ({
      id: String(drive.id),
      label: shortDate(drive.start_ts),
      value: (drive.distance_m ?? 0) / 1000,
      formattedValue: formatDistance(drive.distance_m),
      icon: 'drive' as const,
    }));
  }, [recentDrives, trendSource]);
  const comparisonRows = fleet?.vehicle_comparison ?? [];
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'r0004-statistics',
        label: 'Statistics',
        value:
          isLoading && !fleet && drives.length === 0
            ? '-'
            : formatCount(fleet?.total_drives ?? drives.length),
        helper: hasError
          ? 'Analytics source partially unavailable'
          : '/analytics/fleet and /drives',
        tone: hasError ? 'warning' : 'accent',
        icon: 'analytics',
      },
      {
        id: 'r0004-lifetime',
        label: 'Lifetime stats',
        value: formatDistanceKm(totalDistanceKm),
        helper: 'Fleet total or returned drive distance',
        tone: 'success',
        icon: 'trophy',
      },
      {
        id: 'r0004-weekly',
        label: 'Weekly digest',
        value: recentDrives.length,
        helper: 'Seven-day window anchored to latest returned drive',
        tone: recentDrives.length > 0 ? 'accent' : 'neutral',
        icon: 'calendar',
      },
      {
        id: 'r0004-compare',
        label: 'Compare routes',
        value: comparisonRows.length,
        helper: 'Vehicle comparison rows from /analytics/fleet',
        tone: comparisonRows.length > 0 ? 'success' : 'neutral',
        icon: 'gitCompare',
      },
    ],
    [
      comparisonRows.length,
      drives.length,
      fleet,
      hasError,
      isLoading,
      recentDrives.length,
      totalDistanceKm,
    ],
  );

  return (
    <ScreenSection
      title="R0004 dashboard analytics routes"
      subtitle="Statistics, lifetime, weekly digest, redirects, and period compare routes use native summaries from /analytics/fleet and /drives."
    >
      <MetricGrid items={metrics} minItemWidth={180} />
      <ChartSummary
        title="Period compare and lifetime trend"
        subtitle="Native chart summary for /period-compare, /compare, /analytics/compare, /statistics, and /lifetime-stats."
        metricLabel="Lifetime distance"
        metricValue={formatDistanceKm(totalDistanceKm)}
        data={trendData}
        emptyLabel={
          hasError
            ? 'Dashboard analytics APIs are unavailable for period comparison.'
            : 'Period comparison points will appear when /analytics/fleet or /drives returns route history.'
        }
        icon="trends"
        sourceLabel="/analytics/fleet drive_analytics.daily_trend with /drives fallback"
        parityStatusLabel="R0004 dashboard routes"
      />
      <View>
        <KeyValueRow
          label="Analytics lifetime redirect"
          value="/analytics/lifetime -> /lifetime-stats"
        />
        <KeyValueRow
          label="Compare redirects"
          value="/compare and /analytics/compare -> /period-compare"
        />
        <KeyValueRow
          label="Returned drive energy"
          value={formatEnergyKwh(totalEnergyKwh)}
        />
        <KeyValueRow
          label="Average efficiency"
          value={formatEfficiency(fleet?.avg_efficiency_wh_km)}
        />
        <KeyValueRow
          label="Fleet cost"
          value={formatCurrency(fleet?.total_cost)}
        />
      </View>
      {comparisonRows.length === 0 ? (
        <EmptyState
          title={
            isLoading ? 'Loading comparison rows' : 'No vehicle comparison rows'
          }
          message={
            hasError
              ? 'Vehicle comparison data will appear when /analytics/fleet is reachable.'
              : 'The compare routes stay visible and show real rows when the backend returns vehicle_comparison.'
          }
        />
      ) : (
        <View>
          {comparisonRows.slice(0, 5).map(vehicle => (
            <ListRow
              key={vehicle.id}
              title={vehicle.name}
              subtitle={`${formatDistanceKm(vehicle.distance)} - ${formatCount(
                vehicle.drives,
              )} drives`}
              meta={formatEfficiency(vehicle.efficiency)}
              icon="gitCompare"
              detail={
                <View>
                  <KeyValueRow
                    label="Energy"
                    value={formatEnergyKwh(vehicle.energy)}
                  />
                  <KeyValueRow label="Vehicle id" value={vehicle.id} />
                </View>
              }
            />
          ))}
        </View>
      )}
    </ScreenSection>
  );
}
