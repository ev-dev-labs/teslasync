import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useAlerts, useSystemStatus, useVehicles } from '../api/hooks';
import { SectionHeader } from '../components/data/SectionHeader';
import {
  RouteReadinessPanel,
  type RouteReadinessItem,
} from '../components/data/RouteReadinessPanel';
import {
  ChartSummary,
  type ChartSummaryDatum,
} from '../components/charts/ChartSummary';
import { AppButton } from '../components/ui/AppButton';
import { AppText } from '../components/ui/AppText';
import { GlassPanel } from '../components/ui/GlassPanel';
import { MetricCard } from '../components/ui/MetricCard';
import { StatusPill } from '../components/ui/StatusPill';
import type { RouteId } from '../navigation/routes';
import { colors, spacing } from '../theme/tokens';
import {
  IMPLEMENTED_NATIVE_WIDGETS,
  NATIVE_WIDGET_REGISTRY,
  PENDING_NATIVE_WIDGETS,
} from '../widgets';

interface DashboardScreenProps {
  onNavigate?: (route: RouteId) => void;
}

const dashboardReadinessItems: RouteReadinessItem[] = [
  {
    id: 'quick-stats',
    label: 'Quick stats and glance',
    route: '/quick-stats, /glance',
    api: '/vehicles, /alerts, /system/status',
    status: 'native-summary',
    evidence:
      'Dashboard metrics render API-backed fleet, alert, system, and widget counts while dedicated quick-stat route parity remains deletion-blocked.',
  },
  {
    id: 'search',
    label: 'Search and route command',
    route: '/search',
    api: 'typed route manifest',
    status: 'native-summary',
    evidence:
      'The native shell resolves web paths through the typed route manifest; full global data search is not claimed in this slice.',
  },
  {
    id: 'analytics-summaries',
    label: 'Statistics, lifetime, weekly, and comparison summaries',
    route: '/statistics, /lifetime-stats, /weekly-digest, /period-compare',
    api: '/analytics/fleet plus mapped analytics routes',
    status: 'native-summary',
    evidence:
      'Dashboard widgets expose route-level evidence for analytics summaries without fabricating aggregate data not returned by the API.',
  },
  {
    id: 'assistant-explore',
    label: 'Explore, watch, chatbot, and anomaly routes',
    route: '/explore, /watch, /chatbot, /anomaly-detection',
    api: 'native route/widget registry',
    status: 'native-summary',
    evidence:
      'Unsupported command surfaces stay visible as native summaries; no browser shell, WebView, or fake assistant response is embedded.',
  },
];

export function DashboardScreen({ onNavigate }: DashboardScreenProps) {
  const queryClient = useQueryClient();
  const vehiclesQuery = useVehicles();
  const alertsQuery = useAlerts();
  const systemQuery = useSystemStatus();
  const vehicles = useMemo(
    () => vehiclesQuery.data ?? [],
    [vehiclesQuery.data],
  );
  const alerts = useMemo(() => alertsQuery.data ?? [], [alertsQuery.data]);
  const healthyVehicles = vehicles.filter(vehicle => vehicle.healthy).length;
  const unreadAlerts = alerts.filter(alert => !alert.is_read).length;
  const dashboardChartData = useMemo<ChartSummaryDatum[]>(
    () => [
      {
        id: 'vehicles',
        label: 'Vehicles',
        value: vehicles.length,
        formattedValue: String(vehicles.length),
        icon: 'vehicle',
      },
      {
        id: 'healthy',
        label: 'Healthy',
        value: healthyVehicles,
        formattedValue: String(healthyVehicles),
        icon: 'success',
      },
      {
        id: 'alerts',
        label: 'Unread alerts',
        value: unreadAlerts,
        formattedValue: String(unreadAlerts),
        icon: 'notifications',
      },
      {
        id: 'widgets',
        label: 'Native widgets',
        value: IMPLEMENTED_NATIVE_WIDGETS.length,
        formattedValue: `${IMPLEMENTED_NATIVE_WIDGETS.length}/${NATIVE_WIDGET_REGISTRY.length}`,
        icon: 'layoutDashboard',
      },
    ],
    [healthyVehicles, unreadAlerts, vehicles.length],
  );
  const isRefreshing =
    vehiclesQuery.isFetching ||
    alertsQuery.isFetching ||
    systemQuery.isFetching;

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
          tone={
            healthyVehicles === vehicles.length && vehicles.length > 0
              ? 'accent'
              : 'neutral'
          }
        />
        <MetricCard
          label="Unread alerts"
          value={unreadAlerts}
          helper={
            alertsQuery.error ? 'Alert API unavailable' : 'Latest fleet events'
          }
          tone={unreadAlerts > 0 ? 'danger' : 'accent'}
        />
        <MetricCard
          label="System"
          value={
            systemQuery.data?.status ??
            (systemQuery.data?.healthy ? 'healthy' : '—')
          }
          helper={
            systemQuery.error ? 'Status endpoint unavailable' : 'Backend health'
          }
          tone={systemQuery.data?.healthy ? 'accent' : 'neutral'}
        />
        <MetricCard
          label="Widgets"
          value={`${IMPLEMENTED_NATIVE_WIDGETS.length}/${NATIVE_WIDGET_REGISTRY.length}`}
          helper={
            PENDING_NATIVE_WIDGETS.length === 0
              ? 'All web widget groups implemented'
              : `${PENDING_NATIVE_WIDGETS.length} unresolved web widget groups tracked`
          }
          tone="accent"
        />
      </View>

      <ChartSummary
        title="Dashboard parity chart"
        subtitle="Universal native chart primitive summarizing dashboard route inputs without web-only libraries."
        metricLabel="Implemented widgets"
        metricValue={`${IMPLEMENTED_NATIVE_WIDGETS.length}/${NATIVE_WIDGET_REGISTRY.length}`}
        data={dashboardChartData}
        emptyLabel="Dashboard chart values will appear when native route inputs resolve."
        icon="layoutDashboard"
        sourceLabel="/vehicles, /alerts, /system/status, and native widget registry"
        parityStatusLabel="Dashboard chart parity"
      />

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
                  label={
                    widget.status === 'implemented'
                      ? 'Implemented'
                      : 'Unresolved'
                  }
                  state={widget.status === 'implemented' ? 'online' : 'warning'}
                />
              </View>
              <AppText variant="caption" tone="muted">
                {widget.status === 'implemented'
                  ? `Implemented: ${widget.description}`
                  : `Unresolved: ${widget.pendingReason}`}
              </AppText>
            </View>
          ))}
        </View>
        <View style={styles.actions}>
          <AppButton
            label={isRefreshing ? 'Refreshing...' : 'Refresh all widgets'}
            onPress={refresh}
          />
          <AppButton label="API /api/v1" onPress={refresh} variant="ghost" />
        </View>
      </GlassPanel>

      <RouteReadinessPanel
        title="Dashboard route readiness"
        subtitle="Command/dashboard web routes are visible as React Native summaries until dedicated deletion-ready parity exists."
        items={dashboardReadinessItems}
        testID="dashboard-route-readiness"
      />

      <View style={styles.widgetGrid}>
        {IMPLEMENTED_NATIVE_WIDGETS.map(widget => {
          const Widget = widget.component;
          return (
            <Widget
              key={widget.id}
              vehicleId={selectedVehicleId}
              onNavigate={onNavigate}
            />
          );
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
