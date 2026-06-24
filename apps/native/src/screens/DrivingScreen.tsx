import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useDrives } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { ScreenSection } from '../components/data/ScreenSection';
import { EmptyState } from '../components/feedback/EmptyState';
import { AppText } from '../components/ui/AppText';
import { formatDateTime, formatDistance, formatDuration, formatEnergy } from '../lib/format';
import { spacing } from '../theme/tokens';

export function DrivingScreen() {
  const drivesQuery = useDrives();
  const drives = drivesQuery.data ?? [];

  return (
    <View style={styles.root}>
      <ScreenSection
        title="Recent drives"
        subtitle="First native driving parity slice for trips, energy, distance, and duration.">
        {drives.length === 0 ? (
          <EmptyState
            title={drivesQuery.isLoading ? 'Loading drives' : 'No drives returned'}
            message={
              drivesQuery.error
                ? 'Drive API is unavailable from this native client.'
                : 'Recent trips, scoring, and replay metadata will render here.'
            }
          />
        ) : (
          drives.map(drive => (
            <View key={drive.id} style={styles.card}>
              <AppText weight="bold">Drive #{drive.id}</AppText>
              <AppText tone="secondary">{formatDateTime(drive.start_ts)}</AppText>
              <KeyValueRow label="Distance" value={formatDistance(drive.distance_m)} />
              <KeyValueRow label="Duration" value={formatDuration(drive.duration_s)} />
              <KeyValueRow label="Energy used" value={formatEnergy(drive.energy_used_wh)} />
              <KeyValueRow label="Score" value={drive.score ?? '-'} />
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
});
