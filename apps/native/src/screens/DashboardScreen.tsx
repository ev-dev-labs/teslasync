import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useAlerts, useSystemStatus, useVehicles } from '../api/hooks';
import { MiniBarChart } from '../components/charts/MiniBarChart';
import { EmptyState } from '../components/feedback/EmptyState';
import { AppButton } from '../components/ui/AppButton';
import { AppText } from '../components/ui/AppText';
import { GlassPanel } from '../components/ui/GlassPanel';
import { MetricCard } from '../components/ui/MetricCard';
import { StatusPill } from '../components/ui/StatusPill';
import { colors, spacing } from '../theme/tokens';

export function DashboardScreen() {
  const queryClient = useQueryClient();
  const vehiclesQuery = useVehicles();
  const alertsQuery = useAlerts();
  const systemQuery = useSystemStatus();
  const vehicles = useMemo(() => vehiclesQuery.data ?? [], [vehiclesQuery.data]);
  const alerts = useMemo(() => alertsQuery.data ?? [], [alertsQuery.data]);
  const healthyVehicles = vehicles.filter(vehicle => vehicle.healthy).length;
  const unreadAlerts = alerts.filter(alert => !alert.is_read).length;
  const isRefreshing =
    vehiclesQuery.isFetching || alertsQuery.isFetching || systemQuery.isFetching;

  const stateBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const vehicle of vehicles) {
      const state = vehicle.state || 'unknown';
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([label, value]) => ({label, value}));
  }, [vehicles]);

  const refresh = () => {
    void queryClient.invalidateQueries();
  };

  return (
    <View style={styles.root}>
      <View style={styles.metrics}>
        <MetricCard
          label="Vehicles"
          value={vehicles.length}
          helper={`${healthyVehicles} healthy`}
          tone={healthyVehicles === vehicles.length && vehicles.length > 0 ? 'accent' : 'neutral'}
        />
        <MetricCard
          label="Unread alerts"
          value={unreadAlerts}
          helper={alertsQuery.error ? 'Alert API unavailable' : 'Latest fleet events'}
          tone={unreadAlerts > 0 ? 'danger' : 'accent'}
        />
        <MetricCard
          label="System"
          value={systemQuery.data?.status ?? (systemQuery.data?.healthy ? 'healthy' : '—')}
          helper={systemQuery.error ? 'Status endpoint unavailable' : 'Backend health'}
          tone={systemQuery.data?.healthy ? 'accent' : 'neutral'}
        />
      </View>

      <GlassPanel style={styles.hero}>
        <View style={styles.heroHeader}>
          <View>
            <AppText variant="title" weight="bold">
              Native parity proof
            </AppText>
            <AppText tone="secondary">
              The first React Native shell reads the same TeslaSync API without web views.
            </AppText>
          </View>
          <StatusPill
            label={vehiclesQuery.error ? 'API offline' : 'API wired'}
            state={vehiclesQuery.error ? 'warning' : 'online'}
          />
        </View>

        {vehicles.length > 0 ? (
          <MiniBarChart
            title="Vehicle states"
            values={stateBreakdown}
            emptyLabel="No vehicle state data yet."
          />
        ) : (
          <EmptyState
            title={vehiclesQuery.isLoading ? 'Loading fleet' : 'No vehicles returned'}
            message={
              vehiclesQuery.error
                ? 'Connect to a TeslaSync API host to populate live fleet data.'
                : 'Fleet cards will render here as soon as vehicles are available.'
            }
          />
        )}

        <View style={styles.actions}>
          <AppButton label={isRefreshing ? 'Refreshing...' : 'Refresh'} onPress={refresh} />
          <AppButton label="API /api/v1" onPress={refresh} variant="ghost" />
        </View>
      </GlassPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  hero: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
});
