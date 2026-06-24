import React from 'react';
import {StyleSheet, View} from 'react-native';

import {colors, spacing} from '../../theme/tokens';
import {AppText} from '../ui/AppText';

export interface ChartDataTableRow {
  id: string;
  label: string;
  value: string;
}

interface ChartDataTableProps {
  label?: string;
  rows: ChartDataTableRow[];
}

export function ChartDataTable({
  label = 'Accessible chart data table',
  rows,
}: ChartDataTableProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${label} with ${rows.length} rows`}
      style={styles.root}
    >
      <AppText variant="caption" tone="accent" weight="semibold" style={styles.label}>
        {label}
      </AppText>
      <View style={styles.table}>
        <View style={[styles.row, styles.headerRow]}>
          <AppText variant="caption" tone="muted" weight="semibold" style={styles.cell}>
            Label
          </AppText>
          <AppText
            variant="caption"
            tone="muted"
            weight="semibold"
            style={[styles.cell, styles.valueCell]}
          >
            Value
          </AppText>
        </View>
        {rows.map(row => (
          <View key={row.id} style={styles.row}>
            <AppText variant="caption" tone="secondary" style={styles.cell}>
              {row.label}
            </AppText>
            <AppText
              variant="caption"
              weight="semibold"
              style={[styles.cell, styles.valueCell]}
            >
              {row.value}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceRaised,
  },
  headerRow: {
    borderTopWidth: 0,
    backgroundColor: colors.surfaceSelected,
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
  valueCell: {
    textAlign: 'right',
  },
});
