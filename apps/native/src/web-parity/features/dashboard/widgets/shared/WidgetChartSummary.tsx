// Native parity port of web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx.
//
// `WidgetChartSummary` is the shared dashboard-widget body that pairs a compact
// row of summary stats with a chart slot (or surfaces an empty state). It is the
// canonical building block consumed by ~16 chart widgets (ChargeSessionChart,
// ClimateHistory, DriveTelemetry, SpeedProfile, MotorHistory, …) which until now
// each reproduced it locally; this is the shared native port of that module.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3):
//   - The `WidgetChartSummaryProps` shape (stats, chart, compact?, emptyMessage?,
//     emptyIcon?, isEmpty?) (L11-18) and the exported `ChartSummaryStat` type
//     (label, value: string | number, unit?) (L5-9) are kept verbatim.
//   - `isEmpty` short-circuits to the empty state with the same
//     `emptyMessage ?? 'No data available'` fallback + the optional icon (L28-30).
//   - The stat row only renders when `stats.length > 0` (L34); each stat is keyed
//     by `stat.label` (L45-46) and stacks the label over the value, with the
//     optional `stat.unit` rendered inline after the value (L47-55).
//   - The chart slot only renders when `!compact` (L61).
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - `@/components/feedback` `EmptyState` (L2) -> its web-parity port is not yet
//     created, so the icon+message subset this component uses is reproduced
//     locally as `<LocalEmptyState>` (centred column, muted icon with mb-4
//     spacing, centred muted message), mirroring the real EmptyState's
//     `items-center justify-center text-center` layout. The source's "no-action
//     transient empty state" intent is preserved verbatim. Filling the widget
//     body via flex:1 (vs the web's py-16 natural-height block) keeps the empty
//     state centred inside the widget shell, matching the sibling widget ports.
//   - `@/lib/cn` `cn` (L3) -> Tailwind class concatenation has no native analog;
//     the `cn(compact ? … : …)` stat-row layout selection (L36-43) becomes
//     conditional StyleSheet selection. CSS grid + the `@sm` container query are
//     not available in React Native, so the layout intent is reproduced with
//     flexbox: compact forces a 2-up grid (each item flex-basis ~45% + row wrap,
//     matching `grid grid-cols-2`); non-compact lets items grow in a wrapping
//     horizontal row (matching the `@sm:flex` relaxation). gap-2 -> 8px row/
//     column gap; gap-4 -> 16px column gap.
//
// `<div>`/`<span>` -> `<View>`/`<AppText>`; `truncate` -> `numberOfLines={1}`
// (ellipsised); Tailwind spacing -> px (1u = 4px: gap-2->8, gap-4->16, mt-2->8,
// mb-4->16, ml-0.5->a leading space, text-[10px]->10, text-sm->14); the
// `font-semibold`/`font-normal` weights and `var(--text-muted)`/
// `var(--text-primary)` map to the theme tokens so the light/dark cascade is
// preserved at the token boundary. No DOM elements, Recharts, Leaflet, or old web
// UI components are imported — only RN primitives, AppText, and theme tokens.

import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../../../../components/ui/AppText';
import { colors, spacing } from '../../../../../theme/tokens';

export interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

interface WidgetChartSummaryProps {
  stats: ChartSummaryStat[];
  chart: ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  isEmpty?: boolean;
}

// Native reproduction of the icon+message subset of the web
// `@/components/feedback` EmptyState (its web-parity port is not yet created).
function LocalEmptyState({
  icon,
  message,
}: {
  icon?: ReactNode;
  message: string;
}) {
  // no-action: transient empty state — surfaces when source data is missing; no
  // specific recovery action available.
  return (
    <View style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

export function WidgetChartSummary({
  stats,
  chart,
  compact,
  emptyMessage,
  emptyIcon,
  isEmpty,
}: WidgetChartSummaryProps) {
  if (isEmpty) {
    return (
      <LocalEmptyState
        icon={emptyIcon}
        message={emptyMessage ?? 'No data available'}
      />
    );
  }

  return (
    <View style={styles.root}>
      {stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map(stat => (
            <View
              key={stat.label}
              style={[styles.statItem, compact ? styles.statItemCompact : null]}>
              <AppText style={styles.statLabel} numberOfLines={1}>
                {stat.label}
              </AppText>
              <AppText style={styles.statValue} numberOfLines={1}>
                {stat.value}
                {stat.unit ? (
                  <AppText style={styles.statUnit}>{` ${stat.unit}`}</AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? <View style={styles.chartArea}>{chart}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chartArea: {
    flex: 1, // min-h-0 flex-1
    marginTop: spacing.sm, // mt-2
  },
  emptyIcon: {
    marginBottom: 16, // mb-4
  },
  emptyMessage: {
    textAlign: 'center', // text-center
  },
  emptyState: {
    alignItems: 'center', // items-center
    flex: 1,
    justifyContent: 'center', // justify-center
    paddingVertical: spacing.lg, // ~py-16, centred within the widget body
  },
  root: {
    flex: 1, // flex h-full flex-col
  },
  statItem: {
    flexDirection: 'column', // flex flex-col
    flexGrow: 1, // @sm:flex — values breathe across the row
    flexShrink: 1,
    minWidth: 0, // min-w-0
  },
  statItemCompact: {
    flexBasis: '45%', // grid grid-cols-2 (compact)
    flexGrow: 0,
  },
  statLabel: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 10, // text-[10px]
  },
  statUnit: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 10, // text-[10px]
    fontWeight: '400', // font-normal
  },
  statValue: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
  },
  statsRow: {
    columnGap: 16, // @sm:gap-4
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm, // gap-2
  },
});
