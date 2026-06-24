import React, { useMemo } from 'react';
import { View } from 'react-native';

import type {
  DailyMileage,
  Drive,
  DriveTelemetryReading,
  MileageStats,
  MonthlyMileage,
  Trip,
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
import { FleetMessage } from './FleetMessage';
import { fleetStyles } from './fleetStyles';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatEnergy,
  formatPower,
  formatSpeed,
} from './formatFleetValue';

interface DrivingAnalyticsRoutesSectionProps {
  dailyMileage: DailyMileage[];
  drives: Drive[];
  hasError: boolean;
  isLoading: boolean;
  mileageStats: MileageStats | undefined;
  monthlyMileage: MonthlyMileage[];
  selectedDrive: Drive | null | undefined;
  telemetry: DriveTelemetryReading[];
  trips: Trip[];
  vehicleId: number | null;
}

function formatDistanceKm(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return formatDistance(value * 1000);
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function latestTripLabel(trips: Trip[]): string {
  const latest = trips[0];
  if (!latest) {
    return 'No /trips rows';
  }

  return latest.name ?? `Trip #${latest.id}`;
}

export function DrivingAnalyticsRoutesSection({
  dailyMileage,
  drives,
  hasError,
  isLoading,
  mileageStats,
  monthlyMileage,
  selectedDrive,
  telemetry,
  trips,
  vehicleId,
}: DrivingAnalyticsRoutesSectionProps) {
  const scoredDrives = drives.filter(
    drive => drive.score != null && Number.isFinite(drive.score),
  );
  const avgScore = average(scoredDrives.map(drive => drive.score ?? 0));
  const returnedDistanceM = drives.reduce(
    (sum, drive) => sum + (drive.distance_m ?? 0),
    0,
  );
  const totalMileageKm =
    mileageStats?.total_distance ??
    (returnedDistanceM > 0 ? returnedDistanceM / 1000 : undefined);
  const speedSamples = telemetry
    .map(reading => reading.speed_mps)
    .filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
  const powerSamples = telemetry
    .map(reading => reading.power_w)
    .filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
  const mileageData = useMemo<ChartSummaryDatum[]>(() => {
    if (dailyMileage.length > 0) {
      return dailyMileage.slice(-8).map(day => ({
        id: day.date,
        label: shortDate(day.date),
        value: day.distance_km,
        formattedValue: formatDistanceKm(day.distance_km),
        icon: 'navigation' as const,
      }));
    }

    return drives.slice(0, 8).map(drive => ({
      id: String(drive.id),
      label: shortDate(drive.start_ts),
      value: (drive.distance_m ?? 0) / 1000,
      formattedValue: formatDistance(drive.distance_m),
      icon: 'drive' as const,
    }));
  }, [dailyMileage, drives]);
  const dynamicsData = useMemo<ChartSummaryDatum[]>(
    () =>
      telemetry
        .filter(reading => reading.speed_mps != null)
        .slice(-8)
        .map((reading, index) => ({
          id: `${reading.ts ?? reading.created_at}:${index}`,
          label: formatDateTime(reading.ts ?? reading.created_at),
          value: reading.speed_mps ?? 0,
          formattedValue: formatSpeed(reading.speed_mps),
          icon: 'speed' as const,
        })),
    [telemetry],
  );
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'r0004-drive-score',
        label: 'Drive score',
        value: avgScore == null ? '-' : avgScore.toFixed(0),
        helper: `${scoredDrives.length} scored drives from /drives`,
        tone: (avgScore ?? 0) >= 90 ? 'success' : 'accent',
        icon: 'award',
      },
      {
        id: 'r0004-mileage',
        label: 'Mileage',
        value: formatDistanceKm(totalMileageKm),
        helper: mileageStats
          ? `${mileageStats.days_tracked} tracked days`
          : 'Returned drive distance',
        tone: 'success',
        icon: 'navigation',
      },
      {
        id: 'r0004-trips',
        label: 'Trips',
        value: isLoading && trips.length === 0 ? '-' : trips.length,
        helper: latestTripLabel(trips),
        tone: trips.length > 0 ? 'accent' : 'neutral',
        icon: 'trip',
      },
      {
        id: 'r0004-dynamics',
        label: 'Dynamics samples',
        value: telemetry.length,
        helper: `${speedSamples.length} speed / ${powerSamples.length} power samples`,
        tone: telemetry.length > 0 ? 'accent' : 'neutral',
        icon: 'activity',
      },
    ],
    [
      avgScore,
      isLoading,
      mileageStats,
      powerSamples.length,
      scoredDrives.length,
      speedSamples.length,
      telemetry.length,
      totalMileageKm,
      trips,
    ],
  );

  return (
    <ScreenSection
      title="R0004 driving analytics routes"
      subtitle="Timeline, mileage, trip planner, sharing, navigation, driving dynamics, and drive score routes render native summaries from typed driving APIs."
    >
      <MetricGrid items={metrics} minItemWidth={180} />
      <ChartSummary
        title="Mileage route summary"
        subtitle="Daily mileage uses /mileage/daily when a vehicle is selected and falls back to returned drive distances."
        metricLabel="Total mileage"
        metricValue={formatDistanceKm(totalMileageKm)}
        data={mileageData}
        emptyLabel={
          hasError
            ? 'Mileage APIs are unavailable for the selected vehicle.'
            : 'Mileage chart points will appear when /mileage/daily or /drives returns distance rows.'
        }
        icon="trends"
        sourceLabel="/mileage/daily, /mileage/monthly, /mileage/stats, and /drives"
        parityStatusLabel="R0004 mileage"
      />
      <ChartSummary
        title="Driving dynamics summary"
        subtitle="Native speed/power summary for /driving-dynamics and /drive-score without browser charts."
        metricLabel="Average speed"
        metricValue={formatSpeed(average(speedSamples))}
        data={dynamicsData}
        emptyLabel={
          hasError
            ? 'Drive telemetry is unavailable for driving dynamics.'
            : 'Driving dynamics points will appear when /drives/{driveID}/telemetry returns speed samples.'
        }
        icon="activity"
        sourceLabel="/drives/{driveID}/telemetry"
        parityStatusLabel="R0004 driving dynamics"
      />
      <View style={fleetStyles.detailStack}>
        <View>
          <KeyValueRow label="Selected vehicle_id" value={vehicleId ?? '-'} />
          <KeyValueRow
            label="Selected drive"
            value={selectedDrive ? `Drive #${selectedDrive.id}` : '-'}
          />
          <KeyValueRow label="Trip planner route" value="/trip-planner" />
          <KeyValueRow label="Navigation route" value="/navigation" />
          <KeyValueRow
            label="Average telemetry power"
            value={formatPower(average(powerSamples))}
          />
          <KeyValueRow
            label="Monthly mileage buckets"
            value={monthlyMileage.length}
          />
        </View>
        {trips.length === 0 ? (
          <FleetMessage
            title={isLoading ? 'Loading trips' : 'No trips returned'}
            message={
              hasError
                ? 'Trip sharing and timeline rows will appear when /trips is reachable.'
                : 'Sharing/trips parity does not fabricate public trips; it waits for real /trips rows.'
            }
            tone={hasError ? 'error' : isLoading ? 'loading' : 'empty'}
            icon="trip"
          />
        ) : (
          <View style={fleetStyles.list}>
            {trips.slice(0, 5).map(trip => (
              <ListRow
                key={trip.id}
                title={trip.name ?? `Trip #${trip.id}`}
                subtitle={`${formatDistance(
                  trip.total_distance_m,
                )} - ${formatDuration(trip.total_duration_s)}`}
                meta={`${trip.drive_count} drives`}
                icon="trip"
                detail={
                  <View>
                    <KeyValueRow
                      label="Started"
                      value={formatDateTime(trip.started_at)}
                    />
                    <KeyValueRow
                      label="Ended"
                      value={formatDateTime(trip.ended_at)}
                    />
                    <KeyValueRow
                      label="Energy"
                      value={formatEnergy(trip.total_energy_wh)}
                    />
                    <KeyValueRow
                      label="Share source"
                      value={`/trips/${trip.id}`}
                    />
                  </View>
                }
              />
            ))}
          </View>
        )}
      </View>
    </ScreenSection>
  );
}
