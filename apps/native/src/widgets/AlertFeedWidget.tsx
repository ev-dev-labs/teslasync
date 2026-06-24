import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAlerts } from '../api/hooks';
import { ListRow } from '../components/data/ListRow';
import { StatusPill } from '../components/ui/StatusPill';
import { formatDateTime } from '../lib/format';
import { spacing } from '../theme/tokens';
import type { Alert } from '../api/types';
import type { NativeWidgetProps } from './types';
import { WidgetCard } from './WidgetCard';
import { WidgetMessage } from './WidgetMessage';

function severityIcon(severity: string): 'severityCritical' | 'severityInfo' | 'severityWarn' {
  const normalized = severity.toLowerCase();
  if (normalized.includes('critical') || normalized.includes('error')) {
    return 'severityCritical';
  }
  if (normalized.includes('info') || normalized.includes('success')) {
    return 'severityInfo';
  }
  return 'severityWarn';
}

function unreadCount(alerts: Alert[]): number {
  return alerts.filter(alert => !alert.is_read).length;
}

export function AlertFeedWidget(_props: NativeWidgetProps) {
  const alertsQuery = useAlerts();
  const alerts = alertsQuery.data ?? [];
  const unread = unreadCount(alerts);

  return (
    <WidgetCard
      title="Alert feed"
      subtitle="Recent alert events with severity, unread state, and timestamps."
      icon="notifications"
      testID="widget-alert-feed"
      statusLabel={unread > 0 ? `${unread} unread` : 'Clear'}
      statusState={unread > 0 ? 'warning' : 'online'}>
      {alertsQuery.isLoading ? (
        <WidgetMessage
          title="Loading alerts"
          message="Fetching the latest fleet alert feed."
          icon="loading"
        />
      ) : alertsQuery.error ? (
        <WidgetMessage
          title="Alert API unavailable"
          message="Alert feed data will appear when the native client can reach /alerts."
          icon="warning"
        />
      ) : alerts.length === 0 ? (
        <WidgetMessage
          title="No alerts yet"
          message="Recent fleet warnings and notification events will appear here."
          icon="notificationsMuted"
        />
      ) : (
        <View style={styles.list}>
          {alerts.slice(0, 5).map(alert => (
            <ListRow
              key={alert.id}
              title={alert.title || 'Untitled alert'}
              subtitle={alert.message || 'No alert details provided.'}
              meta={formatDateTime(alert.created_at)}
              icon={severityIcon(alert.severity)}
              detail={<StatusPill label={alert.severity || 'unknown'} state={alert.is_read ? 'online' : 'warning'} />}
            />
          ))}
        </View>
      )}
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
});

