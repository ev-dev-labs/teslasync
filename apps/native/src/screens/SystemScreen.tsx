import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useSystemStatus } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { ScreenSection } from '../components/data/ScreenSection';
import { EmptyState } from '../components/feedback/EmptyState';
import { StatusPill } from '../components/ui/StatusPill';
import { spacing } from '../theme/tokens';

export function SystemScreen() {
  const systemQuery = useSystemStatus();
  const status = systemQuery.data;
  const services = Object.entries(status?.services ?? {}).slice(0, 12);

  return (
    <View style={styles.root}>
      <ScreenSection
        title="System status"
        subtitle="Native operational readiness view for backend health and services.">
        <StatusPill
          label={status?.status ?? (status?.healthy ? 'healthy' : 'unknown')}
          state={status?.healthy ? 'online' : systemQuery.error ? 'offline' : 'warning'}
        />
        <KeyValueRow label="Version" value={status?.version ?? '-'} />
        <KeyValueRow label="Uptime" value={status?.uptime ?? '-'} />
      </ScreenSection>

      <ScreenSection title="Services" subtitle="Service health details from /system/status.">
        {services.length === 0 ? (
          <EmptyState
            title={systemQuery.isLoading ? 'Loading services' : 'No service map returned'}
            message={
              systemQuery.error
                ? 'System endpoint is unavailable from this native client.'
                : 'Service status rows will appear here when the backend includes them.'
            }
          />
        ) : (
          services.map(([key, value]) => (
            <KeyValueRow key={key} label={key} value={String(value ?? '-')} />
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
});
