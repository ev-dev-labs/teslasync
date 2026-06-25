// Native parity port of web/src/components/charts/ChartBrush.tsx.
// Replaces Recharts Brush with a React Native range preview because native
// chart containers do not expose Recharts drag/sync wiring.

import React, {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export interface ChartBrushProps {
  /** Data key for the X-axis being brushed (matches the chart's XAxis dataKey). */
  dataKey?: string;
  /** Optional initial start index. */
  startIndex?: number;
  /** Optional initial end index. */
  endIndex?: number;
  /** Brush height in px. Defaults to the token value (28px). */
  height?: number;
  /** Optional change callback -- recharts passes `{startIndex, endIndex}`. */
  onChange?: (range: {startIndex?: number; endIndex?: number}) => void;
}

const BRUSH_STROKE = '#22d3ee';
const BRUSH_FILL = 'rgba(255, 255, 255, 0.03)';
const BRUSH_TRAVELLER_WIDTH = 8;
const BRUSH_HEIGHT = 28;

export function ChartBrush({
  dataKey = 'time',
  startIndex,
  endIndex,
  height = BRUSH_HEIGHT,
  onChange,
}: ChartBrushProps) {
  const rangeLabel = useMemo(
    () => formatRangeLabel(startIndex, endIndex),
    [endIndex, startIndex],
  );

  const handlePress = () => {
    onChange?.({startIndex, endIndex});
  };

  return (
    <Pressable
      accessibilityHint="Native charts render this as a visual range preview; Recharts drag syncing is unavailable outside web charts."
      accessibilityLabel={`Chart brush for ${dataKey}. ${rangeLabel}`}
      accessibilityRole="adjustable"
      onPress={handlePress}
      style={({pressed}) => [
        styles.root,
        {minHeight: height},
        pressed && styles.pressed,
      ]}
      testID="chart-brush">
      <View pointerEvents="none" style={[styles.track, {height}]}>
        <View style={styles.selection}>
          <View style={styles.handle} />
          <View style={styles.selectionFill} />
          <View style={styles.handle} />
        </View>
      </View>
      <View pointerEvents="none" style={styles.metaRow}>
        <AppText numberOfLines={1} style={styles.metaText} variant="caption">
          {dataKey}
        </AppText>
        <AppText numberOfLines={1} style={styles.rangeText} variant="caption">
          {rangeLabel}
        </AppText>
      </View>
    </Pressable>
  );
}

ChartBrush.displayName = 'ChartBrush';

function formatRangeLabel(
  startIndex: number | undefined,
  endIndex: number | undefined,
): string {
  const hasStart = Number.isFinite(startIndex);
  const hasEnd = Number.isFinite(endIndex);

  if (hasStart && hasEnd) {
    return `Indexes ${startIndex}-${endIndex}`;
  }
  if (hasStart) {
    return `Start ${startIndex}`;
  }
  if (hasEnd) {
    return `End ${endIndex}`;
  }
  return 'Full range';
}

const styles = StyleSheet.create({
  handle: {
    backgroundColor: BRUSH_STROKE,
    borderRadius: BRUSH_TRAVELLER_WIDTH / 2,
    height: '100%',
    width: BRUSH_TRAVELLER_WIDTH,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  metaText: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.82,
  },
  rangeText: {
    color: colors.textSecondary,
    flexShrink: 0,
  },
  root: {
    gap: spacing.xs,
    width: '100%',
  },
  selection: {
    alignItems: 'stretch',
    flex: 1,
    flexDirection: 'row',
  },
  selectionFill: {
    backgroundColor: BRUSH_FILL,
    borderBottomColor: BRUSH_STROKE,
    borderTopColor: BRUSH_STROKE,
    borderBottomWidth: 1,
    borderTopWidth: 1,
    flex: 1,
  },
  track: {
    backgroundColor: BRUSH_FILL,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    width: '100%',
  },
});
