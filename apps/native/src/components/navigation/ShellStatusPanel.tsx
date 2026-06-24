import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  oldWebDeletionReadiness,
  routeGroupParitySummaries,
  routeParitySummary,
} from '../../navigation/routes';
import type { PlatformIntegrationStatus } from '../../platform/status';
import { colors, spacing } from '../../theme/tokens';
import { AppText } from '../ui/AppText';
import { GlassPanel } from '../ui/GlassPanel';
import { StatusPill } from '../ui/StatusPill';

interface ShellStatusPanelProps {
  compact: boolean;
  platformStatus: PlatformIntegrationStatus;
}

export function ShellStatusPanel({
  compact,
  platformStatus,
}: ShellStatusPanelProps) {
  const unavailableCapabilities = platformStatus.capabilities.filter(
    capability => capability.state === 'unavailable',
  ).length;
  const unavailableLaunchActions = platformStatus.launchActions.filter(
    action => action.state === 'unavailable',
  ).length;

  return (
    <GlassPanel
      style={[styles.root, compact && styles.compactRoot]}
      testID="shell-status-panel"
    >
      <View style={styles.statusHeader}>
        <View style={styles.statusCopy}>
          <AppText variant="caption">Native route parity</AppText>
          <AppText weight="semibold" tone="accent">
            {routeParitySummary.implemented}/{routeParitySummary.total}{' '}
            implemented
          </AppText>
        </View>
        <StatusPill
          label={routeParitySummary.pending === 0 ? 'Ready' : 'Blocked'}
          state={routeParitySummary.pending === 0 ? 'online' : 'warning'}
        />
      </View>

      <AppText variant="caption" tone="muted">
        {`${routeParitySummary.pending} unresolved routes; old web deletion: ${oldWebDeletionReadiness.status}`}
      </AppText>
      <AppText variant="caption" tone="muted">
        lifecycle: {platformStatus.appState}; platform: {platformStatus.os}
      </AppText>
      <AppText variant="caption" tone="muted">
        Unavailable platform affordances:{' '}
        {unavailableCapabilities + unavailableLaunchActions}
      </AppText>

      {platformStatus.deepLinkError ? (
        <View style={styles.errorState}>
          <AppText variant="caption" weight="semibold" tone="danger">
            Deep-link error
          </AppText>
          <AppText variant="caption" tone="muted">
            {platformStatus.deepLinkError}
          </AppText>
        </View>
      ) : (
        <View style={styles.unavailableState}>
          <AppText variant="caption" weight="semibold" tone="muted">
            Unavailable state is explicit
          </AppText>
          <AppText variant="caption" tone="muted">
            Push, badges, and OS shortcuts remain visible as unavailable instead
            of success-shaped placeholders.
          </AppText>
        </View>
      )}

      <View style={styles.groupSummaryList}>
        <AppText variant="caption" tone="muted">
          Unresolved by group
        </AppText>
        {routeGroupParitySummaries.map(groupSummary => (
          <View key={groupSummary.group} style={styles.groupSummaryRow}>
            <AppText variant="caption" tone="muted">
              {groupSummary.label}
            </AppText>
            <AppText variant="caption" weight="semibold">
              {groupSummary.pending}
            </AppText>
          </View>
        ))}
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  root: {
    minWidth: 280,
    padding: spacing.md,
    gap: spacing.xs,
  },
  compactRoot: {
    minWidth: 0,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statusCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  unavailableState: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.sm,
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  errorState: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: 14,
    padding: spacing.sm,
    gap: spacing.xs,
    backgroundColor: colors.dangerSurface,
  },
  groupSummaryList: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  groupSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});
