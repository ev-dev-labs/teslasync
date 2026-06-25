import React from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../../theme/tokens';
import { AppText } from '../ui/AppText';

interface EmptyStateProps {
  title: string;
  message: string;
}

export function EmptyState({title, message}: EmptyStateProps) {
  return (
    <View style={styles.root}>
      <AppText weight="semibold">{title}</AppText>
      <AppText tone="muted">{message}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
});
