// Native parity port of
// web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx.
//
// The web component is the shared dashboard "ranked list" presenter: a
// vertically scrollable list of items sorted by value descending, capped at a
// limit (compact -> 3, else 5, overridable via maxItems). Each row shows an
// optional translucent background "rank bar" (width proportional to the row's
// share of the max value), a 1-based rank number, a truncated label, an
// optional status badge, and a right-aligned formatted value. When there are no
// items it renders an EmptyState. It is a pure presentational component, so the
// native port preserves the exact sorting/limit/bar math and layout/visual
// intent with React Native primitives + theme tokens.
//
// Web dependencies that have no DOM in native are mapped as follows
// (mirroring the sibling WidgetBigNumber / ProjectedRangeWidget ports):
//   • @/components/feedback EmptyState -> the already-ported native parity
//     EmptyState (web-parity/components/feedback/EmptyState), which accepts the
//     same icon + message props and a native `style` in place of `className`.
//   • @/components/ui Badge (size="sm") -> a local native pill
//     (success/warning/danger/neutral) backed by the theme surface/foreground
//     tokens, with the web badgeVariantMap (error -> danger) preserved.
//   • @/lib/cn -> dropped; React Native has no class names. The web
//     cn('...absolute bar...', item.barColor ?? 'bg-blue-400') merge becomes a
//     StyleSheet style + a dynamic { backgroundColor } override, and the
//     barColor prop now carries a native color string (web default Tailwind
//     `bg-blue-400` -> native '#60a5fa'), documented on the prop.
//
// Tailwind -> native mapping: the outer overflow-y-auto div + flex-col gap-1 ul
// -> a ScrollView whose contentContainerStyle supplies the 4px row gap; each
// rounded-lg min-h-[44px] px-3 py-2 li -> a 44px-min, 8px-radius, 12/8-padded
// View; the absolute inset-y-0 left-0 rounded-lg opacity-15 bar -> an absolutely
// positioned View (top/bottom/left 0, radius 8, opacity 0.15) with a dynamic
// percentage width; the relative flex items-center gap-3 row -> a 12px-gap row;
// w-5 text-right text-xs font-medium text-[var(--text-muted)] rank -> 20px-wide
// right-aligned 12px/500 muted text; min-w-0 flex-1 truncate text-sm
// text-[var(--text-primary)] label -> a flex-1 14px primary AppText with
// numberOfLines={1}; text-sm font-semibold tabular-nums text-[var(--text-primary)]
// value -> a 14px/600 tabular-nums primary AppText. The hover:bg-[var(--surface-2)]
// affordance has no native analog and is dropped (documented in the sidecar).
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, or web
// UI-kit modules are imported into the native output.

import React, {useMemo, type ReactNode} from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {EmptyState} from '../../../../components/feedback/EmptyState';

// web ./shared WidgetRankedList default bar color: Tailwind `bg-blue-400`.
const DEFAULT_BAR_COLOR = '#60a5fa';

export interface RankedItem {
  id: string | number;
  label: string;
  value: number;
  formattedValue: string;
  badge?: {text: string; variant: 'success' | 'warning' | 'error' | 'neutral'};
  /**
   * Native color string for the row's background rank bar. Mirrors the web
   * `barColor` Tailwind class prop (web default `bg-blue-400` -> '#60a5fa').
   */
  barColor?: string;
}

interface WidgetRankedListProps {
  items: RankedItem[];
  maxItems?: number;
  compact?: boolean;
  showBars?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  /** Native-only testing hook; absent from the web source. */
  testID?: string;
}

/* ─── @/components/ui Badge (pill, size="sm") ────────────────────────────── */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_PALETTE: Record<BadgeVariant, {bg: string; fg: string}> = {
  danger: {bg: colors.dangerSurface, fg: colors.danger},
  neutral: {bg: colors.surfaceRaised, fg: colors.textMuted},
  success: {bg: colors.successSurface, fg: colors.success},
  warning: {bg: colors.warningSurface, fg: colors.warning},
};

function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  const palette = BADGE_PALETTE[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}]}>
      <AppText numberOfLines={1} style={[styles.badgeText, {color: palette.fg}]}>
        {children}
      </AppText>
    </View>
  );
}

// web ./shared WidgetRankedList badgeVariantMap (error -> danger).
const badgeVariantMap: Record<
  'success' | 'warning' | 'error' | 'neutral',
  BadgeVariant
> = {
  error: 'danger',
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
};

export function WidgetRankedList({
  items,
  maxItems,
  compact = false,
  showBars = true,
  emptyMessage = 'No data available',
  emptyIcon,
  testID,
}: WidgetRankedListProps) {
  const limit = maxItems ?? (compact ? 3 : 5);
  const hideBars = compact || !showBars;

  const visible = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.value - a.value);
    return sorted.slice(0, limit);
  }, [items, limit]);

  const maxValue = useMemo(
    () => visible.reduce((max, item) => Math.max(max, item.value), 0),
    [visible],
  );

  if (visible.length === 0) {
    return (
      <EmptyState icon={emptyIcon} message={emptyMessage} style={styles.empty} />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.list} testID={testID}>
      {visible.map((item, index) => {
        const barPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        const barWidth: DimensionValue = `${barPct}%`;

        return (
          <View key={item.id} style={styles.row}>
            {/* Background bar */}
            {!hideBars ? (
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: item.barColor ?? DEFAULT_BAR_COLOR,
                    width: barWidth,
                  },
                ]}
              />
            ) : null}

            {/* Row content */}
            <View style={styles.rowContent}>
              {/* Rank number */}
              <AppText style={styles.rank} tone="muted">
                {index + 1}
              </AppText>

              {/* Label */}
              <AppText numberOfLines={1} style={styles.label}>
                {item.label}
              </AppText>

              {/* Badge */}
              {item.badge ? (
                <Badge variant={badgeVariantMap[item.badge.variant]}>
                  {item.badge.text}
                </Badge>
              ) : null}

              {/* Value */}
              <AppText style={styles.value} weight="semibold">
                {item.formattedValue}
              </AppText>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

WidgetRankedList.displayName = 'WidgetRankedList';

const styles = StyleSheet.create({
  // web EmptyState className="py-8" override (py-16 default -> 32px).
  empty: {
    paddingVertical: 32,
  },
  // web <ul className="flex flex-col gap-1"> inside overflow-y-auto.
  list: {
    gap: spacing.xs,
  },
  // web <li className="relative min-h-[44px] rounded-lg px-3 py-2">.
  row: {
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'relative',
  },
  // web background bar: absolute inset-y-0 left-0 rounded-lg opacity-15.
  bar: {
    borderRadius: 8,
    bottom: 0,
    left: 0,
    opacity: 0.15,
    position: 'absolute',
    top: 0,
  },
  // web row content: relative flex items-center gap-3.
  rowContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  // web w-5 shrink-0 text-right text-xs font-medium text-[var(--text-muted)].
  rank: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'right',
    width: 20,
  },
  // web min-w-0 flex-1 truncate text-sm text-[var(--text-primary)].
  label: {
    flex: 1,
    fontSize: 14,
  },
  // web shrink-0 text-sm font-semibold tabular-nums text-[var(--text-primary)].
  value: {
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  // web Badge size="sm": px-1.5 py-0.5 text-xs font-medium rounded-full.
  badge: {
    borderRadius: 9999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
