import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSystemHealth, useSystemStatus } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { ListRow } from '../components/data/ListRow';
import { MetricGrid, type MetricGridItem } from '../components/data/MetricGrid';
import { spacing } from '../theme/tokens';
import type { SystemComponentStatus } from '../api/types';
import type { NativeWidgetProps } from './types';
import { WidgetCard } from './WidgetCard';
import { WidgetMessage } from './WidgetMessage';

const serviceKeys = [
  ['database', 'Database', 'database'],
  ['mqtt', 'MQTT', 'radioTower'],
  ['tesla_api', 'Tesla API', 'globe'],
  ['fleet_telemetry', 'Fleet telemetry', 'radio'],
] as const;

function statusState(status: string | undefined): 'offline' | 'online' | 'warning' {
  if (status === 'healthy' || status === 'ok' || status === 'online') {
    return 'online';
  }
  if (status === 'degraded' || status === 'warning' || status === 'unknown') {
    return 'warning';
  }
  return 'offline';
}

function componentStatus(
  components: Record<string, SystemComponentStatus> | undefined,
  key: string,
  fallback: SystemComponentStatus | undefined,
): SystemComponentStatus | undefined {
  return components?.[key] ?? fallback;
}

export function SystemStatusWidget(_props: NativeWidgetProps) {
  const statusQuery = useSystemStatus();
  const healthQuery = useSystemHealth();
  const status = statusQuery.data;
  const health = healthQuery.data;
  const overall = health?.status ?? status?.overall ?? status?.status ?? 'unknown';

  const services = useMemo(
    () =>
      serviceKeys.map(([key, label, icon]) => ({
        key,
        label,
        icon,
        status: componentStatus(
          health?.components,
          key,
          key === 'tesla_api' ? status?.tesla_api : status?.[key],
        ),
      })),
    [health?.components, status],
  );

  const healthyCount = services.filter(item =>
    ['healthy', 'ok', 'online'].includes(item.status?.status ?? ''),
  ).length;

  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'overall',
        label: 'Overall',
        value: overall,
        helper: health?.generated_at ? `Generated ${health.generated_at}` : 'System health endpoint',
        tone: statusState(overall) === 'online' ? 'success' : 'warning',
        icon: 'server',
      },
      {
        id: 'services',
        label: 'Services',
        value: `${healthyCount}/${services.length}`,
        helper: 'Healthy service count',
        tone: healthyCount === services.length ? 'success' : 'warning',
        icon: 'activity',
      },
      {
        id: 'version',
        label: 'Version',
        value: status?.version ?? '-',
        helper: status?.uptime ? `Uptime ${status.uptime}` : 'Backend version',
        tone: 'neutral',
        icon: 'package',
      },
    ],
    [health?.generated_at, healthyCount, overall, services.length, status?.uptime, status?.version],
  );

  return (
    <WidgetCard
      title="System status"
      subtitle="Backend health, dependencies, version, and readiness signals."
      icon="server"
      testID="widget-system-status"
      statusLabel={overall}
      statusState={statusState(overall)}>
      {statusQuery.isLoading && healthQuery.isLoading ? (
        <WidgetMessage
          title="Loading system status"
          message="Fetching status and health endpoints."
          icon="loading"
        />
      ) : statusQuery.error && healthQuery.error ? (
        <WidgetMessage
          title="System API unavailable"
          message="System status will appear when /system/status or /system/health is reachable."
          icon="warning"
        />
      ) : (
        <View style={styles.content}>
          <MetricGrid items={metrics} minItemWidth={150} />
          <View style={styles.list}>
            {services.map(service => (
              <ListRow
                key={service.key}
                title={service.label}
                subtitle={service.status?.last_error ?? 'No recent error reported'}
                meta={service.status?.status ?? 'unknown'}
                icon={service.icon}
              />
            ))}
          </View>
          <View>
            <KeyValueRow label="Service mode" value={health?.service_mode?.mode ?? '-'} />
            <KeyValueRow label="Fleet telemetry" value={status?.fleet_telemetry?.status ?? '-'} />
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
  list: {
    gap: spacing.sm,
  },
});

