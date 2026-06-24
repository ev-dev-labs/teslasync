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
  onPress,
  accessibilityLabel,
  style,
}: ListRowProps) {
  const content = (
    <>
      {icon ? <SemanticIcon name={icon} decorative /> : null}
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
        accessibilityLabel={accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join(', ')}
        onPress={onPress}
        style={({pressed}) => [styles.root, pressed && styles.pressed, style]}>
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.root, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  pressed: {
    opacity: 0.82,
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
