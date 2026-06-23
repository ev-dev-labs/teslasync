import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { apiUrl } from '../api/client';
import { EmptyState } from '../components/feedback/EmptyState';
import { AppText } from '../components/ui/AppText';
import { GlassPanel } from '../components/ui/GlassPanel';
import { StatusPill } from '../components/ui/StatusPill';
import { colors, spacing } from '../theme/tokens';

const platformRows = [
  {label: 'Android', status: 'generated'},
  {label: 'iOS', status: 'generated'},
  {label: 'Windows', status: 'generated via RNW WinAppSDK'},
  {label: 'macOS', status: 'dependency pinned; native project pending'},
];

export function SettingsScreen() {
  return (
    <View style={styles.root}>
      <GlassPanel style={styles.panel}>
        <View style={styles.panelHeader}>
          <View>
            <AppText variant="title" weight="bold">
              Platform foundation
            </AppText>
            <AppText tone="secondary">
              React Native baseline: Android, iOS, and Windows project scaffolds.
            </AppText>
          </View>
          <StatusPill label={Platform.OS} state="online" />
        </View>

        <View style={styles.rows}>
          {platformRows.map(row => (
            <View key={row.label} style={styles.row}>
              <AppText weight="semibold">{row.label}</AppText>
              <AppText tone="secondary">{row.status}</AppText>
            </View>
          ))}
        </View>
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <AppText variant="title" weight="bold">
          API contract
        </AppText>
        <AppText tone="secondary">
          Hooks call paths without an /api/v1 prefix; the native API client adds it.
        </AppText>
        <View style={styles.codeBox}>
          <AppText variant="caption">{apiUrl('/vehicles')}</AppText>
        </View>
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <EmptyState
          title="Next parity slice"
          message="Add auth/session handling, route manifest import, dashboard widgets, and native packaging gates."
        />
      </GlassPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rows: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  codeBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
});
