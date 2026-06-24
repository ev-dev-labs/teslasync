import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useVehicleEnergy,
  useVehicleState,
  useVehicles,
} from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import {
  MetricGrid,
  type MetricGridItem,
} from '../components/data/MetricGrid';
import { formatEnergy, formatPower } from '../lib/format';
import { spacing } from '../theme/tokens';
import type { NativeWidgetProps } from './types';
import { WidgetCard } from './WidgetCard';
import { WidgetMessage } from './WidgetMessage';

export function LivePowerFlowWidget({ vehicleId }: NativeWidgetProps) {
  const vehiclesQuery = useVehicles();
  const vehicles = vehiclesQuery.data ?? [];
  const selectedVehicle =
    vehicles.find(vehicle => vehicle.id === vehicleId) ?? vehicles[0];
  const selectedVehicleId = selectedVehicle?.id ?? null;
  const stateQuery = useVehicleState(selectedVehicleId);
  const energyQuery = useVehicleEnergy(selectedVehicleId, 30);
  const state = stateQuery.data?.state;
  const energy = energyQuery.data;
  const powerW = state?.power_w ?? 0;

  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'live-power',
        label: 'Live power',
        value: formatPower(powerW),
        helper: state?.is_charging ? 'Charging input' : 'Vehicle power state',
        tone: state?.is_charging ? 'success' : powerW > 0 ? 'warning' : 'neutral',
        icon: 'powerShare',
      },
      {
        id: 'energy-used',
        label: 'Energy used',
        value: formatEnergy(energy?.total_energy_used_wh),
        helper: '30 day vehicle total',
        tone: 'neutral',
        icon: 'battery',
      },
      {
        id: 'energy-charged',
        label: 'Energy charged',
        value: formatEnergy(energy?.total_energy_charged_wh ?? energy?.total_wh),
        helper: '30 day charge total',
        tone: 'success',
        icon: 'charging',
      },
    ],
    [energy, powerW, state?.is_charging],
  );

  return (
    <WidgetCard
      title="Live power flow"
      subtitle="Native power-flow summary from live vehicle state and energy totals."
      icon="powerShare"
      testID="widget-live-power-flow"
      statusLabel={state?.is_charging ? 'Charging' : 'Summary'}
      statusState={stateQuery.error || energyQuery.error ? 'warning' : 'online'}
      footer="The native app renders a static power-flow summary instead of embedding the web animation or WebView.">
      {vehiclesQuery.isLoading ? (
        <WidgetMessage
          title="Loading power-flow context"
          message="Resolving a vehicle before reading live power and energy totals."
          icon="loading"
        />
      ) : !selectedVehicle ? (
        <WidgetMessage
          title="No power-flow vehicle"
          message="Power-flow evidence will appear when the fleet API returns a vehicle."
          icon="powerShare"
        />
      ) : stateQuery.error && energyQuery.error ? (
        <WidgetMessage
          title="Power-flow APIs unavailable"
          message="Live vehicle state and energy totals could not be loaded."
          icon="warning"
        />
      ) : (
        <View style={styles.content}>
          <MetricGrid items={metrics} minItemWidth={150} />
          <View>
            <KeyValueRow
              label="Vehicle"
              value={selectedVehicle.display_name ?? `Vehicle ${selectedVehicle.id}`}
            />
            <KeyValueRow
              label="Charging"
              value={state?.is_charging == null ? '-' : state.is_charging ? 'Yes' : 'No'}
            />
            <KeyValueRow
              label="Animated diagram"
              value="Native summary"
            />
            <KeyValueRow
              label="WebView"
              value="Not used"
            />
          </View>
        </View>
      )}
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
  },
});
