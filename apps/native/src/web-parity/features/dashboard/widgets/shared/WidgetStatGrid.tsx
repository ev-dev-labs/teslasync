// Native parity port of web/src/features/dashboard/widgets/shared/WidgetStatGrid.tsx.
//
// `WidgetStatGrid` is the shared dashboard-widget body that lays out a responsive
// grid of stat cards (or surfaces an empty state). It is consumed by ~13 widgets
// (FleetStatsBar, EnergyStats, MileageStats, NotificationStats, APIUsage, …).
//
// Behaviour preserved 1:1 with the web source (conversion rule 3):
//   - The exported `StatGridItem` interface (label, value: string | number, unit?,
//     icon?: ReactNode, trend?: 'up'|'down'|'flat', trendValue?, valueColor?)
//     (L6-14) and the `WidgetStatGridProps` shape (stats, compact?, cols?: 2|3|4)
//     (L16-20) are ported verbatim.
//   - `autoCols(count)` (L22-26) — count%3===0 -> 3, count%4===0 -> 4, else 2 — is
//     ported verbatim (pure logic).
//   - The empty branch returns the empty state with the same literal
//     "No stats available" message (L44-46; the source has no i18n here so the
//     literal is preserved as-is — i18n intent unchanged).
//   - `resolvedCols = compact ? 1 : (cols ?? autoCols(stats.length))` (L48) is
//     ported verbatim.
//   - Each stat is keyed by `stat.label` (L54) and maps label/value/unit/icon and
//     the trend (direction: stat.trend, value: stat.trendValue, positive:
//     stat.trend === 'up') only when both stat.trend && stat.trendValue exist
//     (L59-67); `valueColor` colours the value (L68).
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - `StatCard` from @/components/data-display (L2): its web-parity port is not
//     yet created, so the subset WidgetStatGrid uses (label, value, unit, icon,
//     trend, className=valueColor) is reproduced locally as <LocalStatCard>,
//     mirroring the web StatCard markup: a Card (rounded-lg border bg-surface-1)
//     with a label+icon header row (text-sm font-medium muted), a value row
//     (text-2xl font-bold; the value inherits the web Card's `className`/valueColor,
//     so valueColor is applied to the value here) with the optional muted unit, and
//     the optional trend row (text-xs; ↑/↓/— + green-600 / muted / red-600). The
//     web Card `shadow-sm` has no faithful cross-platform native analog and is
//     omitted.
//   - `EmptyState` from @/components/feedback (L3): its web-parity port is not yet
//     created, so the message subset is reproduced locally as <LocalEmptyState>
//     (centred muted message), the WidgetChartSummary sibling precedent. The
//     source's "no-action transient empty state" intent is preserved verbatim.
//   - `cn` from @/lib/cn (L4): Tailwind class concat has no native analog.
//   - `containerColsClass` (L28-41): CSS grid + the @container query
//     (`@xs`≈16rem≈256px, `@sm`≈24rem≈384px) do not exist in React Native, so the
//     responsive collapse is reproduced faithfully via an onLayout width
//     measurement of the grid's own rendered width (matching the source's
//     container-query semantics) + `resolveContainerCols`, which applies the SAME
//     thresholds: cols 1/2 never collapse; cols 3 -> 1 (<256) / 2 (<384) / 3; cols
//     4 -> 2 (<384) / 4. Once measured, each cell gets an exact pixel width =
//     (gridWidth - gap*(cols-1)) / cols with a columnGap gutter; before the first
//     layout pass (and in tests where onLayout does not fire) cells fall back to a
//     `${100/cols}%` flex-basis so every stat still renders. gap-2 -> 8px (compact),
//     gap-3 -> 12px.
//
// `<div>`/`<span>` -> `<View>`/`<AppText>`; Tailwind spacing -> px (1u = 4px:
// p-4->16, gap-1->4, gap-2->8, gap-3->12); rounded-lg -> borderRadius 12;
// font weights map to RN fontWeight; var(--text-*) -> the theme tokens so the
// light/dark cascade is preserved at the token boundary; the named Tailwind value
// colours used as `valueColor` are kept as their palette hex. No DOM elements,
// Recharts, Leaflet, or old web UI components are imported — only RN primitives,
// AppText, and theme tokens.

import React, { useCallback, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
} from 'react-native';

import { AppText } from '../../../../../components/ui/AppText';
import { colors, spacing } from '../../../../../theme/tokens';

export interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  valueColor?: string;
}

interface WidgetStatGridProps {
  stats: StatGridItem[];
  compact?: boolean;
  cols?: 2 | 3 | 4;
}

function autoCols(count: number): 2 | 3 | 4 {
  if (count % 3 === 0) return 3;
  if (count % 4 === 0) return 4;
  return 2;
}

// Named Tailwind value colours (kept as palette hex). These are the classes the
// web consumers pass as `valueColor` (text-red-400 / text-emerald-300 / …);
// unknown classes resolve to undefined so the value keeps its primary tone.
const VALUE_COLOR_MAP: Record<string, string> = {
  'text-red-400': '#f87171',
  'text-red-500': '#ef4444',
  'text-emerald-300': '#6ee7b7',
  'text-emerald-400': '#34d399',
  'text-emerald-500': '#10b981',
  'text-amber-300': '#fcd34d',
  'text-cyan-300': '#67e8f9',
  'text-white': colors.textPrimary,
};

function resolveValueColor(valueColor?: string): string | undefined {
  if (!valueColor) return undefined;
  return VALUE_COLOR_MAP[valueColor];
}

// Trend tints (web text-green-600 / text-red-600).
const TREND_GREEN_600 = '#16a34a';
const TREND_RED_600 = '#dc2626';

// Native reproduction of the container-query class table (source L28-41). RN has
// no @container query, so we reproduce the same collapse from the grid's own
// rendered width using Tailwind's @xs (~256px) / @sm (~384px) thresholds.
function resolveContainerCols(target: 1 | 2 | 3 | 4, width: number): 1 | 2 | 3 | 4 {
  if (target <= 2) return target; // grid-cols-1 / grid-cols-2 — never collapse
  if (target === 3) {
    // grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3
    if (width < 256) return 1;
    if (width < 384) return 2;
    return 3;
  }
  // target === 4 -> grid-cols-2 @sm:grid-cols-4
  if (width < 384) return 2;
  return 4;
}

// Native reproduction of the icon+message subset of @/components/feedback
// EmptyState (its web-parity port is not yet created).
function LocalEmptyState({ message }: { message: string }) {
  // no-action: transient empty state — surfaces when source data is missing; no
  // specific recovery action available.
  return (
    <View style={styles.emptyState}>
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// Native reproduction of the @/components/data-display StatCard subset that
// WidgetStatGrid consumes (label, value, unit, icon, trend, valueColor).
function LocalStatCard({
  label,
  value,
  unit,
  icon,
  trend,
  valueColor,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: { direction: 'up' | 'down' | 'flat'; value: string; positive?: boolean };
  valueColor?: string;
}) {
  const resolvedValueColor = resolveValueColor(valueColor);
  const trendColor = trend
    ? trend.positive
      ? TREND_GREEN_600
      : trend.direction === 'flat'
        ? colors.textMuted
        : TREND_RED_600
    : undefined;
  const trendArrow =
    trend?.direction === 'up' ? '↑' : trend?.direction === 'down' ? '↓' : '—';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <AppText tone="muted" style={styles.cardLabel} numberOfLines={1}>
          {label}
        </AppText>
        {icon ? <View style={styles.cardIcon}>{icon}</View> : null}
      </View>
      <View style={styles.cardValueRow}>
        <AppText
          style={[
            styles.cardValue,
            resolvedValueColor ? { color: resolvedValueColor } : null,
          ]}
          numberOfLines={1}>
          {value}
        </AppText>
        {unit ? (
          <AppText tone="muted" style={styles.cardUnit}>
            {unit}
          </AppText>
        ) : null}
      </View>
      {trend ? (
        <View style={styles.cardTrendRow}>
          <AppText style={[styles.cardTrendText, { color: trendColor }]}>
            {trendArrow}
          </AppText>
          <AppText style={[styles.cardTrendText, { color: trendColor }]}>
            {trend.value}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

export function WidgetStatGrid({ stats, compact, cols }: WidgetStatGridProps) {
  const [gridWidth, setGridWidth] = useState(0);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (Number.isFinite(width) && width > 0) {
      setGridWidth(width);
    }
  }, []);

  if (stats.length === 0) {
    return <LocalEmptyState message="No stats available" />;
  }

  const resolvedCols = compact ? 1 : cols ?? autoCols(stats.length);
  const gap = compact ? 8 : 12; // gap-2 / gap-3

  const measured = gridWidth > 0;
  const effectiveCols = resolveContainerCols(
    resolvedCols,
    measured ? gridWidth : Number.POSITIVE_INFINITY,
  );
  const itemWidth = measured
    ? (gridWidth - gap * (effectiveCols - 1)) / effectiveCols
    : undefined;
  const fallbackBasis = `${100 / effectiveCols}%` as DimensionValue;

  return (
    <View
      onLayout={handleLayout}
      style={[styles.grid, { rowGap: gap }, measured ? { columnGap: gap } : null]}>
      {stats.map(stat => (
        <View
          key={stat.label}
          style={
            itemWidth != null
              ? { width: itemWidth }
              : { flexBasis: fallbackBasis }
          }>
          <LocalStatCard
            label={stat.label}
            value={stat.value}
            unit={stat.unit}
            icon={stat.icon}
            trend={
              stat.trend && stat.trendValue
                ? {
                    direction: stat.trend,
                    value: stat.trendValue,
                    positive: stat.trend === 'up',
                  }
                : undefined
            }
            valueColor={stat.valueColor}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, // bg-[var(--surface-1)]
    borderColor: colors.border, // border-[var(--glass-border)]
    borderRadius: 12, // rounded-lg
    borderWidth: 1,
    gap: spacing.xs, // gap-1
    padding: 16, // p-4
  },
  cardHeaderRow: {
    alignItems: 'center', // items-center
    flexDirection: 'row',
    justifyContent: 'space-between', // justify-between
  },
  cardIcon: {
    // text-[var(--text-muted)] icon slot
  },
  cardLabel: {
    flexShrink: 1,
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
  },
  cardTrendRow: {
    alignItems: 'center', // items-center
    columnGap: spacing.xs, // gap-1
    flexDirection: 'row',
  },
  cardTrendText: {
    fontSize: 12, // text-xs
  },
  cardUnit: {
    fontSize: 14, // text-sm
  },
  cardValue: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 24, // text-2xl
    fontWeight: '700', // font-bold
  },
  cardValueRow: {
    alignItems: 'baseline', // items-baseline
    columnGap: spacing.xs, // gap-1
    flexDirection: 'row',
  },
  emptyMessage: {
    textAlign: 'center', // text-center
  },
  emptyState: {
    alignItems: 'center', // items-center
    justifyContent: 'center', // justify-center
    paddingVertical: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap', // grid -> wrapping flex row
  },
});
