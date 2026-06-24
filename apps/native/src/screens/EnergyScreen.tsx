import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useVehicleEnergy, useVehicles } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { ScreenSection } from '../components/data/ScreenSection';
import { EmptyState } from '../components/feedback/EmptyState';
import { AppText } from '../components/ui/AppText';
import { spacing } from '../theme/tokens';

export function EnergyScreen() {
  const vehiclesQuery = useVehicles();
  const vehicles = useMemo(() => vehiclesQuery.data ?? [], [vehiclesQuery.data]);
  const selectedVehicle = vehicles[0] ?? null;
  const energyQuery = useVehicleEnergy(selectedVehicle?.id ?? null);
  const energy = energyQuery.data ?? {};
  const rows = Object.entries(energy)
    .filter(([, value]) => value == null || ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 10);

  return (
    <View style={styles.root}>
      <ScreenSection
        title="Energy overview"
        subtitle="Native read of /vehicles/{id}/energy for the first available vehicle.">
        {selectedVehicle == null ? (
          <EmptyState
            title={vehiclesQuery.isLoading ? 'Loading vehicles' : 'No vehicle selected'}
            message="Energy parity needs a vehicle from /vehicles before it can query battery intelligence."
          />
        ) : (
          <View style={styles.vehicleHeader}>
            <AppText weight="bold">{selectedVehicle.display_name}</AppText>
            <AppText tone="secondary">Vehicle #{selectedVehicle.id}</AppText>
          </View>
        )}

        {selectedVehicle != null && rows.length === 0 ? (
          <EmptyState
            title={energyQuery.isLoading ? 'Loading energy data' : 'No energy fields returned'}
            message={
              energyQuery.error
                ? 'Energy endpoint is unavailable from this native client.'
                : 'Battery and energy fields will appear here as the endpoint returns data.'
            }
          />
        ) : (
          rows.map(([key, value]) => (
            <KeyValueRow key={key} label={key} value={value == null ? '-' : String(value)} />
          ))
        )}
      </ScreenSection>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  vehicleHeader: {
    gap: spacing.xs,
  },
});
