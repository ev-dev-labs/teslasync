import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { AppText } from './AppText';
import { GlassPanel } from './GlassPanel';

interface MetricCardProps {
  label: string;
  value: string | number;
  helper: string;
  tone?: 'accent' | 'danger' | 'neutral';
}

export function MetricCard({label, value, helper, tone = 'neutral'}: MetricCardProps) {
  return (
    <GlassPanel style={styles.root}>
      <View style={[styles.indicator, toneStyles[tone]]} />
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="title" weight="bold">
        {value}
      </AppText>
      <AppText variant="caption" tone="secondary">
        {helper}
      </AppText>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minWidth: 170,
    padding: spacing.lg,
    gap: spacing.xs,
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: 3,
  },
});

const toneStyles = StyleSheet.create({
  accent: {
    backgroundColor: colors.accent,
  },
  danger: {
    backgroundColor: colors.danger,
  },
  neutral: {
    backgroundColor: colors.border,
  },
});
