import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { AppText } from '../ui/AppText';
import { PremiumCard } from '../ui/PremiumCard';

interface ScreenSectionProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function ScreenSection({title, subtitle, children}: ScreenSectionProps) {
  return (
    <PremiumCard style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.accentDot} />
        <View style={styles.headerCopy}>
          <AppText variant="title" weight="bold">
            {title}
          </AppText>
          <AppText tone="secondary">{subtitle}</AppText>
        </View>
      </View>
      <View style={styles.content}>
        {children}
      </View>
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  accentDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: spacing.sm,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.72,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 0},
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  content: {
    gap: spacing.lg,
  },
});
