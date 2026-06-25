import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { AppText } from './AppText';
import { PremiumCard } from './PremiumCard';

interface MetricCardProps {
  label: string;
  value: string | number;
  helper: string;
  tone?: 'accent' | 'danger' | 'neutral';
}

export function MetricCard({label, value, helper, tone = 'neutral'}: MetricCardProps) {
  return (
    <PremiumCard
      tone={tone === 'danger' ? 'danger' : tone === 'accent' ? 'accent' : 'neutral'}
      style={styles.root}>
      <View style={styles.header}>
        <View style={[styles.indicator, toneStyles[tone]]} />
        <AppText variant="caption" tone="muted" weight="semibold" style={styles.label}>
          {label}
        </AppText>
      </View>
      <AppText variant="display" weight="bold" style={styles.value}>
        {value}
      </AppText>
      <AppText variant="caption" tone="secondary">
        {helper}
      </AppText>
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minWidth: 170,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  indicator: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  value: {
    color: colors.textPrimary,
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
    backgroundColor: colors.textMuted,
  },
});
