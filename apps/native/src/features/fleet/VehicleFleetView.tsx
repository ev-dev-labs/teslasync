import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useVehicle, useVehicleState, useVehicles } from '../../api/hooks';
import type { Vehicle, VehicleState } from '../../api/types';
import { KeyValueRow } from '../../components/data/KeyValueRow';
import { ListRow } from '../../components/data/ListRow';
import { MetricGrid, type MetricGridItem } from '../../components/data/MetricGrid';
import { ScreenSection } from '../../components/data/ScreenSection';
import { AppText } from '../../components/ui/AppText';
import { StatusPill } from '../../components/ui/StatusPill';
import { spacing } from '../../theme/tokens';
import { FleetMessage } from './FleetMessage';
import {
  FleetRouteReadiness,
  type FleetRouteReadinessItem,
} from './FleetRouteReadiness';
import {
  formatDateTime,
  formatLocation,
  formatPercent,
  formatPower,
  formatSpeed,
  shortVin,
} from './formatFleetValue';

const vehicleReadinessItems: FleetRouteReadinessItem[] = [
  {
    id: 'vehicle-detail',
    label: 'Vehicle detail shell',
    route: '/vehicles/:id',
    api: '/vehicles/{vehicleID}, /vehicles/{vehicleID}/state',
    status: 'implemented',
    evidence:
      'The native Vehicles screen keeps a selected vehicle detail shell with typed metadata and live state.',
  },
  {
    id: 'vehicle-access',
    label: 'Vehicle access readiness',
    route: '/vehicles/:id/access',
    api: '/vehicles/{vehicleID}/drivers, /vehicles/{vehicleID}/invitations',
    status: 'pending',
    evidence:
      'Access routes are mapped and named here, but driver invitation actions are not yet implemented natively.',
  },
  {
    id: 'live-map',
    label: 'Live map coordinates',
    route: '/live',
    api: '/vehicles/{vehicleID}/state',
    status: 'native-summary',
    evidence:
      'Native displays live coordinates when telemetry is present; full map interaction remains pending without WebView.',
  },
  {
    id: 'digital-twin',
    label: 'Digital twin readiness',
    route: '/digital-twin',
    api: '/vehicles/{vehicleID}/state',
    status: 'pending',
    evidence:
      'The typed live state contract is available, but a full native digital twin renderer is not implemented.',
  },
];

export function VehicleFleetView() {
  const vehiclesQuery = useVehicles();
  const vehicles = useMemo(() => vehiclesQuery.data ?? [], [vehiclesQuery.data]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);

  useEffect(() => {
    if (vehicles.length === 0) {
      if (selectedVehicleId !== null) {
        setSelectedVehicleId(null);
      }
      return;
    }

    if (!vehicles.some(vehicle => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [selectedVehicleId, vehicles]);

  const selectedVehicle = vehicles.find(vehicle => vehicle.id === selectedVehicleId) ?? null;
  const vehicleDetailQuery = useVehicle(selectedVehicleId);
  const vehicleStateQuery = useVehicleState(selectedVehicleId);
  const detailVehicle = vehicleDetailQuery.data ?? selectedVehicle;
  const liveState = vehicleStateQuery.data?.state;

  return (
    <View style={styles.root}>
      <VehicleFleetOverview
        vehicles={vehicles}
        selectedVehicle={detailVehicle}
        liveState={liveState}
        isLoading={vehiclesQuery.isLoading}
        hasError={Boolean(vehiclesQuery.error)}
      />
      <VehicleListSection
        vehicles={vehicles}
        selectedVehicleId={selectedVehicleId}
        isLoading={vehiclesQuery.isLoading}
        hasError={Boolean(vehiclesQuery.error)}
        onSelect={setSelectedVehicleId}
      />
      <VehicleDetailSection
        vehicle={detailVehicle}
        liveState={liveState}
        isLoading={vehicleDetailQuery.isLoading || vehicleStateQuery.isLoading}
        hasDetailError={Boolean(vehicleDetailQuery.error)}
        hasStateError={Boolean(vehicleStateQuery.error)}
      />
      <FleetRouteReadiness
        title="Vehicle route readiness"
        subtitle="Represented vehicle routes are typed and statused without hiding pending native work."
        items={vehicleReadinessItems}
      />
    </View>
  );
}

interface VehicleFleetOverviewProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null | undefined;
  liveState: VehicleState | null | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function VehicleFleetOverview({
  vehicles,
  selectedVehicle,
  liveState,
  isLoading,
  hasError,
}: VehicleFleetOverviewProps) {
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'vehicles',
        label: 'Vehicles',
        value: isLoading && vehicles.length === 0 ? '-' : vehicles.length,
        helper: hasError ? 'Vehicle API unavailable' : 'API-backed garage count',
        tone: hasError ? 'warning' : 'accent',
        icon: 'vehicle',
      },
      {
        id: 'healthy',
        label: 'Healthy',
        value: isLoading && vehicles.length === 0 ? '-' : vehicles.filter(vehicle => vehicle.healthy).length,
        helper: 'Reported fleet health',
        tone: vehicles.some(vehicle => !vehicle.healthy) ? 'warning' : 'success',
        icon: 'success',
      },
      {
        id: 'battery',
        label: 'Selected battery',
        value: formatPercent(liveState?.battery_level),
        helper: selectedVehicle?.display_name ?? 'No selected vehicle',
        tone: liveState?.is_charging ? 'success' : 'neutral',
        icon: liveState?.is_charging ? 'batteryCharging' : 'battery',
      },
      {
        id: 'speed',
        label: 'Live speed',
        value: formatSpeed(liveState?.speed_mps),
        helper: 'SI telemetry converted at render boundary',
        tone: (liveState?.speed_mps ?? 0) > 0 ? 'accent' : 'neutral',
        icon: 'speed',
      },
    ],
    [hasError, isLoading, liveState, selectedVehicle?.display_name, vehicles],
  );

  return (
    <ScreenSection
      title="Fleet garage overview"
      subtitle="Native vehicle list/detail parity with typed live state and SI display conversion.">
      <MetricGrid items={metrics} />
    </ScreenSection>
  );
}

interface VehicleListSectionProps {
  vehicles: Vehicle[];
  selectedVehicleId: number | null;
  isLoading: boolean;
  hasError: boolean;
  onSelect: (vehicleId: number) => void;
}

function VehicleListSection({
  vehicles,
  selectedVehicleId,
  isLoading,
  hasError,
  onSelect,
}: VehicleListSectionProps) {
  return (
    <ScreenSection
      title="Vehicles"
      subtitle="API-backed garage cards for every vehicle returned by /vehicles.">
      {isLoading && vehicles.length === 0 ? (
        <FleetMessage
          title="Loading vehicles"
          message="Fetching vehicle metadata from the TeslaSync API."
          tone="loading"
        />
      ) : hasError && vehicles.length === 0 ? (
        <FleetMessage
          title="Vehicle API unavailable"
          message="Vehicle cards will appear when the native app can reach /vehicles."
          tone="error"
        />
      ) : vehicles.length === 0 ? (
        <FleetMessage
          title="No vehicles yet"
          message="The garage will show every API vehicle, health state, model, and update time."
          tone="empty"
          icon="vehicle"
        />
      ) : (
        <View style={styles.list}>
          {vehicles.map(vehicle => (
            <ListRow
              key={vehicle.id}
              title={vehicle.display_name || `Vehicle ${vehicle.vehicle_id}`}
              subtitle={[vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ') || 'Tesla vehicle'}
              meta={vehicle.id === selectedVehicleId ? 'Selected' : vehicle.state || 'unknown'}
              icon="vehicle"
              onPress={() => onSelect(vehicle.id)}
              detail={
                <View>
                  <KeyValueRow label="VIN" value={shortVin(vehicle.vin)} />
                  <KeyValueRow label="Color" value={vehicle.exterior_color || '-'} />
                  <KeyValueRow label="Updated" value={formatDateTime(vehicle.updated_at)} />
                </View>
              }
            />
          ))}
        </View>
      )}
    </ScreenSection>
  );
}

interface VehicleDetailSectionProps {
  vehicle: Vehicle | null | undefined;
  liveState: VehicleState | null | undefined;
  isLoading: boolean;
  hasDetailError: boolean;
  hasStateError: boolean;
}

function VehicleDetailSection({
  vehicle,
  liveState,
  isLoading,
  hasDetailError,
  hasStateError,
}: VehicleDetailSectionProps) {
  const statusState = vehicle?.healthy === false || hasDetailError ? 'warning' : 'online';
  const statusLabel = vehicle?.healthy === false ? 'Needs attention' : liveState?.state ?? vehicle?.state ?? 'Ready';
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'battery',
        label: 'Battery',
        value: formatPercent(liveState?.battery_level),
        helper: liveState?.is_charging ? 'Charging now' : 'Latest state endpoint',
        tone: liveState?.is_charging ? 'success' : 'neutral',
        icon: liveState?.is_charging ? 'batteryCharging' : 'battery',
      },
      {
        id: 'power',
        label: 'Power',
        value: formatPower(liveState?.power_w),
        helper: 'Instant traction or charging power',
        tone: (liveState?.power_w ?? 0) > 0 ? 'warning' : 'neutral',
        icon: 'power',
      },
      {
        id: 'location',
        label: 'Location',
        value: formatLocation(liveState?.latitude, liveState?.longitude),
        helper: 'Coordinate summary, not a WebView map',
        tone: liveState?.latitude != null && liveState?.longitude != null ? 'accent' : 'neutral',
        icon: 'mapPinned',
      },
    ],
    [liveState],
  );

  return (
    <ScreenSection
      title="Vehicle detail shell"
      subtitle="Selected vehicle detail route with typed metadata, live state, and honest fallback states.">
      {!vehicle && isLoading ? (
        <FleetMessage
          title="Loading vehicle detail"
          message="Resolving the selected vehicle and current state surfaces."
          tone="loading"
        />
      ) : !vehicle ? (
        <FleetMessage
          title="No selected vehicle"
          message="Select a vehicle from the garage once /vehicles returns data."
          tone="empty"
          icon="vehicle"
        />
      ) : (
        <View style={styles.detailStack}>
          <View style={styles.detailHeader}>
            <View style={styles.detailCopy}>
              <AppText variant="title" weight="bold">
                {vehicle.display_name || `Vehicle ${vehicle.vehicle_id}`}
              </AppText>
              <AppText tone="secondary">
                {[vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ') || 'Tesla vehicle'}
              </AppText>
            </View>
            <StatusPill label={statusLabel} state={statusState} />
          </View>
          <MetricGrid items={metrics} minItemWidth={180} />
          <View>
            <KeyValueRow label="VIN" value={shortVin(vehicle.vin)} />
            <KeyValueRow label="Wheel type" value={vehicle.wheel_type || '-'} />
            <KeyValueRow label="Firmware" value={liveState?.software_version ?? '-'} />
            <KeyValueRow label="Locked" value={liveState?.is_locked == null ? '-' : liveState.is_locked ? 'Yes' : 'No'} />
            <KeyValueRow label="Timezone" value={vehicle.timezone ?? '-'} />
          </View>
          {hasDetailError || hasStateError ? (
            <FleetMessage
              title="Partial vehicle detail"
              message="Static metadata is shown when available; one or more detail endpoints are unavailable."
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
    gap: spacing.xs,
  },
});
