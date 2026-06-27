import React from 'react';
import {StyleSheet, View, type ViewStyle} from 'react-native';
import * as LucideReact from 'lucide-react';

import {colors} from '../../theme/tokens';
import {AppText} from '../ui/AppText';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
  type SemanticIconTone,
} from './semanticIconData';
import {SEMANTIC_ICON_LUCIDE} from './semanticIconLucideMap';

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

const BOX: Record<'sm' | 'md' | 'lg', number> = {sm: 30, md: 38, lg: 52};
const ICON: Record<'sm' | 'md' | 'lg', number> = {sm: 16, md: 20, lg: 26};

const toneColor: Record<SemanticIconTone, string> = {
  accent: colors.accent,
  danger: colors.danger,
  neutral: colors.textSecondary,
  success: colors.success,
  violet: colors.glowViolet,
  warning: colors.warning,
};

// Web renderer: real lucide-react icons (resolved at runtime by mapped name),
// falling back to the monogram glyph if a name is missing from lucide.
export function SemanticIcon({
  name,
  size = 'md',
  decorative = false,
  accessibilityLabel,
  style,
}: SemanticIconProps) {
  const definition = getSemanticIconDefinition(name);
  const lucideName = SEMANTIC_ICON_LUCIDE[name];
  const LucideIcon = lucideName
    ? ((LucideReact as unknown as Record<string, React.ComponentType<{
        size?: number;
        color?: string;
        strokeWidth?: number;
        'aria-label'?: string;
        'aria-hidden'?: boolean;
      }>>)[lucideName] ?? null)
    : null;
  const color = toneColor[definition.tone];

  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={
        decorative ? undefined : accessibilityLabel ?? definition.label
      }
      style={[styles.root, {width: BOX[size], height: BOX[size]}, style]}>
      {LucideIcon ? (
        <LucideIcon
          size={ICON[size]}
          color={color}
          strokeWidth={2}
          aria-hidden={decorative || undefined}
          aria-label={decorative ? undefined : accessibilityLabel ?? definition.label}
        />
      ) : (
        <AppText variant="caption" weight="bold" style={[styles.fallback, {color}]}>
          {definition.glyph}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {alignItems: 'center', justifyContent: 'center'},
  fallback: {letterSpacing: 0.4, fontSize: 12, lineHeight: 16},
});
