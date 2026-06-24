import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useChargingSessions, useVehicles, type DateRangeOptions } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { MetricGrid, type MetricGridItem } from '../components/data/MetricGrid';
import { formatDateTime, formatDuration, formatEnergy, formatPower } from '../lib/format';
import { spacing } from '../theme/tokens';
import type { ChargingSession } from '../api/types';
import type { NativeWidgetProps } from './types';
import { WidgetCard } from './WidgetCard';
import { WidgetMessage } from './WidgetMessage';

function sessionDuration(session: ChargingSession | undefined): string {
  if (!session?.started_at || !session.ended_at) {
    return session?.live ? 'Live' : '-';
  }

  const start = new Date(session.started_at).getTime();
  const end = new Date(session.ended_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return '-';
  }

  return formatDuration((end - start) / 1000);
}

export function ChargingSummaryWidget({vehicleId}: NativeWidgetProps) {
  const vehiclesQuery = useVehicles();
  const selectedVehicle = (vehiclesQuery.data ?? []).find(vehicle => vehicle.id === vehicleId) ??
    vehiclesQuery.data?.[0];
  const options = useMemo<DateRangeOptions>(
    () => ({
      vehicle_id: selectedVehicle?.id,
      limit: 5,
    }),
    [selectedVehicle?.id],
  );
  const sessionsQuery = useChargingSessions(options);
  const sessions = sessionsQuery.data ?? [];
  const latest = sessions[0];
  const totalEnergyWh = sessions.reduce(
    (sum, session) => sum + (session.total_energy_added_wh ?? 0),
    0,
  );

  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'energy',
        label: 'Energy added',
        value: formatEnergy(totalEnergyWh),
        helper: 'Total from latest five sessions',
        tone: 'success',
        icon: 'charging',
      },
      {
        id: 'peak',
        label: 'Peak power',
        value: formatPower(latest?.peak_power_w),
        helper: 'Latest session peak',
        tone: 'warning',
        icon: 'bolt',
      },
      {
        id: 'sessions',
        label: 'Sessions',
        value: sessions.length,
        helper: latest?.live ? 'Live session included' : 'Recent charging history',
        tone: latest?.live ? 'success' : 'neutral',
        icon: 'charger',
      },
    ],
    [latest, sessions.length, totalEnergyWh],
  );

  return (
    <WidgetCard
      title="Charging summary"
      subtitle="Latest charge session rollup with energy, power, duration, and SOC."
      icon="charging"
      testID="widget-charging-summary"
      statusLabel={latest?.live ? 'Live' : 'Charging'}
      statusState={sessionsQuery.error ? 'warning' : latest?.live ? 'online' : 'online'}>
      {sessionsQuery.isLoading ? (
        <WidgetMessage
          title="Loading charging"
          message="Fetching recent charging sessions for dashboard summary."
          icon="loading"
        />
      ) : sessionsQuery.error ? (
        <WidgetMessage
          title="Charging API unavailable"
          message="Charging summary data will appear when /charging is reachable."
          icon="warning"
        />
      ) : sessions.length === 0 ? (
        <WidgetMessage
          title="No charge sessions"
          message="Energy, power, and SOC rollups will appear after charging history exists."
          icon="charger"
        />
      ) : (
        <View style={styles.content}>
          <MetricGrid items={metrics} minItemWidth={150} />
          <View>
            <KeyValueRow label="Latest start" value={formatDateTime(latest?.started_at)} />
            <KeyValueRow label="Duration" value={sessionDuration(latest)} />
            <KeyValueRow
              label="State of charge"
              value={`${latest?.start_soc_pct ?? '-'}% -> ${latest?.end_soc_pct ?? '-'}%`}
            />
            <KeyValueRow label="Charger" value={latest?.charger_type ?? '-'} />
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

