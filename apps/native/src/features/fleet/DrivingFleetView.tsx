import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';

import {useDrive, useDriveTelemetry, useDrives} from '../../api/hooks';
import {DriveDetailSection} from './DriveDetailSection';
import {DriveListSection} from './DriveListSection';
import {DriveRouteReplaySection} from './DriveRouteReplaySection';
import {DrivingOverviewSection} from './DrivingOverviewSection';
import {
  FleetRouteReadiness,
  type FleetRouteReadinessItem,
} from './FleetRouteReadiness';
import {fleetStyles} from './fleetStyles';
import {SharedDriveTokenSection} from './SharedDriveTokenSection';
import {TripSummarySection} from './TripSummarySection';

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
    id: 'shared-drive-token',
    label: 'Shared drive token route',
    route: '/s/:token',
    api: '/drives/{driveID}, /drives/{driveID}/telemetry',
    status: 'implemented',
    evidence:
      'Native renders a read-only shared-drive token surface from real drive and telemetry data without fabricating token payloads.',
  },
  {
    id: 'sharing-trips',
    label: 'Trip sharing',
    route: '/sharing/trips',
    api: '/drives/{driveID}/shares',
    status: 'native-summary',
    evidence:
      'Trip sharing is represented as a disabled native action; no share links or screenshots are fabricated.',
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
    <View style={fleetStyles.root}>
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
      <TripSummarySection
        drives={drives}
        selectedTrip={detailDrive}
        isLoading={drivesQuery.isLoading || detailQuery.isLoading}
        hasError={Boolean(drivesQuery.error || detailQuery.error)}
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
      <SharedDriveTokenSection
        drive={detailDrive}
        telemetry={telemetry}
        isLoading={drivesQuery.isLoading || detailQuery.isLoading}
        hasError={Boolean(drivesQuery.error || detailQuery.error || telemetryQuery.error)}
      />
      <FleetRouteReadiness
        title="Driving and trips route readiness"
        subtitle="Drive, trip, replay, and sharing routes are represented with typed summaries and unavailable share actions."
        items={drivingReadinessItems}
      />
    </View>
  );
}
