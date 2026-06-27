import React from 'react';
import {StyleSheet, View} from 'react-native';
import type {StyleProp, TextStyle, ViewStyle} from 'react-native';
import * as LucideReact from 'lucide-react';

import {colors} from '../../theme/tokens';
import {AppText} from '../ui/AppText';
import {semanticIconIntentNames, semanticIconVisuals} from './semanticIconData';
import {SEMANTIC_ICON_LUCIDE} from './semanticIconLucideMap';

// Reverse map: 2-letter monogram glyph -> first SemanticIconName that produces it.
const GLYPH_TO_NAME: Record<string, string> = {};
for (const n of semanticIconIntentNames) {
  const g = semanticIconVisuals[n].glyph;
  if (!(g in GLYPH_TO_NAME)) {
    GLYPH_TO_NAME[g] = n;
  }
}

const LUCIDE = LucideReact as unknown as Record<
  string,
  React.ComponentType<{size?: number; color?: string; strokeWidth?: number; 'aria-hidden'?: boolean}>
>;
const LUCIDE_MAP = SEMANTIC_ICON_LUCIDE as unknown as Record<string, string>;

const TONE_COLOR: Record<string, string> = {
  accent: colors.accent,
  emerald: colors.success,
  success: colors.success,
  muted: colors.textMuted,
  secondary: colors.textSecondary,
  primary: colors.textPrimary,
  warning: colors.warning,
  danger: colors.danger,
  violet: colors.glowViolet,
  cyan: colors.accent,
};

export interface GlyphProps {
  // Any of these may carry the content depending on the original local Glyph.
  glyph?: string;
  name?: string;
  label?: string;
  char?: string;
  text?: string;
  pulse?: boolean;
  children?: React.ReactNode;
  tone?: string;
  color?: string;
  size?: number | string;
  decorative?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<TextStyle | ViewStyle>;
}

// Web renderer: real lucide icon resolved from name or reverse-mapped monogram
// glyph; otherwise render the literal text/symbol (char/label/children).
export function Glyph(props: GlyphProps) {
  const {glyph, name, label, char, children, tone = 'secondary', color, size, style} = props;
  const px = typeof size === 'number' ? size : 16;
  const tint = color ?? TONE_COLOR[tone] ?? colors.textSecondary;
  const semantic = name ?? (glyph ? GLYPH_TO_NAME[glyph] : undefined);
  const lucideName = semantic ? LUCIDE_MAP[semantic] : undefined;
  const Icon = lucideName ? LUCIDE[lucideName] : undefined;
  if (Icon) {
    return (
      <View style={[styles.box, style as ViewStyle]}>
        <Icon size={px} color={tint} strokeWidth={2} aria-hidden />
      </View>
    );
  }
  const content =
    glyph ?? char ?? label ?? props.text ?? children ?? (name ? name.slice(0, 2).toUpperCase() : '?');
  return (
    <AppText style={[styles.fallback, {color: tint}, style as TextStyle]} weight="bold">
      {content}
    </AppText>
  );
}

const styles = StyleSheet.create({
  box: {alignItems: 'center', justifyContent: 'center'},
  fallback: {letterSpacing: 0.3, fontSize: 12, lineHeight: 16},
});
