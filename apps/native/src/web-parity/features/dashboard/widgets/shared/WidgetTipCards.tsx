// WidgetTipCards — native parity port of
// web/src/features/dashboard/widgets/shared/WidgetTipCards.tsx.
//
// A shared dashboard-widget primitive: a vertically scrollable list of
// recommendation "tip" cards, each with an optional leading icon, a title, an
// optional colored impact Badge, and a description that can be clamped in
// compact mode. When the visible list is empty it collapses to an EmptyState.
// Every prop, the TipItem shape, the impactBadgeMap lookup, the
// `maxTips ?? (compact ? 1 : 3)` limit, the memoised `tips.slice(0, limit)`,
// the `impactLabel ?? impact` fallback, and the empty-list branch are preserved
// verbatim from the web source; all 89 source lines are mapped in the
// .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / types preserved):
//   - `import { useMemo, type ReactNode } from 'react'` (web L1) -> the same
//     useMemo + ReactNode imports, plus the React default import that the
//     classic `jsx: "react-native"` runtime requires (every native component in
//     this tree imports React). useMemo is retained verbatim for the visible
//     slice so render identity matches the web component.
//   - @/components/ui Badge (web L2) -> an inline native Badge: the web Badge is
//     a DOM <span> (browser-only), so per the WidgetDetailCard inline-
//     reproduction precedent it is reproduced self-contained as a rounded pill
//     (View + AppText) whose success/warning/neutral variants map onto the
//     native success/warning/surface tokens, sized like the web `size="sm"`
//     chip (px-1.5 py-0.5 text-xs rounded-full font-medium).
//   - @/components/feedback EmptyState (web L3) -> an inline native EmptyState
//     (centered optional icon + muted message). The canonical native EmptyState
//     (components/feedback) takes {title, message} with no icon slot, so the
//     web {icon, message, className="py-4"} usage is reproduced inline (same
//     precedent as WidgetDetailCard).
//   - @/lib/cn cn (web L4) -> dropped; the single cn() call site (description
//     compact line-clamp) becomes a conditional StyleSheet array + a
//     conditional numberOfLines, the RN-native styling idiom.
//   - the `<div className="space-y-2 overflow-y-auto h-full">` scroller
//     (web L51) -> a react-native ScrollView (flex:1) whose contentContainer
//     carries gap:8 (space-y-2). Each card `<div>` -> a View, each `<span>` ->
//     an AppText/View. Tailwind `line-clamp-2` becomes numberOfLines={2},
//     `min-w-0`/`flex-1`/`shrink-0` become flex/flexShrink, and the
//     text-[var(--text-*)] CSS-var colors become the matching theme tokens.
//     The web icon's `text-[var(--text-secondary)]` color cannot cascade onto
//     an arbitrary RN node, so the leading icon's color is the caller's
//     responsibility in native (the wrapper only handles position/shrink).
//
// No DOM elements, no @/components/ui Badge, no @/components/feedback
// EmptyState, no @/lib/cn, no react-i18next, Recharts, Leaflet, react-router,
// or old web-UI imports reach the native output — only react, react-native
// primitives, the canonical AppText, and theme tokens.

import React, {useMemo, type ReactNode} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';

export interface TipItem {
  id: string | number;
  icon?: ReactNode;
  title: string;
  description: string;
  impact?: 'high' | 'medium' | 'low';
  impactLabel?: string;
}

interface WidgetTipCardsProps {
  tips: TipItem[];
  maxTips?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

// Maps a TipItem impact level onto the native Badge variant set. Mirrors the
// web `impactBadgeMap` (high -> success, medium -> warning, low -> neutral) so
// the same impact resolves to the same chip color.
const impactBadgeMap = {
  high: 'success',
  medium: 'warning',
  low: 'neutral',
} as const;

type NativeBadgeVariant = (typeof impactBadgeMap)[keyof typeof impactBadgeMap];

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

export function WidgetTipCards({
  tips,
  maxTips,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetTipCardsProps) {
  const limit = maxTips ?? (compact ? 1 : 3);

  const visible = useMemo(() => tips.slice(0, limit), [tips, limit]);

  if (visible.length === 0) {
    return (
      // no-action: transient empty state — surfaces when source data is
      // missing; no specific recovery action available.
      <EmptyState icon={emptyIcon} message={emptyMessage ?? 'No recommendations'} />
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {visible.map((tip) => (
        <View key={tip.id} style={styles.card}>
          {tip.icon ? <View style={styles.icon}>{tip.icon}</View> : null}

          <View style={styles.content}>
            <View style={styles.header}>
              <AppText style={styles.title}>{tip.title}</AppText>
              {tip.impact && (
                <Badge variant={impactBadgeMap[tip.impact]}>
                  {tip.impactLabel ?? tip.impact}
                </Badge>
              )}
            </View>
            <AppText
              numberOfLines={compact ? 2 : undefined}
              style={styles.description}>
              {tip.description}
            </AppText>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

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
  card: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 44,
    padding: 12,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  description: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
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
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  icon: {
    flexShrink: 0,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 8,
  },
  title: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
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
  neutral: {
    color: colors.textSecondary,
  },
});
