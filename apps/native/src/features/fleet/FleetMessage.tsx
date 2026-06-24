import React from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '../../components/feedback/EmptyState';
import { SemanticIcon, type SemanticIconName } from '../../components/icons/SemanticIcon';
import { colors, spacing } from '../../theme/tokens';

type FleetMessageTone = 'empty' | 'error' | 'loading' | 'notice';

interface FleetMessageProps {
  title: string;
  message: string;
  tone?: FleetMessageTone;
  icon?: SemanticIconName;
}

const toneIcon: Record<FleetMessageTone, SemanticIconName> = {
  empty: 'info',
  error: 'warning',
  loading: 'loading',
  notice: 'info',
};

export function FleetMessage({
  title,
  message,
  tone = 'notice',
  icon,
}: FleetMessageProps) {
  return (
    <View style={[styles.root, toneStyles[tone]]}>
      <SemanticIcon name={icon ?? toneIcon[tone]} decorative />
      <EmptyState title={title} message={message} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.md,
  },
});

const toneStyles = StyleSheet.create<Record<FleetMessageTone, {borderColor: string; backgroundColor: string}>>({
  empty: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  error: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  loading: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  notice: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
});
