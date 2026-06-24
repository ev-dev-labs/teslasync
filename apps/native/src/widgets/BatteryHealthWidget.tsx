import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useBatteryHealth, useVehicleState, useVehicles } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { MetricGrid, type MetricGridItem } from '../components/data/MetricGrid';
import { AppText } from '../components/ui/AppText';
import { colors, spacing } from '../theme/tokens';
import type { NativeWidgetProps } from './types';
import { WidgetCard } from './WidgetCard';
import { WidgetMessage } from './WidgetMessage';

function formatPercent(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '-' : `${Math.round(value)}%`;
}

function healthTone(score: number | null | undefined): 'danger' | 'success' | 'warning' {
  if (score == null || Number.isNaN(score)) {
    return 'warning';
  }
  if (score >= 80) {
    return 'success';
  }
  if (score >= 50) {
    return 'warning';
  }
  return 'danger';
}

export function BatteryHealthWidget({vehicleId}: NativeWidgetProps) {
  const vehiclesQuery = useVehicles();
  const vehicles = vehiclesQuery.data ?? [];
  const selectedVehicle = vehicles.find(vehicle => vehicle.id === vehicleId) ?? vehicles[0];
  const selectedVehicleId = selectedVehicle?.id ?? null;
  const stateQuery = useVehicleState(selectedVehicleId);
  const healthQuery = useBatteryHealth(selectedVehicleId);
  const state = stateQuery.data?.state;
  const health = healthQuery.data;

  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'soc',
        label: 'State of charge',
        value: formatPercent(state?.battery_level),
        helper: state?.is_charging ? 'Charging session active' : 'Latest vehicle state',
        tone: state?.is_charging ? 'success' : 'neutral',
        icon: state?.is_charging ? 'batteryCharging' : 'battery',
      },
      {
        id: 'health',
        label: 'Health score',
        value: formatPercent(health?.health_score),
        helper: health ? `${health.degradation_pct.toFixed(1)}% degradation` : 'Battery endpoint',
        tone: healthTone(health?.health_score),
        icon: 'heartPulse',
      },
      {
        id: 'cycles',
        label: 'Cycles',
        value: health?.total_cycles ?? '-',
        helper: 'Lifetime charge cycles',
        tone: 'neutral',
        icon: 'recycle',
      },
    ],
    [health, state],
  );

  const barWidth = Math.max(Math.min(state?.battery_level ?? 0, 100), 0);

  return (
    <WidgetCard
      title="Battery and health"
      subtitle="Battery level, health score, cycle count, and capacity trend anchors."
      icon="battery"
      testID="widget-battery-health"
      statusLabel={state?.is_charging ? 'Charging' : 'Battery'}
      statusState={state?.is_charging ? 'online' : healthQuery.error ? 'warning' : 'online'}
      footer={
        healthQuery.error
          ? 'Battery health analytics are unavailable; live state of charge is still shown when present.'
          : undefined
      }>
      {vehiclesQuery.isLoading ? (
        <WidgetMessage
          title="Loading battery data"
          message="Resolving a dashboard vehicle before reading battery endpoints."
          icon="loading"
        />
      ) : !selectedVehicle ? (
        <WidgetMessage
          title="No battery vehicle"
          message="Battery cards will populate when the fleet API returns a vehicle."
          icon="battery"
        />
      ) : stateQuery.isLoading && healthQuery.isLoading ? (
        <WidgetMessage
          title="Loading battery endpoints"
          message="Fetching live vehicle state and battery health analytics."
          icon="loading"
        />
      ) : (
        <View style={styles.content}>
          <View>
            <View style={styles.progressHeader}>
              <AppText weight="semibold">Live battery</AppText>
              <AppText weight="bold" tone="accent">
                {formatPercent(state?.battery_level)}
              </AppText>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, {width: `${barWidth}%`}]} />
            </View>
          </View>
          <MetricGrid items={metrics} minItemWidth={150} />
          <View>
            <KeyValueRow
              label="Current capacity"
              value={formatPercent(health?.current_capacity_pct)}
            />
            <KeyValueRow
              label="Current range"
              value={health ? `${health.estimated_range_current_km.toFixed(0)} km` : '-'}
            />
            <KeyValueRow
              label="New range baseline"
              value={health ? `${health.estimated_range_new_km.toFixed(0)} km` : '-'}
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
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  track: {
    height: 14,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    minWidth: 4,
    borderRadius: 999,
    backgroundColor: colors.success,
  },
});

