// Native parity port of web/src/components/data-display/FSMBadge.tsx.
// Replaces the web `Badge` span (Tailwind variant classes) with a self-contained
// React Native pill while preserving the FSM type -> {variant, label} mapping,
// the neutral fallback for unknown types, and the rounded badge visual intent.

import React from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

type BadgeVariant = 'success' | 'warning' | 'info' | 'danger' | 'neutral';

const FSM_COLORS: Record<string, {variant: BadgeVariant; label: string}> = {
  vehicle: {variant: 'info', label: 'Vehicle'},
  drive_session: {variant: 'success', label: 'Drive'},
  charge_session: {variant: 'warning', label: 'Charge'},
  command: {variant: 'danger', label: 'Command'},
  notification: {variant: 'neutral', label: 'Notify'},
  alert_cooldown: {variant: 'neutral', label: 'Cooldown'},
  automation: {variant: 'info', label: 'Automation'},
};

export interface FSMBadgeProps {
  /** FSM domain key (e.g. `drive_session`, `command`). Unknown keys fall back to a neutral pill labeled with the raw type. */
  type: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Test hook. */
  testID?: string;
}

export function FSMBadge({type, style, className: _className, testID}: FSMBadgeProps) {
  const config = FSM_COLORS[type] ?? {variant: 'neutral' as const, label: type};
  const surfaceStyle = surfaceStyles[config.variant];
  const textStyle = labelStyles[config.variant];

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={config.label}
      style={[styles.root, surfaceStyle, style]}
      testID={testID}>
      <AppText style={[styles.label, textStyle]} variant="caption" weight="semibold">
        {config.label}
      </AppText>
    </View>
  );
}

FSMBadge.displayName = 'FSMBadge';

const styles = StyleSheet.create({
  root: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  label: {
    fontWeight: '500',
  },
});

const surfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const labelStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {
    color: colors.accent,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
});
