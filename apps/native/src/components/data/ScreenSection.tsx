import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../../theme/tokens';
import { AppText } from '../ui/AppText';
import { GlassPanel } from '../ui/GlassPanel';

interface ScreenSectionProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function ScreenSection({title, subtitle, children}: ScreenSectionProps) {
  return (
    <GlassPanel style={styles.panel}>
      <View>
        <AppText variant="title" weight="bold">
          {title}
        </AppText>
        <AppText tone="secondary">{subtitle}</AppText>
      </View>
      {children}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
});
