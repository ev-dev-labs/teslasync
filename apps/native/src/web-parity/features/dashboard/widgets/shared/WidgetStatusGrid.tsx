// Native parity port of
// web/src/features/dashboard/widgets/shared/WidgetStatusGrid.tsx.
//
// The web grid renders a responsive container-query grid of status cells; each
// cell shows a status-tinted background + border, a corner status dot, an
// optional leading icon, a truncated label, and (unless compact) a value line.
// The web `cn`/Tailwind/DOM `<div>`/`<span>` stack and the
// `@/components/feedback` `EmptyState` (react-router-dom Link + Button +
// Typography — browser-only) have no native parity, so they are replaced with
// View/AppText + StyleSheet and an inlined native-safe `WidgetEmptyState`
// (icon + muted message, web role="status" -> accessibilityLiveRegion="polite"),
// mirroring the RangeBarWidget precedent.
//
// Tailwind container-query column classes (`@xs`/`@sm` breakpoints) cannot be
// expressed statically in React Native (no container queries), so each resolved
// column count maps to a fixed flexBasis grid (the fully-expanded layout). The
// status palette is preserved as literal hex/rgba: emerald-500 #10b981,
// amber-500 #f59e0b, red-500 #ef4444, --surface-2 #151621, and the white/[0.03]
// /white/[0.06] inactive tints. See the parity sidecar for the line-by-line map.

import React, {type ReactNode} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {spacing} from '../../../../../theme/tokens';

const SURFACE_2 = '#151621'; // --surface-2

export interface StatusCell {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'inactive' | 'unknown';
  value?: string;
  icon?: ReactNode;
}

interface WidgetStatusGridProps {
  cells: StatusCell[];
  cols?: 2 | 3 | 4;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

/** Per-status background, border, and dot colours (web statusStyles, flattened). */
const statusStyles: Record<
  StatusCell['status'],
  {bg: string; border: string; dot: string}
> = {
  ok: {
    bg: 'rgba(16, 185, 129, 0.1)',
    border: 'rgba(16, 185, 129, 0.2)',
    dot: '#10b981',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.1)',
    border: 'rgba(245, 158, 11, 0.2)',
    dot: '#f59e0b',
  },
  error: {
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.2)',
    dot: '#ef4444',
  },
  inactive: {
    bg: 'rgba(255, 255, 255, 0.03)',
    border: 'rgba(255, 255, 255, 0.06)',
    dot: SURFACE_2,
  },
  unknown: {
    bg: 'rgba(255, 255, 255, 0.03)',
    border: 'rgba(255, 255, 255, 0.06)',
    dot: SURFACE_2,
  },
};

// Container-query class table — collapses based on widget rendered width.
// Native has no container queries, so each resolved column count maps to a
// fixed flexBasis (the fully-expanded grid). See WidgetStatGrid for the same
// approach.
const containerColsBasis: Record<2 | 3 | 4, DimensionValue> = {
  2: '46%',
  3: '31%',
  4: '21%',
};

export function WidgetStatusGrid({
  cells,
  cols = 2,
  compact = false,
  emptyMessage = 'No status data available',
  emptyIcon,
}: WidgetStatusGridProps) {
  if (cells.length === 0) {
    return <WidgetEmptyState icon={emptyIcon} message={emptyMessage} />;
  }

  const resolvedCols = compact ? 2 : cols;

  return (
    <View style={styles.grid}>
      {cells.map(cell => {
        const style = statusStyles[cell.status];
        return (
          <View
            key={cell.id}
            style={[
              styles.cell,
              {backgroundColor: style.bg, borderColor: style.border},
              {flexBasis: containerColsBasis[resolvedCols]},
              compact && styles.cellCompact,
            ]}>
            {/* Status dot — top-right corner */}
            <View style={[styles.dot, {backgroundColor: style.dot}]} />

            {cell.icon ? <View style={styles.icon}>{cell.icon}</View> : null}

            <View style={styles.cellBody}>
              <AppText numberOfLines={1} tone="secondary" variant="caption">
                {cell.label}
              </AppText>
              {!compact && cell.value ? (
                <AppText numberOfLines={1} style={styles.value}>
                  {cell.value}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

WidgetStatusGrid.displayName = 'WidgetStatusGrid';

/* ─── inlined WidgetEmptyState (web @/components/feedback EmptyState) ────────── */

function WidgetEmptyState({
  icon,
  message,
}: {
  icon?: ReactNode;
  message: string;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'relative',
  },
  cellBody: {
    flex: 1,
    minWidth: 0,
  },
  cellCompact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  dot: {
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    width: 8,
  },
  emptyMessage: {
    fontSize: 14,
    maxWidth: 360,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  icon: {
    flexShrink: 0,
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});
