import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAlerts } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { ScreenSection } from '../components/data/ScreenSection';
import { EmptyState } from '../components/feedback/EmptyState';
import { AppText } from '../components/ui/AppText';
import { StatusPill } from '../components/ui/StatusPill';
import { formatDateTime } from '../lib/format';
import { spacing } from '../theme/tokens';

export function AlertsScreen() {
  const alertsQuery = useAlerts();
  const alerts = alertsQuery.data ?? [];

  return (
    <View style={styles.root}>
      <ScreenSection
        title="Notification inbox"
        subtitle="Native view over /alerts with unread and severity state.">
        {alerts.length === 0 ? (
          <EmptyState
            title={alertsQuery.isLoading ? 'Loading alerts' : 'No alerts returned'}
            message={
              alertsQuery.error
                ? 'Connect to TeslaSync API to load alert state.'
                : 'Unread alerts, rules, and escalation details will appear here.'
            }
          />
        ) : (
          alerts.map(alert => (
            <View key={alert.id} style={styles.card}>
              <View style={styles.header}>
                <View style={styles.copy}>
                  <AppText weight="bold">{alert.title || `Alert ${alert.id}`}</AppText>
                  <AppText tone="secondary">{alert.message || 'No alert message provided.'}</AppText>
                </View>
                <StatusPill
                  label={alert.severity || 'info'}
                  state={alert.severity === 'critical' ? 'offline' : 'warning'}
                />
              </View>
              <KeyValueRow label="Created" value={formatDateTime(alert.created_at)} />
              <KeyValueRow label="Read" value={alert.is_read ? 'yes' : 'no'} />
            </View>
          ))
        )}
      </ScreenSection>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  card: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
});
