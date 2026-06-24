import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  useClimateLatest,
  useMaintenanceItems,
  useMediaLatest,
  useSafetyLatest,
  useSecurityLatest,
  useServiceRecords,
  useSoftwareUpdates,
  useTirePressureLatest,
  useVehicle,
  useVehicleConfigLatest,
  useVehicleState,
  useVehicles,
} from '../../api/hooks';
import {
  FleetRouteReadiness,
  type FleetRouteReadinessItem,
} from './FleetRouteReadiness';
import { fleetStyles } from './fleetStyles';
import { LiveVehicleRouteSection } from './LiveVehicleRouteSection';
import { VehicleDetailSection } from './VehicleDetailSection';
import { VehicleFleetOverviewSection } from './VehicleFleetOverviewSection';
import { VehicleListSection } from './VehicleListSection';
import { VehicleSystemsSection } from './VehicleSystemsSection';

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
    api: '/vehicles/{vehicleID}/state, /security/latest',
    status: 'implemented',
    evidence:
      'Native renders selected vehicle access state and keeps driver/invitation mutations visibly unavailable instead of faking command support.',
  },
  {
    id: 'live-map',
    label: 'Live map coordinates',
    route: '/live',
    api: '/vehicles/{vehicleID}/state',
    status: 'implemented',
    evidence:
      'Native renders a dedicated live map route surface with selected vehicle state, coordinates, speed, power, and explicit empty/error states.',
  },
  {
    id: 'digital-twin',
    label: 'Digital twin readiness',
    route: '/digital-twin',
    api: '/vehicles/{vehicleID}/state, /vehicle-config/latest',
    status: 'implemented',
    evidence:
      'Native renders digital-twin metadata, firmware, wheel/color/config, and live state while leaving unsupported 3D rendering unavailable.',
  },
  {
    id: 'tire-pressure',
    label: 'Tire pressure',
    route: '/tire-pressure',
    api: '/tire-pressure/latest',
    status: 'implemented',
    evidence:
      'Native renders TPMS pressure cards from the typed latest endpoint with empty/error states for missing signal payloads.',
  },
  {
    id: 'software-updates',
    label: 'Software updates',
    route: '/software-updates, /vehicle-systems/software',
    api: '/software-updates, /vehicle-config/latest',
    status: 'implemented',
    evidence:
      'Native renders firmware/version history and vehicle config while install and summarizer actions remain unavailable.',
  },
  {
    id: 'climate-security-media',
    label: 'Climate, security, and media systems',
    route:
      '/climate-control, /climate, /security-access, /guard-mode, /media-player',
    api: '/climate/latest, /security/latest, /media/latest',
    status: 'implemented',
    evidence:
      'Native renders cabin, guard/security, and now-playing state from typed latest endpoints without spoofing controls.',
  },
  {
    id: 'safety-maintenance',
    label: 'Safety settings and maintenance',
    route: '/safety-settings, /maintenance',
    api: '/safety/latest, /maintenance, /maintenance/records',
    status: 'implemented',
    evidence:
      'Native renders read-only ADAS settings, deterministic maintenance items, and explicit unavailable write/AI states.',
  },
];

export function VehicleFleetView() {
  const vehiclesQuery = useVehicles();
  const vehicles = useMemo(
    () => vehiclesQuery.data ?? [],
    [vehiclesQuery.data],
  );
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(
    null,
  );

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

  const selectedVehicle =
    vehicles.find(vehicle => vehicle.id === selectedVehicleId) ?? null;
  const vehicleDetailQuery = useVehicle(selectedVehicleId);
  const vehicleStateQuery = useVehicleState(selectedVehicleId);
  const tirePressureQuery = useTirePressureLatest(selectedVehicleId);
  const climateQuery = useClimateLatest(selectedVehicleId);
  const securityQuery = useSecurityLatest(selectedVehicleId);
  const safetyQuery = useSafetyLatest(selectedVehicleId);
  const mediaQuery = useMediaLatest(selectedVehicleId);
  const vehicleConfigQuery = useVehicleConfigLatest(selectedVehicleId);
  const softwareUpdatesQuery = useSoftwareUpdates({
    vehicle_id: selectedVehicleId,
    limit: 8,
  });
  const maintenanceItemsQuery = useMaintenanceItems();
  const serviceRecordsQuery = useServiceRecords();
  const detailVehicle = vehicleDetailQuery.data ?? selectedVehicle;
  const liveState = vehicleStateQuery.data?.state;

  return (
    <View style={fleetStyles.root}>
      <VehicleFleetOverviewSection
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
      <LiveVehicleRouteSection
        vehicle={detailVehicle}
        liveState={liveState}
        isLoading={vehicleDetailQuery.isLoading || vehicleStateQuery.isLoading}
        hasError={Boolean(vehicleDetailQuery.error || vehicleStateQuery.error)}
      />
      <VehicleSystemsSection
        vehicle={detailVehicle}
        liveState={liveState}
        tirePressure={{
          data: tirePressureQuery.data,
          isLoading: tirePressureQuery.isLoading,
          hasError: Boolean(tirePressureQuery.error),
        }}
        climate={{
          data: climateQuery.data,
          isLoading: climateQuery.isLoading,
          hasError: Boolean(climateQuery.error),
        }}
        security={{
          data: securityQuery.data,
          isLoading: securityQuery.isLoading,
          hasError: Boolean(securityQuery.error),
        }}
        safety={{
          data: safetyQuery.data,
          isLoading: safetyQuery.isLoading,
          hasError: Boolean(safetyQuery.error),
        }}
        media={{
          data: mediaQuery.data,
          isLoading: mediaQuery.isLoading,
          hasError: Boolean(mediaQuery.error),
        }}
        vehicleConfig={{
          data: vehicleConfigQuery.data,
          isLoading: vehicleConfigQuery.isLoading,
          hasError: Boolean(vehicleConfigQuery.error),
        }}
        softwareUpdates={{
          data: softwareUpdatesQuery.data,
          isLoading: softwareUpdatesQuery.isLoading,
          hasError: Boolean(softwareUpdatesQuery.error),
        }}
        maintenanceItems={{
          data: maintenanceItemsQuery.data,
          isLoading: maintenanceItemsQuery.isLoading,
          hasError: Boolean(maintenanceItemsQuery.error),
        }}
        serviceRecords={{
          data: serviceRecordsQuery.data,
          isLoading: serviceRecordsQuery.isLoading,
          hasError: Boolean(serviceRecordsQuery.error),
        }}
      />
      <FleetRouteReadiness
        title="Vehicle route readiness"
        subtitle="Vehicle and vehicle-system routes are typed, visible, and statused without hiding unavailable native actions."
        items={vehicleReadinessItems}
      />
    </View>
  );
}
