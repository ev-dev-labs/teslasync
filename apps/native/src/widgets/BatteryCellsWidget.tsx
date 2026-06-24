import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useBatteryDegradationAnalytics,
  useBatteryHealth,
  useVehicles,
} from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import {
  MetricGrid,
  type MetricGridItem,
} from '../components/data/MetricGrid';
import { spacing } from '../theme/tokens';
import type { NativeWidgetProps } from './types';
import { WidgetCard } from './WidgetCard';
import { WidgetMessage } from './WidgetMessage';

function formatPercent(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '-' : `${value.toFixed(1)}%`;
}

function formatTemperature(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '-' : `${value.toFixed(1)} C`;
}

export function BatteryCellsWidget({ vehicleId }: NativeWidgetProps) {
  const vehiclesQuery = useVehicles();
  const vehicles = vehiclesQuery.data ?? [];
  const selectedVehicle =
    vehicles.find(vehicle => vehicle.id === vehicleId) ?? vehicles[0];
  const selectedVehicleId = selectedVehicle?.id ?? null;
  const healthQuery = useBatteryHealth(selectedVehicleId);
  const degradationQuery = useBatteryDegradationAnalytics(selectedVehicleId);
  const health = healthQuery.data;
  const degradation = degradationQuery.data;

  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'cell-health',
        label: 'Pack health',
        value: formatPercent(
          degradation?.current_health_pct ?? degradation?.current_health ?? health?.health_score,
        ),
        helper: 'API-backed pack health proxy',
        tone: 'success',
        icon: 'batteryFull',
      },
      {
        id: 'cell-temp',
        label: 'Avg cell temp',
        value: formatTemperature(degradation?.current_temp),
        helper: 'Degradation analytics temperature',
        tone: 'neutral',
        icon: 'climate',
      },
      {
        id: 'cell-heatmap',
        label: 'Cell heatmap',
        value: 'Unavailable',
        helper: 'No cell-voltage endpoint exposed',
        tone: 'warning',
        icon: 'cpu',
      },
    ],
    [degradation, health?.health_score],
  );

  return (
    <WidgetCard
      title="Battery cells"
      subtitle="Native battery-cell parity with pack-health data and explicit cell telemetry limits."
      icon="cpu"
      testID="widget-battery-cells"
      statusLabel="Native summary"
      statusState="warning"
      footer="Cell voltage heatmaps are not fabricated; the widget shows battery-health analytics and marks missing cell telemetry as unavailable.">
      {vehiclesQuery.isLoading ? (
        <WidgetMessage
          title="Loading battery cell context"
          message="Resolving a vehicle before reading battery analytics."
          icon="loading"
        />
      ) : !selectedVehicle ? (
        <WidgetMessage
          title="No battery cell vehicle"
          message="Cell parity evidence will appear when the fleet API returns a vehicle."
          icon="battery"
        />
      ) : healthQuery.error && degradationQuery.error ? (
        <WidgetMessage
          title="Battery cell APIs unavailable"
          message="Battery health and degradation endpoints could not be loaded."
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
              label="Current capacity"
              value={formatPercent(
                degradation?.current_capacity ?? health?.current_capacity_pct,
              )}
            />
            <KeyValueRow
              label="Degradation"
              value={formatPercent(
                degradation?.current_degradation ?? health?.degradation_pct,
              )}
            />
            <KeyValueRow
              label="Battery-cell endpoint"
              value="Unavailable"
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
