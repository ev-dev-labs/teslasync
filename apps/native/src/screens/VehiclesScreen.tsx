import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useVehicles } from '../api/hooks';
import { EmptyState } from '../components/feedback/EmptyState';
import { AppText } from '../components/ui/AppText';
import { GlassPanel } from '../components/ui/GlassPanel';
import { StatusPill } from '../components/ui/StatusPill';
import { spacing } from '../theme/tokens';

export function VehiclesScreen() {
  const vehiclesQuery = useVehicles();
  const vehicles = vehiclesQuery.data ?? [];

  return (
    <View style={styles.root}>
      {vehicles.length === 0 ? (
        <GlassPanel style={styles.panel}>
          <EmptyState
            title={vehiclesQuery.isLoading ? 'Loading vehicles' : 'No vehicles yet'}
            message={
              vehiclesQuery.error
                ? 'Vehicle cards will appear when the native app can reach the TeslaSync API.'
                : 'The garage will show every vehicle, health state, model, and last update.'
            }
          />
        </GlassPanel>
      ) : (
        vehicles.map(vehicle => (
          <GlassPanel key={vehicle.id} style={styles.vehicleCard}>
            <View style={styles.vehicleHeader}>
              <View>
                <AppText variant="title" weight="bold">
                  {vehicle.display_name || `Vehicle ${vehicle.vehicle_id}`}
                </AppText>
                <AppText tone="secondary">
                  {[vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ') || 'Tesla vehicle'}
                </AppText>
              </View>
              <StatusPill
                label={vehicle.healthy ? 'Healthy' : 'Needs attention'}
                state={vehicle.healthy ? 'online' : 'warning'}
              />
            </View>

            <View style={styles.metaGrid}>
              <Meta label="State" value={vehicle.state || 'unknown'} />
              <Meta label="VIN" value={vehicle.vin ? `...${vehicle.vin.slice(-6)}` : '—'} />
              <Meta label="Color" value={vehicle.exterior_color || '—'} />
              <Meta label="Timezone" value={vehicle.timezone ?? '—'} />
            </View>
          </GlassPanel>
        ))
      )}
    </View>
  );
}

interface MetaProps {
  label: string;
  value: string;
}

function Meta({label, value}: MetaProps) {
  return (
    <View style={styles.meta}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText weight="semibold">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.lg,
  },
  vehicleCard: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  vehicleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  meta: {
    minWidth: 150,
    gap: spacing.xs,
  },
});
