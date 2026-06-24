import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';

import {useVehicle, useVehicleState, useVehicles} from '../../api/hooks';
import {
  FleetRouteReadiness,
  type FleetRouteReadinessItem,
} from './FleetRouteReadiness';
import {fleetStyles} from './fleetStyles';
import {LiveVehicleRouteSection} from './LiveVehicleRouteSection';
import {VehicleDetailSection} from './VehicleDetailSection';
import {VehicleFleetOverviewSection} from './VehicleFleetOverviewSection';
import {VehicleListSection} from './VehicleListSection';

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
    status: 'native-summary',
    evidence:
      'Access routes are represented with typed route evidence; invite write actions remain visibly unavailable instead of being faked.',
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
    api: '/vehicles/{vehicleID}/state',
    status: 'native-summary',
    evidence:
      'The typed live state contract is surfaced as a native digital-twin summary with unsupported 3D rendering left unavailable.',
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
      <FleetRouteReadiness
        title="Vehicle route readiness"
        subtitle="Represented vehicle routes are typed and statused without hiding unavailable native actions."
        items={vehicleReadinessItems}
      />
    </View>
  );
}
