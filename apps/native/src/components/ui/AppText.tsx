import React from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { colors, typography } from '../../theme/tokens';

type TextVariant = 'body' | 'caption' | 'title' | 'display';
type TextTone = 'primary' | 'secondary' | 'muted' | 'accent' | 'danger';
type TextWeight = 'regular' | 'semibold' | 'bold';

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: TextWeight;
}

export function AppText({
  variant = 'body',
  tone = 'primary',
  weight = 'regular',
  style,
  ...props
}: AppTextProps) {
  return (
    <Text
      {...props}
      style={[
        styles.base,
        variantStyles[variant],
        toneStyles[tone],
        weightStyles[weight],
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    fontSize: typography.body,
    lineHeight: 22,
  },
});

const variantStyles = StyleSheet.create<Record<TextVariant, TextStyle>>({
  body: {
    fontSize: typography.body,
    lineHeight: 22,
  },
  caption: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  title: {
    fontSize: typography.title,
    lineHeight: 28,
  },
  display: {
    fontSize: typography.display,
    lineHeight: 40,
  },
});

const toneStyles = StyleSheet.create<Record<TextTone, TextStyle>>({
  primary: {
    color: colors.textPrimary,
  },
  secondary: {
    color: colors.textSecondary,
  },
  muted: {
    color: colors.textMuted,
  },
  accent: {
    color: colors.accent,
  },
  danger: {
    color: colors.danger,
  },
});

const weightStyles = StyleSheet.create<Record<TextWeight, TextStyle>>({
  regular: {
    fontWeight: '400',
  },
  semibold: {
    fontWeight: '600',
  },
  bold: {
    fontWeight: '800',
  },
});
