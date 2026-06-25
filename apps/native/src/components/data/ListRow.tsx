import React, { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { SemanticIcon, type SemanticIconName } from '../icons/SemanticIcon';
import { AppText } from '../ui/AppText';

interface ListRowProps {
  title: string;
  subtitle?: string;
  meta?: string;
  detail?: ReactNode;
  icon?: SemanticIconName;
  selected?: boolean;
  tone?: 'accent' | 'neutral' | 'success' | 'warning';
  onPress?: (event: GestureResponderEvent) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function ListRow({
  title,
  subtitle,
  meta,
  detail,
  icon,
  selected = false,
  tone = 'neutral',
  onPress,
  accessibilityLabel,
  style,
}: ListRowProps) {
  const label =
    accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join(', ');
  const content = (
    <>
      <View style={[styles.sideRail, selected && styles.sideRailSelected, toneRailStyles[tone]]} />
      {icon ? <SemanticIcon name={icon} decorative style={selected ? styles.selectedIcon : undefined} /> : null}
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <AppText weight="semibold" style={styles.title}>
            {title}
          </AppText>
          {meta ? (
            <AppText variant="caption" tone="muted">
              {meta}
            </AppText>
          ) : null}
        </View>
        {subtitle ? <AppText tone="secondary">{subtitle}</AppText> : null}
        {detail ? <View style={styles.detail}>{detail}</View> : null}
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({pressed}) => [
          styles.root,
          selected && styles.selected,
          pressed && styles.pressed,
          style,
        ]}>
        {content}
      </Pressable>
    );
  }

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.root, selected && styles.selected, style]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  selected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  pressed: {
    opacity: 0.82,
  },
  sideRail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 3,
    opacity: 0.64,
  },
  sideRailSelected: {
    opacity: 1,
  },
  selectedIcon: {
    borderColor: colors.borderAccent,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  detail: {
    paddingTop: spacing.xs,
  },
});

const toneRailStyles = StyleSheet.create({
  accent: {
    backgroundColor: colors.accent,
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
