import React, { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { spacing } from '../../theme/tokens';
import { SemanticIcon, type SemanticIconName } from '../icons/SemanticIcon';
import { AppText } from '../ui/AppText';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  icon?: SemanticIconName;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({
  title,
  subtitle,
  eyebrow,
  icon,
  trailing,
  style,
}: SectionHeaderProps) {
  return (
    <View style={[styles.root, style]}>
      {icon ? <SemanticIcon name={icon} decorative /> : null}
      <View style={styles.copy}>
        {eyebrow ? (
          <AppText variant="caption" tone="accent" weight="semibold">
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="title" weight="bold">
          {title}
        </AppText>
        {subtitle ? <AppText tone="secondary">{subtitle}</AppText> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  trailing: {
    alignItems: 'flex-end',
  },
});
