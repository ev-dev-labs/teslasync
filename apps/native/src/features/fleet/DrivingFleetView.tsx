import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useDrive, useDriveTelemetry, useDrives } from '../../api/hooks';
import type { Drive, DriveTelemetryReading } from '../../api/types';
import { ChartSummary, type ChartSummaryDatum } from '../../components/charts/ChartSummary';
import { KeyValueRow } from '../../components/data/KeyValueRow';
import { ListRow } from '../../components/data/ListRow';
import { MetricGrid, type MetricGridItem } from '../../components/data/MetricGrid';
import { ScreenSection } from '../../components/data/ScreenSection';
import { MapRouteSummary, type RoutePoint } from '../../components/maps/MapRouteSummary';
import { StatusPill } from '../../components/ui/StatusPill';
import { spacing } from '../../theme/tokens';
import { FleetMessage } from './FleetMessage';
import {
  FleetRouteReadiness,
  type FleetRouteReadinessItem,
} from './FleetRouteReadiness';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatEfficiency,
  formatEnergy,
  formatPower,
  formatSocRange,
  formatSpeed,
} from './formatFleetValue';

const drivingReadinessItems: FleetRouteReadinessItem[] = [
  {
    id: 'drive-detail',
    label: 'Drive detail shell',
    route: '/drives/:id',
    api: '/drives/{driveID}',
    status: 'implemented',
    evidence: 'Selecting a drive resolves typed detail metrics, locations, SOC, speed, and energy.',
  },
  {
    id: 'drive-replay',
    label: 'Route/replay summary',
    route: '/drives/:id/replay',
    api: '/drives/{driveID}/telemetry',
    status: 'implemented',
    evidence:
      'Native renders a route summary and replay speed chart from telemetry without WebView embedding.',
  },
  {
    id: 'trips',
    label: 'Trips list parity',
    route: '/trips',
    api: '/drives',
    status: 'implemented',
    evidence: 'Native treats trip parity as the typed drives list until a distinct trips API exists.',
  },
  {
    id: 'trip-detail',
    label: 'Trip detail parity',
    route: '/trips/:id',
    api: '/drives/{driveID}, /drives/{driveID}/telemetry',
    status: 'implemented',
    evidence: 'Trip detail parity is represented by the selected drive detail and telemetry summary.',
  },
  {
    id: 'sharing-trips',
    label: 'Trip sharing',
    route: '/sharing/trips',
    api: '/drives/{driveID}/shares',
    status: 'pending',
    evidence: 'Share-link management is not implemented in this native parity slice.',
  },
];

export function DrivingFleetView() {
  const drivesQuery = useDrives({limit: 20});
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const [selectedDriveId, setSelectedDriveId] = useState<number | null>(null);

  useEffect(() => {
    if (drives.length === 0) {
      if (selectedDriveId !== null) {
        setSelectedDriveId(null);
      }
      return;
    }

    if (!drives.some(drive => drive.id === selectedDriveId)) {
      setSelectedDriveId(drives[0].id);
    }
  }, [drives, selectedDriveId]);

  const selectedDrive = drives.find(drive => drive.id === selectedDriveId) ?? null;
  const detailQuery = useDrive(selectedDriveId);
  const telemetryQuery = useDriveTelemetry(selectedDriveId);
  const detailDrive = detailQuery.data ?? selectedDrive;
  const telemetry = telemetryQuery.data ?? [];

  return (
    <View style={styles.root}>
      <DrivingOverviewSection
        drives={drives}
        isLoading={drivesQuery.isLoading}
        hasError={Boolean(drivesQuery.error)}
      />
      <DriveListSection
        drives={drives}
        selectedDriveId={selectedDriveId}
        isLoading={drivesQuery.isLoading}
        hasError={Boolean(drivesQuery.error)}
        onSelect={setSelectedDriveId}
      />
      <DriveDetailSection
        drive={detailDrive}
        isLoading={detailQuery.isLoading}
        hasError={Boolean(detailQuery.error)}
      />
      <DriveRouteReplaySection
        drive={detailDrive}
        telemetry={telemetry}
        isLoading={telemetryQuery.isLoading}
        hasError={Boolean(telemetryQuery.error)}
      />
      <FleetRouteReadiness
        title="Driving and trips route readiness"
        subtitle="Drive, trip, and replay routes are represented with typed summaries and honest pending share work."
        items={drivingReadinessItems}
      />
    </View>
  );
}

interface DrivingOverviewSectionProps {
  drives: Drive[];
  isLoading: boolean;
  hasError: boolean;
}

function DrivingOverviewSection({drives, isLoading, hasError}: DrivingOverviewSectionProps) {
  const totalDistanceM = drives.reduce((sum, drive) => sum + (drive.distance_m ?? 0), 0);
  const totalEnergyWh = drives.reduce((sum, drive) => sum + (drive.energy_used_wh ?? 0), 0);
  const avgScore =
    drives.length === 0
      ? null
      : drives.reduce((sum, drive) => sum + (drive.score ?? 0), 0) / drives.length;
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'trips',
        label: 'Trips',
        value: isLoading && drives.length === 0 ? '-' : drives.length,
        helper: hasError ? 'Drive API unavailable' : 'Recent /drives rows',
        tone: hasError ? 'warning' : 'accent',
        icon: 'trip',
      },
      {
        id: 'distance',
        label: 'Distance',
        value: drives.length === 0 ? '-' : formatDistance(totalDistanceM),
        helper: 'Total returned distance',
        tone: 'accent',
        icon: 'navigation',
      },
      {
        id: 'energy',
        label: 'Energy used',
        value: drives.length === 0 ? '-' : formatEnergy(totalEnergyWh),
        helper: formatEfficiency(totalEnergyWh, totalDistanceM),
        tone: 'warning',
        icon: 'efficiency',
      },
      {
        id: 'score',
        label: 'Average score',
        value: avgScore == null ? '-' : avgScore.toFixed(0),
        helper: 'Returned drive score average',
        tone: (avgScore ?? 0) >= 90 ? 'success' : 'neutral',
        icon: 'award',
      },
    ],
    [avgScore, drives.length, hasError, isLoading, totalDistanceM, totalEnergyWh],
  );

  return (
    <ScreenSection
      title="Driving overview"
      subtitle="Recent drives and trip parity with SI distance, energy, speed, and score summaries.">
      <MetricGrid items={metrics} />
    </ScreenSection>
  );
}

interface DriveListSectionProps {
  drives: Drive[];
  selectedDriveId: number | null;
  isLoading: boolean;
  hasError: boolean;
  onSelect: (driveId: number) => void;
}

function DriveListSection({
  drives,
  selectedDriveId,
  isLoading,
  hasError,
  onSelect,
}: DriveListSectionProps) {
  return (
    <ScreenSection
      title="Drives and trips"
      subtitle="Native trip list backed by /drives with selectable route/replay detail.">
      {isLoading && drives.length === 0 ? (
        <FleetMessage
          title="Loading drives"
          message="Fetching recent drives from the TeslaSync API."
          tone="loading"
        />
      ) : hasError && drives.length === 0 ? (
        <FleetMessage
          title="Drive API unavailable"
          message="Drive and trip rows will appear when /drives is reachable."
          tone="error"
        />
      ) : drives.length === 0 ? (
        <FleetMessage
          title="No drives returned"
          message="Recent trips, scoring, and replay metadata will render here."
          tone="empty"
          icon="drive"
        />
      ) : (
        <View style={styles.list}>
          {drives.map(drive => (
            <ListRow
              key={drive.id}
              title={`Drive #${drive.id}`}
              subtitle={`${formatDistance(drive.distance_m)} · ${formatDuration(drive.duration_s)}`}
              meta={drive.id === selectedDriveId ? 'Selected' : formatDateTime(drive.start_ts)}
              icon="drive"
              onPress={() => onSelect(drive.id)}
              detail={
                <View>
                  <KeyValueRow label="Energy used" value={formatEnergy(drive.energy_used_wh)} />
                  <KeyValueRow label="State of charge" value={formatSocRange(drive.start_soc_pct, drive.end_soc_pct)} />
                  <KeyValueRow label="Score" value={drive.score ?? '-'} />
                </View>
              }
            />
          ))}
        </View>
      )}
    </ScreenSection>
  );
}

interface DriveDetailSectionProps {
  drive: Drive | null | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function DriveDetailSection({drive, isLoading, hasError}: DriveDetailSectionProps) {
  return (
    <ScreenSection
      title="Drive detail shell"
      subtitle="Selected drive/trip detail route with distance, power, SOC, status, and endpoint metadata.">
      {!drive && isLoading ? (
        <FleetMessage
          title="Loading drive detail"
          message="Resolving the selected drive detail route."
          tone="loading"
        />
      ) : !drive ? (
        <FleetMessage
          title="No selected drive"
          message="Select a drive once /drives returns trip history."
          tone="empty"
          icon="drive"
        />
      ) : (
        <View style={styles.detailStack}>
          <View style={styles.detailHeader}>
            <View style={styles.detailCopy}>
              <KeyValueRow label="Started" value={formatDateTime(drive.start_ts)} />
              <KeyValueRow label="Ended" value={formatDateTime(drive.end_ts)} />
            </View>
            <StatusPill
              label={drive.end_ts ? drive.ended_status ?? 'Complete' : 'In progress'}
              state={drive.end_ts ? 'online' : 'warning'}
            />
          </View>
          <MetricGrid
            items={[
              {
                id: 'distance',
                label: 'Distance',
                value: formatDistance(drive.distance_m),
                helper: 'Drive distance',
                tone: 'accent',
                icon: 'navigation',
              },
              {
                id: 'energy',
                label: 'Energy used',
                value: formatEnergy(drive.energy_used_wh),
                helper: formatEfficiency(drive.energy_used_wh, drive.distance_m),
                tone: 'warning',
                icon: 'efficiency',
              },
              {
                id: 'regen',
                label: 'Regen',
                value: formatEnergy(drive.regen_energy_wh),
                helper: 'Regenerative energy',
                tone: 'success',
                icon: 'recycle',
              },
              {
                id: 'score',
                label: 'Score',
                value: drive.score ?? '-',
                helper: 'Drive score',
                tone: (drive.score ?? 0) >= 90 ? 'success' : 'neutral',
                icon: 'award',
              },
            ]}
            minItemWidth={160}
          />
          <View>
            <KeyValueRow label="Average speed" value={formatSpeed(drive.avg_speed_mps)} />
            <KeyValueRow label="Max speed" value={formatSpeed(drive.max_speed_mps)} />
            <KeyValueRow label="Average power" value={formatPower(drive.avg_power_w)} />
            <KeyValueRow label="Start" value={drive.start_address ?? '-'} />
            <KeyValueRow label="End" value={drive.end_address ?? '-'} />
          </View>
          {hasError ? (
            <FleetMessage
              title="Partial drive detail"
              message="List data is shown when available; /drives/:id detail is unavailable."
              tone="error"
            />
          ) : null}
        </View>
      )}
    </ScreenSection>
  );
}

interface DriveRouteReplaySectionProps {
  drive: Drive | null | undefined;
  telemetry: DriveTelemetryReading[];
  isLoading: boolean;
  hasError: boolean;
}

function DriveRouteReplaySection({
  drive,
  telemetry,
  isLoading,
  hasError,
}: DriveRouteReplaySectionProps) {
  const routePoints = useMemo<RoutePoint[]>(
    () =>
      telemetry
        .filter(reading => reading.latitude != null && reading.longitude != null)
        .map(reading => ({
          latitude: reading.latitude as number,
          longitude: reading.longitude as number,
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
  const latestSpeed = telemetry[telemetry.length - 1]?.speed_mps;

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
        <View style={styles.detailStack}>
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

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
  detailStack: {
    gap: spacing.lg,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  detailCopy: {
    flex: 1,
    minWidth: 0,
  },
});
