import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SemanticIcon, type SemanticIconName } from '../components/icons/SemanticIcon';
import { AppText } from '../components/ui/AppText';
import { spacing } from '../theme/tokens';

interface WidgetMessageProps {
  title: string;
  message: string;
  icon?: SemanticIconName;
}

export function WidgetMessage({title, message, icon = 'info'}: WidgetMessageProps) {
  return (
    <View style={styles.root}>
      <SemanticIcon name={icon} decorative />
      <View style={styles.copy}>
        <AppText weight="semibold">{title}</AppText>
        <AppText tone="muted">{message}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
});

