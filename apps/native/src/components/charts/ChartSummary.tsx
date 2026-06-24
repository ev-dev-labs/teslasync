import React, { useMemo } from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { SectionHeader } from '../data/SectionHeader';
import { EmptyState } from '../feedback/EmptyState';
import { SemanticIcon, type SemanticIconName } from '../icons/SemanticIcon';
import { AppText } from '../ui/AppText';
import { PremiumCard } from '../ui/PremiumCard';

export interface ChartSummaryDatum {
  id: string;
  label: string;
  value: number;
  formattedValue?: string;
  icon?: SemanticIconName;
}

interface ChartSummaryProps {
  title: string;
  subtitle?: string;
  metricLabel: string;
  metricValue: string;
  data: ChartSummaryDatum[];
  emptyLabel: string;
  icon?: SemanticIconName;
  style?: StyleProp<ViewStyle>;
}

export function ChartSummary({
  title,
  subtitle,
  metricLabel,
  metricValue,
  data,
  emptyLabel,
  icon = 'analytics',
  style,
}: ChartSummaryProps) {
  const visibleData = useMemo(
    () => data.filter(item => Number.isFinite(item.value)).slice(0, 8),
    [data],
  );
  const max = Math.max(...visibleData.map(item => Math.max(item.value, 0)), 1);

  return (
    <PremiumCard style={style} testID="chart-summary">
      <SectionHeader title={title} subtitle={subtitle} icon={icon} />
      <View style={styles.metricHero}>
        <AppText variant="caption" tone="muted" weight="semibold" style={styles.uppercase}>
          {metricLabel}
        </AppText>
        <AppText variant="display" weight="bold">
          {metricValue}
        </AppText>
      </View>

      {visibleData.length === 0 ? (
        <EmptyState title="No chart points" message={emptyLabel} />
      ) : (
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={`${title} chart summary with ${visibleData.length} points`}
          style={styles.series}>
          {visibleData.map(item => {
            const width = `${Math.max((Math.max(item.value, 0) / max) * 100, 4)}%` as DimensionValue;

            return (
              <View key={item.id} style={styles.row}>
                <View style={styles.labelCell}>
                  {item.icon ? <SemanticIcon name={item.icon} size="sm" decorative /> : null}
                  <AppText variant="caption" tone="secondary" style={styles.label}>
                    {item.label}
                  </AppText>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, {width}]} />
                </View>
                <AppText variant="caption" weight="semibold" style={styles.value}>
                  {item.formattedValue ?? String(item.value)}
                </AppText>
              </View>
            );
          })}
        </View>
      )}
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  metricHero: {
    gap: spacing.xs,
  },
  uppercase: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  series: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  labelCell: {
    width: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
  track: {
    flex: 1,
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  value: {
    width: 56,
    textAlign: 'right',
  },
});
