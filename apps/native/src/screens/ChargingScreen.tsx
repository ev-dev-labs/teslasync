import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useChargingSessions } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { ScreenSection } from '../components/data/ScreenSection';
import { EmptyState } from '../components/feedback/EmptyState';
import { AppText } from '../components/ui/AppText';
import { StatusPill } from '../components/ui/StatusPill';
import { formatDateTime, formatEnergy, formatPower } from '../lib/format';
import { spacing } from '../theme/tokens';

export function ChargingScreen() {
  const chargingQuery = useChargingSessions();
  const sessions = chargingQuery.data ?? [];

  return (
    <View style={styles.root}>
      <ScreenSection
        title="Charging sessions"
        subtitle="Native session list wired to /charging with SI display conversion.">
        {sessions.length === 0 ? (
          <EmptyState
            title={chargingQuery.isLoading ? 'Loading sessions' : 'No charging sessions'}
            message={
              chargingQuery.error
                ? 'Charging API is unavailable from this native client.'
                : 'Charging history, live sessions, and energy totals will appear here.'
            }
          />
        ) : (
          sessions.map(session => (
            <View key={session.id} style={styles.card}>
              <View style={styles.header}>
                <View>
                  <AppText weight="bold">Session #{session.id}</AppText>
                  <AppText tone="secondary">{formatDateTime(session.started_at)}</AppText>
                </View>
                <StatusPill
                  label={session.live ? 'Live' : session.ended_at ? 'Complete' : 'Open'}
                  state={session.live ? 'online' : 'warning'}
                />
              </View>
              <KeyValueRow label="Energy added" value={formatEnergy(session.total_energy_added_wh)} />
              <KeyValueRow label="Peak power" value={formatPower(session.peak_power_w)} />
              <KeyValueRow label="Start SOC" value={`${session.start_soc_pct ?? '-'}%`} />
              <KeyValueRow label="End SOC" value={`${session.end_soc_pct ?? '-'}%`} />
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
});
