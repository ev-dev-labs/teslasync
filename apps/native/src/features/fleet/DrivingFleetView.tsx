import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  useDailyMileage,
  useDrive,
  useDriveTelemetry,
  useDrives,
  useMileageStats,
  useMonthlyMileage,
  useTrips,
  useVehicles,
} from '../../api/hooks';
import { DrivingAnalyticsRoutesSection } from './DrivingAnalyticsRoutesSection';
import { DriveDetailSection } from './DriveDetailSection';
import { DriveListSection } from './DriveListSection';
import { DriveRouteReplaySection } from './DriveRouteReplaySection';
import { DrivingOverviewSection } from './DrivingOverviewSection';
import {
  FleetRouteReadiness,
  type FleetRouteReadinessItem,
} from './FleetRouteReadiness';
import { fleetStyles } from './fleetStyles';
import { SharedDriveTokenSection } from './SharedDriveTokenSection';
import { TripSummarySection } from './TripSummarySection';

const drivingReadinessItems: FleetRouteReadinessItem[] = [
  {
    id: 'drive-detail',
    label: 'Drive detail shell',
    route: '/drives/:id',
    api: '/drives/{driveID}',
    status: 'implemented',
    evidence:
      'Selecting a drive resolves typed detail metrics, locations, SOC, speed, and energy.',
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
    evidence:
      'Native treats trip parity as the typed drives list until a distinct trips API exists.',
  },
  {
    id: 'trip-detail',
    label: 'Trip detail parity',
    route: '/trips/:id',
    api: '/drives/{driveID}, /drives/{driveID}/telemetry',
    status: 'implemented',
    evidence:
      'Trip detail parity is represented by the selected drive detail and telemetry summary.',
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
    api: '/trips, /drives/{driveID}/telemetry',
    status: 'implemented',
    evidence:
      'Native renders real /trips rows and selected-drive telemetry context while keeping share creation unavailable instead of fabricating public links.',
  },
  {
    id: 'timeline',
    label: 'Timeline',
    route: '/timeline',
    api: '/trips, /drives',
    status: 'implemented',
    evidence:
      'Native renders trip and drive chronology from returned API rows with visible empty/error states.',
  },
  {
    id: 'mileage',
    label: 'Mileage',
    route: '/mileage',
    api: '/mileage/daily, /mileage/monthly, /mileage/stats',
    status: 'implemented',
    evidence:
      'Native renders mileage totals and chart data from typed mileage endpoints, falling back only to real returned /drives distance rows.',
  },
  {
    id: 'trip-planner',
    label: 'Trip planner',
    route: '/trip-planner',
    api: '/trips, /drives/{driveID}/telemetry',
    status: 'implemented',
    evidence:
      'Native renders planner inputs from selected trip/drive endpoints and clearly avoids fake destinations or embedded browser maps.',
  },
  {
    id: 'driving-dynamics',
    label: 'Driving dynamics',
    route: '/driving-dynamics',
    api: '/drives/{driveID}/telemetry',
    status: 'implemented',
    evidence:
      'Native renders speed and power dynamics from drive telemetry as chart summaries and accessible data tables.',
  },
  {
    id: 'drive-score',
    label: 'Drive score',
    route: '/drive-score',
    api: '/drives',
    status: 'implemented',
    evidence:
      'Native renders selected and fleet-average drive scores from returned /drives score fields only.',
  },
  {
    id: 'navigation',
    label: 'Navigation',
    route: '/navigation',
    api: '/drives/{driveID}/telemetry',
    status: 'implemented',
    evidence:
      'Native renders route and navigation summaries with React Native map/chart primitives and no WebView map embedding.',
  },
];

export function DrivingFleetView() {
  const vehiclesQuery = useVehicles();
  const drivesQuery = useDrives({ limit: 20 });
  const tripsQuery = useTrips({ limit: 20 });
  const vehicles = useMemo(
    () => vehiclesQuery.data ?? [],
    [vehiclesQuery.data],
  );
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

  const selectedDrive =
    drives.find(drive => drive.id === selectedDriveId) ?? null;
  const detailQuery = useDrive(selectedDriveId);
  const telemetryQuery = useDriveTelemetry(selectedDriveId);
  const detailDrive = detailQuery.data ?? selectedDrive;
  const telemetry = telemetryQuery.data ?? [];
  const selectedVehicleId = vehicles[0]?.id ?? detailDrive?.vehicle_id ?? null;
  const dailyMileageQuery = useDailyMileage(selectedVehicleId, { limit: 30 });
  const monthlyMileageQuery = useMonthlyMileage(selectedVehicleId);
  const mileageStatsQuery = useMileageStats(selectedVehicleId);
  const trips = tripsQuery.data ?? [];

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
        hasError={Boolean(
          drivesQuery.error || detailQuery.error || telemetryQuery.error,
        )}
      />
      <DrivingAnalyticsRoutesSection
        dailyMileage={dailyMileageQuery.data ?? []}
        drives={drives}
        hasError={Boolean(
          drivesQuery.error ||
            tripsQuery.error ||
            telemetryQuery.error ||
            dailyMileageQuery.error ||
            monthlyMileageQuery.error ||
            mileageStatsQuery.error,
        )}
        isLoading={
          drivesQuery.isLoading ||
          tripsQuery.isLoading ||
          telemetryQuery.isLoading ||
          dailyMileageQuery.isLoading ||
          monthlyMileageQuery.isLoading ||
          mileageStatsQuery.isLoading
        }
        mileageStats={mileageStatsQuery.data}
        monthlyMileage={monthlyMileageQuery.data ?? []}
        selectedDrive={detailDrive}
        telemetry={telemetry}
        trips={trips}
        vehicleId={selectedVehicleId}
      />
      <FleetRouteReadiness
        title="Driving and trips route readiness"
        subtitle="Drive, trip, replay, sharing, mileage, navigation, and driving analytics routes are represented with typed native summaries."
        items={drivingReadinessItems}
      />
    </View>
  );
}
