import React from 'react';
import {StyleSheet, View, type ViewStyle} from 'react-native';

import {colors} from '../../theme/tokens';
import {AppText} from '../ui/AppText';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
  type SemanticIconTone,
} from './semanticIconData';

export type {
  SemanticIconName,
  SemanticIconTone,
  SemanticIconVisual,
  SemanticIconDefinition,
} from './semanticIconData';
export {
  semanticIconIntentNames,
  semanticIconNames,
  semanticIconVisuals,
  formatSemanticIconLabel,
  getSemanticIconDefinition,
} from './semanticIconData';

interface SemanticIconProps {
  name: SemanticIconName;
  size?: 'sm' | 'md' | 'lg';
  decorative?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle | ViewStyle[];
}

// Native (device) renderer: monogram badge. The web build resolves
// SemanticIcon.web.tsx instead, which renders real lucide icons.
export function SemanticIcon({
  name,
  size = 'md',
  decorative = false,
  accessibilityLabel,
  style,
}: SemanticIconProps) {
  const definition = getSemanticIconDefinition(name);

  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={
        decorative ? undefined : accessibilityLabel ?? definition.label
      }
      style={[styles.root, sizeStyles[size], toneStyles[definition.tone], style]}>
      <AppText
        variant="caption"
        weight="bold"
        style={[
          styles.glyph,
          glyphSizeStyles[size],
          glyphToneStyles[definition.tone],
        ]}>
        {definition.glyph}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  glyph: {
    letterSpacing: 0.4,
  },
});

const sizeStyles = StyleSheet.create({
  sm: {width: 30, height: 30, borderRadius: 10},
  md: {width: 38, height: 38, borderRadius: 14},
  lg: {width: 52, height: 52, borderRadius: 18},
});

const glyphSizeStyles = StyleSheet.create({
  sm: {fontSize: 10, lineHeight: 14},
  md: {fontSize: 12, lineHeight: 16},
  lg: {fontSize: 15, lineHeight: 20},
});

const toneStyles = StyleSheet.create<Record<SemanticIconTone, ViewStyle>>({
  accent: {borderColor: colors.borderAccent, backgroundColor: colors.surfaceSelected},
  danger: {borderColor: colors.dangerBorder, backgroundColor: colors.dangerSurface},
  neutral: {borderColor: colors.border, backgroundColor: colors.surfaceRaised},
  success: {borderColor: colors.successBorder, backgroundColor: colors.successSurface},
  violet: {borderColor: 'rgba(139, 92, 246, 0.34)', backgroundColor: 'rgba(139, 92, 246, 0.12)'},
  warning: {borderColor: colors.warningBorder, backgroundColor: colors.warningSurface},
});

const glyphToneStyles = StyleSheet.create({
  accent: {color: colors.accent},
  danger: {color: colors.danger},
  neutral: {color: colors.textSecondary},
  success: {color: colors.success},
  violet: {color: colors.glowViolet},
  warning: {color: colors.warning},
});
