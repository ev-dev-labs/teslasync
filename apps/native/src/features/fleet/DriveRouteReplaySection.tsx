import React, {useMemo} from 'react';
import {View} from 'react-native';

import type {Drive, DriveTelemetryReading} from '../../api/types';
import {ChartSummary, type ChartSummaryDatum} from '../../components/charts/ChartSummary';
import {ScreenSection} from '../../components/data/ScreenSection';
import {MapRouteSummary, type RoutePoint} from '../../components/maps/MapRouteSummary';
import {FleetMessage} from './FleetMessage';
import {fleetStyles} from './fleetStyles';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatSpeed,
} from './formatFleetValue';

interface DriveRouteReplaySectionProps {
  drive: Drive | null | undefined;
  telemetry: DriveTelemetryReading[];
  isLoading: boolean;
  hasError: boolean;
}

function hasRouteCoordinates(
  reading: DriveTelemetryReading,
): reading is DriveTelemetryReading & {latitude: number; longitude: number} {
  return Number.isFinite(reading.latitude) && Number.isFinite(reading.longitude);
}

export function DriveRouteReplaySection({
  drive,
  telemetry,
  isLoading,
  hasError,
}: DriveRouteReplaySectionProps) {
  const routePoints = useMemo<RoutePoint[]>(
    () =>
      telemetry.filter(hasRouteCoordinates).map(reading => ({
        latitude: reading.latitude,
        longitude: reading.longitude,
        label: reading.ts ?? reading.created_at,
      })),
    [telemetry],
  );
  const speedData = useMemo<ChartSummaryDatum[]>(
    () =>
      telemetry
        .filter(reading => reading.speed_mps != null)
        .slice(-8)
        .map((reading, index) => ({
          id: `${reading.ts ?? reading.created_at}:${index}`,
          label: formatDateTime(reading.ts ?? reading.created_at),
          value: reading.speed_mps ?? 0,
          formattedValue: formatSpeed(reading.speed_mps),
          icon: 'speed',
        })),
    [telemetry],
  );
  const latestSpeed = useMemo(() => {
    for (let index = telemetry.length - 1; index >= 0; index -= 1) {
      const speed = telemetry[index].speed_mps;
      if (speed != null) {
        return speed;
      }
    }

    return undefined;
  }, [telemetry]);

  return (
    <ScreenSection
      title="Route and replay summary"
      subtitle="Native route summary from drive telemetry; full map gestures are honestly pending.">
      {!drive && isLoading ? (
        <FleetMessage
          title="Loading replay telemetry"
          message="Resolving drive telemetry for route and replay summaries."
          tone="loading"
        />
      ) : !drive ? (
        <FleetMessage
          title="No replay drive selected"
          message="Route and replay summaries appear after selecting a drive with telemetry."
          tone="empty"
          icon="mapPinned"
        />
      ) : (
        <View style={fleetStyles.detailStack}>
          <MapRouteSummary
            title="Drive route"
            subtitle="Summary-only native route visualization; no WebView map embedding."
            startLabel={drive.start_address ?? 'Start unavailable'}
            endLabel={drive.end_address ?? 'End unavailable'}
            distanceLabel={formatDistance(drive.distance_m)}
            durationLabel={formatDuration(drive.duration_s)}
            points={routePoints}
            emptyLabel={
              hasError
                ? 'Drive telemetry API is unavailable for this route.'
                : 'Telemetry did not include enough route coordinates for a native summary.'
            }
          />
          <ChartSummary
            title="Replay speed summary"
            subtitle="Native replay summary from /drives/:id/telemetry speed samples."
            metricLabel="Latest speed"
            metricValue={formatSpeed(latestSpeed)}
            data={speedData}
            emptyLabel={
              hasError
                ? 'Drive telemetry API is unavailable for replay speed samples.'
                : 'Telemetry did not include speed samples for this drive.'
            }
            icon="speedCircle"
          />
          {hasError ? (
            <FleetMessage
              title="Partial replay detail"
              message="Drive detail is shown when available; telemetry route/replay data is unavailable."
              tone="error"
            />
          ) : null}
        </View>
      )}
    </ScreenSection>
  );
}
