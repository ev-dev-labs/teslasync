import React, { type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, shadows, spacing } from '../../theme/tokens';
import { GlassPanel } from './GlassPanel';

type PremiumCardTone = 'accent' | 'danger' | 'neutral' | 'success' | 'warning';

interface PremiumCardProps {
  children: ReactNode;
  tone?: PremiumCardTone;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PremiumCard({
  children,
  tone = 'neutral',
  padded = true,
  style,
  testID,
}: PremiumCardProps) {
  return (
    <GlassPanel testID={testID} style={[styles.root, padded && styles.padded, toneStyles[tone], style]}>
      {children}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
    ...shadows.panel,
  },
  padded: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
});

const toneStyles = StyleSheet.create<Record<PremiumCardTone, ViewStyle>>({
  accent: {
    borderColor: colors.borderAccent,
  },
  danger: {
    borderColor: colors.dangerBorder,
  },
  neutral: {
    borderColor: colors.border,
  },
  success: {
    borderColor: colors.successBorder,
  },
  warning: {
    borderColor: colors.warningBorder,
  },
});
