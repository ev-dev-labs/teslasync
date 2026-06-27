import React from 'react';
import {StyleSheet} from 'react-native';
import type {StyleProp, TextStyle, ViewStyle} from 'react-native';

import {colors} from '../../theme/tokens';
import {AppText} from '../ui/AppText';
import {semanticIconVisuals} from './semanticIconData';

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

const VISUALS = semanticIconVisuals as unknown as Record<string, {glyph: string}>;

export interface GlyphProps {
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

// Native (device) renderer: monogram / literal text. The web build resolves
// Glyph.web.tsx which renders real lucide icons.
export function Glyph({glyph, name, label, char, text, children, tone = 'secondary', color, style}: GlyphProps) {
  const tint = color ?? TONE_COLOR[tone] ?? colors.textSecondary;
  const content =
    glyph ??
    char ??
    label ??
    text ??
    children ??
    (name && VISUALS[name] ? VISUALS[name].glyph : name?.slice(0, 2).toUpperCase() ?? '?');
  return (
    <AppText style={[styles.glyph, {color: tint}, style as TextStyle]} weight="bold">
      {content}
    </AppText>
  );
}

const styles = StyleSheet.create({
  glyph: {letterSpacing: 0.3, fontSize: 12, lineHeight: 16},
});
