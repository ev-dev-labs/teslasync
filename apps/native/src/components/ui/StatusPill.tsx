import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { AppText } from './AppText';

interface StatusPillProps {
  label: string;
  state: 'online' | 'warning' | 'offline';
}

export function StatusPill({label, state}: StatusPillProps) {
  return (
    <View style={[styles.root, stateStyles[state]]}>
      <View style={[styles.dot, dotStyles[state]]} />
      <AppText variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

const stateStyles = StyleSheet.create({
  online: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  offline: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
});

const dotStyles = StyleSheet.create({
  online: {
    backgroundColor: colors.success,
  },
  warning: {
    backgroundColor: colors.warning,
  },
  offline: {
    backgroundColor: colors.danger,
  },
});
