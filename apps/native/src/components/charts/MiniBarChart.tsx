import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { AppText } from '../ui/AppText';
import { ChartDataTable } from './ChartDataTable';

interface MiniBarChartProps {
  title: string;
  values: Array<{label: string; value: number}>;
  emptyLabel: string;
  dataTableLabel?: string;
}

export function MiniBarChart({
  title,
  values,
  emptyLabel,
  dataTableLabel,
}: MiniBarChartProps) {
  const max = Math.max(...values.map(item => item.value), 1);
  const tableRows = values
    .filter(item => Number.isFinite(item.value))
    .map(item => ({
      id: item.label,
      label: item.label,
      value: String(item.value),
    }));

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${title} mini bar chart with ${tableRows.length} rows`}
      style={styles.root}
    >
      <AppText weight="semibold">{title}</AppText>
      {values.length === 0 ? (
        <AppText tone="muted">{emptyLabel}</AppText>
      ) : (
        <>
          <View style={styles.bars}>
            {values.map(item => (
              <View key={item.label} style={styles.row}>
                <AppText variant="caption" style={styles.label}>
                  {item.label}
                </AppText>
                <View style={styles.track}>
                  <View style={[styles.fill, {width: `${Math.max((item.value / max) * 100, 6)}%`}]} />
                </View>
                <AppText variant="caption" style={styles.value}>
                  {item.value}
                </AppText>
              </View>
            ))}
          </View>
          <ChartDataTable label={dataTableLabel} rows={tableRows} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  bars: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    width: 72,
  },
  track: {
    flex: 1,
    height: 10,
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
    width: 32,
    textAlign: 'right',
  },
});
