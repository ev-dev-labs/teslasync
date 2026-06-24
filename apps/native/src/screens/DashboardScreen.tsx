import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useAlerts, useSystemStatus, useVehicles } from '../api/hooks';
import { SectionHeader } from '../components/data/SectionHeader';
import { AppButton } from '../components/ui/AppButton';
import { AppText } from '../components/ui/AppText';
import { GlassPanel } from '../components/ui/GlassPanel';
import { MetricCard } from '../components/ui/MetricCard';
import { StatusPill } from '../components/ui/StatusPill';
import { colors, spacing } from '../theme/tokens';
import {
  IMPLEMENTED_NATIVE_WIDGETS,
  NATIVE_WIDGET_REGISTRY,
  PENDING_NATIVE_WIDGETS,
} from '../widgets';

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

  const refresh = () => {
    queryClient.invalidateQueries();
  };

  const selectedVehicleId = vehicles[0]?.id;

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
        <MetricCard
          label="Widgets"
          value={`${IMPLEMENTED_NATIVE_WIDGETS.length}/${NATIVE_WIDGET_REGISTRY.length}`}
          helper={`${PENDING_NATIVE_WIDGETS.length} pending web widget groups tracked`}
          tone="accent"
        />
      </View>

      <GlassPanel style={styles.registryPanel}>
        <SectionHeader
          title="Native widget registry"
          subtitle="Dashboard widgets are typed, statused, and mapped back to web dashboard concepts."
          icon="layoutDashboard"
        />
        <View style={styles.registryList}>
          {NATIVE_WIDGET_REGISTRY.map(widget => (
            <View key={widget.id} style={styles.registryItem}>
              <View style={styles.registryItemHeader}>
                <AppText weight="semibold" style={styles.registryTitle}>
                  {widget.title}
                </AppText>
                <StatusPill
                  label={widget.status === 'implemented' ? 'Implemented' : 'Pending'}
                  state={widget.status === 'implemented' ? 'online' : 'warning'}
                />
              </View>
              <AppText variant="caption" tone="muted">
                {widget.status === 'implemented'
                  ? `Implemented: ${widget.description}`
                  : `Pending: ${widget.pendingReason}`}
              </AppText>
            </View>
          ))}
        </View>
        <View style={styles.actions}>
          <AppButton label={isRefreshing ? 'Refreshing...' : 'Refresh all widgets'} onPress={refresh} />
          <AppButton label="API /api/v1" onPress={refresh} variant="ghost" />
        </View>
      </GlassPanel>

      <View style={styles.widgetGrid}>
        {IMPLEMENTED_NATIVE_WIDGETS.map(widget => {
          const Widget = widget.component;
          return <Widget key={widget.id} vehicleId={selectedVehicleId} />;
        })}
      </View>
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
  registryPanel: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
  registryList: {
    gap: spacing.sm,
  },
  registryItem: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  registryItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  registryTitle: {
    flex: 1,
    minWidth: 0,
  },
  widgetGrid: {
    gap: spacing.lg,
  },
});
