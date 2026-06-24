import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {colors, spacing} from '../../theme/tokens';
import {ListRow} from '../data/ListRow';
import {SectionHeader} from '../data/SectionHeader';
import {EmptyState} from '../feedback/EmptyState';
import {AppText} from '../ui/AppText';
import {PremiumCard} from '../ui/PremiumCard';
import {StatusPill} from '../ui/StatusPill';

export interface MediaParityCapability {
  id: string;
  label: string;
  detail: string;
}

interface MediaParitySummaryProps {
  title: string;
  subtitle?: string;
  sourceLabel: string;
  emptyLabel: string;
  capabilities: MediaParityCapability[];
  statusLabel?: string;
  currentItem?: {
    title: string;
    subtitle?: string;
    stateLabel: string;
  };
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function MediaParitySummary({
  title,
  subtitle,
  sourceLabel,
  emptyLabel,
  capabilities,
  statusLabel = 'Native media summary',
  currentItem,
  style,
  testID = 'media-parity-summary',
}: MediaParitySummaryProps) {
  return (
    <PremiumCard style={style} testID={testID}>
      <SectionHeader
        title={title}
        subtitle={subtitle}
        eyebrow="Universal media primitive"
        icon="media"
        trailing={
          <StatusPill
            label={statusLabel}
            state={currentItem ? 'online' : 'warning'}
          />
        }
      />
      <View style={styles.source}>
        <AppText variant="caption" tone="accent" weight="semibold" style={styles.uppercase}>
          Media parity source
        </AppText>
        <AppText tone="secondary">{sourceLabel}</AppText>
      </View>
      {currentItem ? (
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={`${title} media summary for ${currentItem.title}`}
          style={styles.currentItem}
        >
          <AppText variant="caption" tone="muted" weight="semibold" style={styles.uppercase}>
            Now playing
          </AppText>
          <AppText weight="bold">{currentItem.title}</AppText>
          {currentItem.subtitle ? (
            <AppText tone="secondary">{currentItem.subtitle}</AppText>
          ) : null}
          <AppText variant="caption" tone="accent" weight="semibold">
            {currentItem.stateLabel}
          </AppText>
        </View>
      ) : (
        <EmptyState title="No media payload" message={emptyLabel} />
      )}
      <View style={styles.capabilities}>
        <AppText variant="caption" tone="accent" weight="semibold" style={styles.uppercase}>
          Media data alternative
        </AppText>
        {capabilities.map(capability => (
          <ListRow
            key={capability.id}
            title={capability.label}
            subtitle={capability.detail}
            icon="media"
          />
        ))}
      </View>
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  source: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  currentItem: {
    borderWidth: 1,
    borderColor: colors.borderAccent,
    borderRadius: 18,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surfaceSelected,
  },
  capabilities: {
    gap: spacing.sm,
  },
  uppercase: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
