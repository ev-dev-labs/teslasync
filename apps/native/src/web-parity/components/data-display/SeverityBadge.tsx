// Native parity port of web/src/components/data-display/SeverityBadge.tsx.
// Replaces the DOM span + lucide-react severity icons and the Tailwind token
// classes (bg/border/fg + size classes) with React Native primitives, native
// theme tokens, and text-glyph severity icons. The native app ships no
// lucide-react / SVG icon set, so the canonical severity glyph stands in for
// the Lucide icon while color continues to carry the severity meaning.

import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

export type Severity = 'info' | 'warn' | 'critical' | 'success';

export type SeverityIconName =
  | 'Info'
  | 'AlertTriangle'
  | 'AlertOctagon'
  | 'CheckCircle';

export interface SeverityTokens {
  /** Soft background tint behind the badge pill. */
  bg: string;
  /** Border color of the badge pill. */
  border: string;
  /** Foreground color used for the icon glyph and label text. */
  fg: string;
  /** Canonical severity icon name. */
  icon: SeverityIconName;
}

export type SeverityBadgeSize = 'sm' | 'md';

/**
 * Single source of truth for native severity styling. Mirrors the web
 * `severityTokens` map; the saturated sky/amber/red/emerald Tailwind shades are
 * approximated with the closest native theme tokens.
 */
export const severityTokens: Record<Severity, SeverityTokens> = {
  critical: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    fg: colors.danger,
    icon: 'AlertOctagon',
  },
  info: {
    bg: colors.accentSoft,
    border: colors.borderAccent,
    fg: colors.accent,
    icon: 'Info',
  },
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    fg: colors.success,
    icon: 'CheckCircle',
  },
  warn: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
    icon: 'AlertTriangle',
  },
};

// Text-glyph stand-ins for the lucide icons. The badge color carries the
// severity meaning and the glyph is decorative (aria-hidden in the web source),
// so the two alert glyphs intentionally share the exclamation mark.
const ICON_GLYPH: Record<SeverityIconName, string> = {
  AlertOctagon: '!',
  AlertTriangle: '!',
  CheckCircle: '\u2713',
  Info: 'i',
};

interface SizeConfig {
  fontSize: number;
  gap: number;
  glyphSize: number;
  paddingHorizontal: number;
  paddingVertical: number;
}

// Mirrors the web sizeClasses / iconSizeClasses (sm: text-xs px-1.5 py-0.5
// gap-1 + h-3; md: text-sm px-2 py-1 gap-1.5 + h-3.5).
const SIZE_CONFIG: Record<SeverityBadgeSize, SizeConfig> = {
  md: {
    fontSize: 14,
    gap: 6,
    glyphSize: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sm: {
    fontSize: 12,
    gap: 4,
    glyphSize: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
};

export interface SeverityBadgeProps {
  /** Wire-level severity value. Anything is accepted -- `normalizeSeverity` decides. */
  severity: string | null | undefined;
  showIcon?: boolean;
  size?: SeverityBadgeSize;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Optional override label. Defaults to the canonical severity name. */
  children?: ReactNode;
  title?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

export function SeverityBadge({
  severity,
  showIcon = true,
  size = 'md',
  className: _className,
  children,
  title,
  style,
  testID,
  'data-testid': dataTestID,
}: SeverityBadgeProps) {
  const sev = normalizeSeverity(severity);
  const tokens = severityTokens[sev];
  const sizing = SIZE_CONFIG[size];
  const glyph = ICON_GLYPH[tokens.icon];

  const hasCustomLabel = children !== undefined && children !== null;
  const isTextLabel =
    typeof children === 'string' || typeof children === 'number';

  return (
    <View
      accessibilityLabel={title}
      accessibilityRole="text"
      accessible
      style={[
        styles.badge,
        {
          backgroundColor: tokens.bg,
          borderColor: tokens.border,
          gap: sizing.gap,
          paddingHorizontal: sizing.paddingHorizontal,
          paddingVertical: sizing.paddingVertical,
        },
        style,
      ]}
      testID={testID ?? dataTestID ?? 'severity-badge'}>
      {showIcon ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.glyph,
            {
              color: tokens.fg,
              fontSize: sizing.glyphSize,
              lineHeight: sizing.glyphSize + 4,
            },
          ]}
          weight="bold">
          {glyph}
        </AppText>
      ) : null}
      {hasCustomLabel && !isTextLabel ? (
        children
      ) : (
        <AppText
          style={[
            styles.label,
            {
              color: tokens.fg,
              fontSize: sizing.fontSize,
              lineHeight: sizing.fontSize + 4,
            },
          ]}
          weight="semibold">
          {isTextLabel ? children : sev}
        </AppText>
      )}
    </View>
  );
}

SeverityBadge.displayName = 'SeverityBadge';

export interface SeverityIconProps {
  severity: string | null | undefined;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Glyph font size in points. Defaults to the web md icon size (14). */
  size?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
  'data-testid'?: string;
}

/** Renders just the canonical severity glyph, colored via tokens. */
export function SeverityIcon({
  severity,
  className: _className,
  size = 14,
  style,
  testID,
  'data-testid': dataTestID,
}: SeverityIconProps) {
  const sev = normalizeSeverity(severity);
  const tokens = severityTokens[sev];
  const glyph = ICON_GLYPH[tokens.icon];

  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.glyph,
        {color: tokens.fg, fontSize: size, lineHeight: size + 4},
        style,
      ]}
      testID={testID ?? dataTestID ?? 'severity-icon'}
      weight="bold">
      {glyph}
    </AppText>
  );
}

SeverityIcon.displayName = 'SeverityIcon';

/** Normalize the wire-level severity values that may sneak into the frontend. */
export function normalizeSeverity(s: string | null | undefined): Severity {
  if (!s) {
    return 'info';
  }
  const v = s.toLowerCase();
  if (v === 'warning') {
    return 'warn';
  }
  if (v === 'error' || v === 'fatal') {
    return 'critical';
  }
  if (v === 'ok' || v === 'success') {
    return 'success';
  }
  if (v === 'info' || v === 'warn' || v === 'critical') {
    return v as Severity;
  }
  return 'info';
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
  },
  glyph: {
    textAlign: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
