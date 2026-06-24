import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { SemanticIcon, type SemanticIconName } from '../icons/SemanticIcon';
import { AppText } from '../ui/AppText';
import { PremiumCard } from '../ui/PremiumCard';

type MetricGridTone = 'accent' | 'danger' | 'neutral' | 'success' | 'warning';

export interface MetricGridItem {
  id: string;
  label: string;
  value: string | number;
  helper?: string;
  tone?: MetricGridTone;
  icon?: SemanticIconName;
}

interface MetricGridProps {
  items: MetricGridItem[];
  minItemWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export function MetricGrid({items, minItemWidth = 168, style}: MetricGridProps) {
  return (
    <View style={[styles.root, style]}>
      {items.map(item => (
        <PremiumCard
          key={item.id}
          tone={item.tone ?? 'neutral'}
          style={[styles.item, {minWidth: minItemWidth}]}
          testID={`metric-${item.id}`}>
          <View style={styles.header}>
            {item.icon ? <SemanticIcon name={item.icon} size="sm" decorative /> : null}
            <AppText variant="caption" tone="muted" weight="semibold" style={styles.label}>
              {item.label}
            </AppText>
          </View>
          <AppText variant="display" weight="bold" style={styles.value}>
            {String(item.value)}
          </AppText>
          {item.helper ? (
            <AppText variant="caption" tone="secondary">
              {item.helper}
            </AppText>
          ) : null}
        </PremiumCard>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  item: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    flex: 1,
    minWidth: 0,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  value: {
    color: colors.textPrimary,
  },
});
