import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { SectionHeader } from '../components/data/SectionHeader';
import { SemanticIcon, type SemanticIconName } from '../components/icons/SemanticIcon';
import { AppText } from '../components/ui/AppText';
import { GlassPanel } from '../components/ui/GlassPanel';
import { StatusPill } from '../components/ui/StatusPill';
import { colors, spacing } from '../theme/tokens';

type WidgetStatusState = 'offline' | 'online' | 'warning';

interface WidgetCardProps {
  title: string;
  subtitle: string;
  icon: SemanticIconName;
  children: ReactNode;
  testID: string;
  footer?: string;
  statusLabel?: string;
  statusState?: WidgetStatusState;
}

export function WidgetCard({
  title,
  subtitle,
  icon,
  children,
  testID,
  footer,
  statusLabel,
  statusState = 'online',
}: WidgetCardProps) {
  return (
    <GlassPanel style={styles.root} testID={testID}>
      <SectionHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        trailing={
          statusLabel ? <StatusPill label={statusLabel} state={statusState} /> : undefined
        }
      />
      {children}
      {footer ? (
        <View style={styles.footer}>
          <SemanticIcon name="info" size="sm" decorative />
          <AppText variant="caption" tone="muted" style={styles.footerCopy}>
            {footer}
          </AppText>
        </View>
      ) : null}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  footerCopy: {
    flex: 1,
    minWidth: 0,
  },
});

