import React, { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

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
      <View pointerEvents="none" style={[styles.glow, glowStyles[tone]]} />
      <View pointerEvents="none" style={[styles.rail, railStyles[tone]]} />
      {children}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    overflow: 'hidden',
    ...shadows.panel,
  },
  padded: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  glow: {
    position: 'absolute',
    top: -70,
    right: -70,
    width: 180,
    height: 180,
    borderRadius: 90,
    opacity: 0.34,
  },
  rail: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: 2,
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

const glowStyles = StyleSheet.create<Record<PremiumCardTone, ViewStyle>>({
  accent: {
    backgroundColor: colors.accentGlow,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
  },
  neutral: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  success: {
    backgroundColor: colors.successSurface,
  },
  warning: {
    backgroundColor: colors.warningSurface,
  },
});

const railStyles = StyleSheet.create<Record<PremiumCardTone, ViewStyle>>({
  accent: {
    backgroundColor: colors.accent,
  },
  danger: {
    backgroundColor: colors.danger,
  },
  neutral: {
    backgroundColor: colors.border,
  },
  success: {
    backgroundColor: colors.success,
  },
  warning: {
    backgroundColor: colors.warning,
  },
});
