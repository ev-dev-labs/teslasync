// WidgetDetailCard — native parity port of
// web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx.
//
// A shared dashboard-widget primitive: a vertically scrollable list of
// label/value rows, each optionally carrying a colored status Badge and/or a
// monospace value. When the entry list is empty it collapses to an EmptyState.
// Every prop, the DetailEntry shape, the badgeVariantMap lookup, the
// `compact` slice(0,4) cap, the per-row divider logic, the value `?? '—'`
// fallback, and the empty-list branch are preserved verbatim from the web
// source; all 80 source lines are mapped in the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / types preserved):
//   - `import { type ReactNode } from 'react'` (web L1) -> the same type import,
//     plus the React default import that the classic `jsx: "react-native"`
//     runtime requires (every native component in this tree imports React).
//   - @/components/ui Badge (web L2) -> an inline native Badge: the web Badge is
//     a DOM <span> (browser-only), so per the ChargeStatusWidget inline-
//     reproduction precedent it is reproduced self-contained as a rounded pill
//     (View + AppText) whose success/warning/danger/neutral variants map onto
//     the native success/warning/danger/surface tokens, sized like the web
//     `size="sm"` chip (px-1.5 py-0.5 text-xs).
//   - @/components/feedback EmptyState (web L3) -> an inline native EmptyState
//     (centered optional icon + muted message). The canonical native EmptyState
//     (components/feedback) takes {title, message} with no icon slot, so the
//     web {icon, message, className} usage is reproduced inline (same precedent
//     as ChargeStatusWidget).
//   - @/lib/cn cn (web L4) -> dropped; conditional className concatenation
//     becomes conditional StyleSheet arrays (RN's native styling idiom).
//   - the `<div className="overflow-y-auto h-full">` scroller (web L46) ->
//     a react-native ScrollView (flex:1); each `<div>` row -> a View, each
//     `<span>` -> an AppText/View. Tailwind truncation (`truncate min-w-0`)
//     becomes numberOfLines={1} + flexShrink, `font-mono` becomes a
//     Platform-selected monospace fontFamily, and the text-[var(--text-*)]
//     CSS-var colors become the matching theme tokens.
//
// No DOM elements, no @/components/ui Badge, no @/lib/cn, no react-i18next,
// Recharts, Leaflet, or old web-UI imports reach the native output — only
// react, react-native primitives, the canonical AppText, and theme tokens.

import React, {type ReactNode} from 'react';
import {Platform, ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';

export interface DetailEntry {
  label: string;
  value: string | number | null;
  badge?: {text: string; variant: 'success' | 'warning' | 'error' | 'neutral'};
  mono?: boolean;
}

interface WidgetDetailCardProps {
  entries: DetailEntry[];
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

// Maps a DetailEntry badge variant onto the native Badge variant set. Mirrors
// the web `badgeVariantMap` (error -> danger; success/warning/neutral pass
// through) so the same call sites resolve to the same chip color.
const badgeVariantMap = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
} as const;

type NativeBadgeVariant = (typeof badgeVariantMap)[keyof typeof badgeVariantMap];

// ── Inline native Badge (web @/components/ui Badge, size="sm") ────────────────

function Badge({
  variant,
  children,
}: {
  variant: NativeBadgeVariant;
  children: string;
}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText
        numberOfLines={1}
        style={[styles.badgeText, badgeTextStyles[variant]]}>
        {children}
      </AppText>
    </View>
  );
}

// ── Inline native EmptyState (web @/components/feedback EmptyState) ────────────

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessible accessibilityLabel={message} style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ── Main shared widget primitive ──────────────────────────────────────────────

export function WidgetDetailCard({
  entries,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetDetailCardProps) {
  if (entries.length === 0) {
    return (
      // no-action: transient empty state — surfaces when source data is missing;
      // no specific recovery action available.
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage ?? 'No details available'}
      />
    );
  }

  const visible = compact ? entries.slice(0, 4) : entries;

  return (
    <ScrollView style={styles.scroll}>
      {visible.map((entry, i) => (
        <View
          key={entry.label}
          style={[styles.row, i < visible.length - 1 && styles.rowDivider]}>
          <AppText numberOfLines={1} style={styles.label}>
            {entry.label}
          </AppText>
          <View style={styles.valueGroup}>
            <AppText
              numberOfLines={1}
              style={[styles.value, entry.mono && styles.valueMono]}>
              {entry.value ?? '—'}
            </AppText>
            {entry.badge && (
              <Badge variant={badgeVariantMap[entry.badge.variant]}>
                {entry.badge.text}
              </Badge>
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const monoFontFamily = Platform.select({ios: 'Courier', default: 'monospace'});

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMessage: {
    textAlign: 'center',
  },
  label: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  rowDivider: {
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: 1,
  },
  scroll: {
    flex: 1,
  },
  value: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
  valueGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
    justifyContent: 'flex-end',
  },
  valueMono: {
    fontFamily: monoFontFamily,
  },
});

const badgeVariantStyles = StyleSheet.create({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
});
