import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { AppText } from '../ui/AppText';

interface KeyValueRowProps {
  label: string;
  value: string | number;
}

export function KeyValueRow({label, value}: KeyValueRowProps) {
  return (
    <View style={styles.root}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText weight="semibold">{String(value)}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
});
