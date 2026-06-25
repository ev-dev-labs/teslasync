import React from 'react';
import {View} from 'react-native';

import type {Vehicle} from '../../api/types';
import {KeyValueRow} from '../../components/data/KeyValueRow';
import {ListRow} from '../../components/data/ListRow';
import {ScreenSection} from '../../components/data/ScreenSection';
import {FleetMessage} from './FleetMessage';
import {fleetStyles} from './fleetStyles';
import {formatDateTime, shortVin} from './formatFleetValue';

interface VehicleListSectionProps {
  vehicles: Vehicle[];
  selectedVehicleId: number | null;
  isLoading: boolean;
  hasError: boolean;
  onSelect: (vehicleId: number) => void;
}

export function VehicleListSection({
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
        <View style={fleetStyles.list}>
          {vehicles.map(vehicle => (
            <ListRow
              key={vehicle.id}
              title={vehicle.display_name || `Vehicle ${vehicle.vehicle_id}`}
              subtitle={
                [vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ') ||
                'Tesla vehicle'
              }
              meta={vehicle.id === selectedVehicleId ? 'Selected' : vehicle.state || 'unknown'}
              icon="vehicle"
              selected={vehicle.id === selectedVehicleId}
              tone={vehicle.healthy ? 'success' : 'warning'}
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
