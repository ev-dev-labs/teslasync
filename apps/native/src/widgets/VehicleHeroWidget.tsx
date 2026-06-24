import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useVehicleState, useVehicles } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { MetricGrid, type MetricGridItem } from '../components/data/MetricGrid';
import { AppText } from '../components/ui/AppText';
import { StatusPill } from '../components/ui/StatusPill';
import { formatPower } from '../lib/format';
import { colors, spacing } from '../theme/tokens';
import type { NativeWidgetProps } from './types';
import { WidgetCard } from './WidgetCard';
import { WidgetMessage } from './WidgetMessage';

function formatPercent(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '-' : `${Math.round(value)}%`;
}

function formatSpeed(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '-' : `${(value * 3.6).toFixed(0)} km/h`;
}

function vehicleStatus(state: string | undefined, healthy: boolean) {
  if (!healthy) {
    return {label: 'Needs attention', state: 'warning' as const};
  }
  if (state === 'online' || state === 'driving' || state === 'charging') {
    return {label: state, state: 'online' as const};
  }
  return {label: state || 'unknown', state: 'warning' as const};
}

export function VehicleHeroWidget({vehicleId}: NativeWidgetProps) {
  const vehiclesQuery = useVehicles();
  const vehicle = useMemo(
    () => {
      const vehicles = vehiclesQuery.data ?? [];
      return vehicles.find(item => item.id === vehicleId) ?? vehicles[0];
    },
    [vehicleId, vehiclesQuery.data],
  );
  const liveStateQuery = useVehicleState(vehicle?.id ?? null);
  const liveState = liveStateQuery.data?.state;
  const status = vehicleStatus(liveState?.state ?? vehicle?.state, vehicle?.healthy ?? false);

  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'battery',
        label: 'Battery',
        value: formatPercent(liveState?.battery_level),
        helper: liveState?.is_charging ? 'Charging now' : 'Current state of charge',
        tone: liveState?.is_charging ? 'success' : 'neutral',
        icon: liveState?.is_charging ? 'batteryCharging' : 'battery',
      },
      {
        id: 'speed',
        label: 'Speed',
        value: formatSpeed(liveState?.speed_mps),
        helper: 'Live SI telemetry converted for display',
        tone: (liveState?.speed_mps ?? 0) > 0 ? 'accent' : 'neutral',
        icon: 'speed',
      },
      {
        id: 'power',
        label: 'Power',
        value: formatPower(liveState?.power_w),
        helper: 'Instant traction or charge power',
        tone: (liveState?.power_w ?? 0) > 0 ? 'warning' : 'neutral',
        icon: 'power',
      },
    ],
    [liveState],
  );

  return (
    <WidgetCard
      title="Vehicle hero"
      subtitle="Native card for fleet identity, state, battery, and live telemetry."
      icon="vehicle"
      testID="widget-vehicle-hero"
      statusLabel={status.label}
      statusState={status.state}
      footer={
        liveStateQuery.error
          ? 'Vehicle state endpoint is unavailable; static vehicle metadata is still shown.'
          : undefined
      }>
      {vehiclesQuery.isLoading ? (
        <WidgetMessage
          title="Loading vehicle"
          message="Fetching the first TeslaSync vehicle for the dashboard hero."
          icon="loading"
        />
      ) : vehiclesQuery.error && !vehicle ? (
        <WidgetMessage
          title="Vehicle API unavailable"
          message="Connect the native app to a TeslaSync API host to populate the hero."
          icon="warning"
        />
      ) : vehicle ? (
        <View style={styles.content}>
          <View style={styles.heroRow}>
            <View style={styles.vehicleMark}>
              <AppText variant="display" weight="bold" style={styles.vehicleInitial}>
                {(vehicle.display_name || 'T').slice(0, 1).toUpperCase()}
              </AppText>
            </View>
            <View style={styles.copy}>
              <AppText variant="display" weight="bold">
                {vehicle.display_name || `Vehicle ${vehicle.vehicle_id}`}
              </AppText>
              <AppText tone="secondary">
                {[vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ') ||
                  'Tesla vehicle'}
              </AppText>
              <View style={styles.pills}>
                <StatusPill
                  label={liveState?.is_locked === false ? 'Unlocked' : 'Locked'}
                  state={liveState?.is_locked === false ? 'warning' : 'online'}
                />
                <StatusPill
                  label={liveStateQuery.isFetching ? 'Syncing' : 'Telemetry'}
                  state={liveStateQuery.error ? 'warning' : 'online'}
                />
              </View>
            </View>
          </View>
          <MetricGrid items={metrics} minItemWidth={150} />
          <View>
            <KeyValueRow label="VIN" value={vehicle.vin ? `...${vehicle.vin.slice(-6)}` : '-'} />
            <KeyValueRow label="Firmware" value={liveState?.software_version ?? '-'} />
            <KeyValueRow label="Timezone" value={vehicle.timezone ?? '-'} />
          </View>
        </View>
      ) : (
        <WidgetMessage
          title="No vehicles returned"
          message="Fleet hero data will appear as soon as the API returns at least one vehicle."
          icon="vehicle"
        />
      )}
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
  },
  heroRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'center',
  },
  vehicleMark: {
    width: 88,
    height: 88,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSelected,
    borderWidth: 1,
    borderColor: colors.borderAccent,
  },
  vehicleInitial: {
    color: colors.accent,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
