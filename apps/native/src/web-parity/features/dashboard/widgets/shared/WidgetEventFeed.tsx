// Native parity port of
// web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx.
//
// The shared dashboard "event feed": a reusable list that takes a set of
// EventFeedItem entries, sorts them newest-first, slices to a maxItems limit
// (defaulting to 3 in compact mode / 10 otherwise), and renders each as a
// timeline row (status-coloured icon chip + connector rail + title / optional
// subtitle / relative-time). When the list is empty it falls back to an
// EmptyState. When an item carries an `href`, the entire row becomes a
// navigable affordance for alert drill-through.
//
// Behaviour, the exported surface (`EventFeedItem` + `WidgetEventFeed`), every
// prop name (items, maxItems, compact, emptyMessage, emptyIcon), the EventFeedItem
// field set, the `limit = maxItems ?? (compact ? 3 : 10)` rule, the
// timestamp-descending sort + slice, and the `formatRelativeTime`
// ("Just now" / "Nm ago" / "Nh ago" / else absolute date-time) ladder are all
// preserved verbatim.
//
// Native adaptations (each documented in the sidecar):
//   - The web `<div className="space-y-0 overflow-y-auto h-full">` scroll
//     container -> a React Native `ScrollView` (overflow-y-auto + h-full).
//   - TimelineItem (web data-display, react-router-dom `<Link>`) is reproduced
//     inline as `TimelineRow` using RN primitives: the same 32×32 `${color}15`
//     icon chip, the `w-px` connector shown for every row except the last, and
//     the title (font-medium, truncate) / subtitle / 10px relative-time stack.
//   - react-router-dom `<Link to={href}>` is browser-only and there is no
//     router in the native layer. The `href` field is preserved on
//     EventFeedItem, and when set the row is rendered as a `Pressable` with
//     `accessibilityRole="link"` (so the whole-row link affordance + the web's
//     `hover:bg-white/[0.04]` press feedback survive). Actual navigation is
//     surfaced through an optional native-only `onNavigate?: (href) => void`
//     prop the caller can wire to React Navigation; with no handler the press
//     is a no-op — the explicit "navigation unavailable" state — while the
//     target is still carried as data.
//   - feedback.EmptyState -> the shared native EmptyState (web single `message`
//     -> native `title`, empty `message`). The web EmptyState's `icon` slot has
//     no native equivalent, so the optional `emptyIcon` ReactNode is rendered
//     in a centred wrapper directly above the EmptyState when supplied.
//   - react-i18next `useTranslation('dashboard')` is not wired in native
//     (react-i18next is not a native dependency); the lone `widget.noEvents`
//     key is resolved through a local `t(key, default)` that returns the
//     English default exactly as i18next would for a missing translation.
//   - `useDateFormat()` -> the native web-parity `useDateFormat` hook, whose
//     `formatDateTime` powers the post-24h absolute fallback, preserving the
//     source's locale + timezone-aware formatting.
//
// No DOM, react-router-dom, framer-motion, lucide-react, Recharts, Leaflet, or
// old web UI components are imported into the native output.

import React, {useMemo, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {useDateFormat} from '../../../../hooks/useDateFormat';

/* ─── i18n fallback (mirrors i18next default-value behaviour) ──────────────── */

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping the `widget.noEvents` key verbatim.
function t(key: string, fallback: string): string {
  return fallback ?? key;
}

/* ─── EventFeedItem (exported, web .../shared WidgetEventFeed) ─────────────── */

export interface EventFeedItem {
  id: string | number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
  /** Optional navigation target. When set, the entire row becomes a navigable
   *  affordance (web `<Link>`); native surfaces it through `onNavigate`. */
  href?: string;
}

interface WidgetEventFeedProps {
  items: EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  /** Native-only replacement for the web `<Link to={href}>` drill-through.
   *  Invoked with `item.href` when a row with an `href` is pressed. */
  onNavigate?: (href: string) => void;
}

/* ─── TimelineRow (web data-display TimelineItem) ─────────────────────────── */

function TimelineRow({
  item,
  time,
  isLast,
  onNavigate,
}: {
  item: EventFeedItem;
  time: string;
  isLast: boolean;
  onNavigate?: (href: string) => void;
}) {
  const body = (
    <>
      <View style={styles.rail}>
        <View style={[styles.iconChip, {backgroundColor: `${item.color}15`}]}>
          {item.icon}
        </View>
        {!isLast ? <View style={styles.connector} /> : null}
      </View>
      <View style={styles.rowBody}>
        <AppText numberOfLines={1} style={styles.title}>
          {item.title}
        </AppText>
        {item.subtitle ? (
          <AppText variant="caption" tone="muted" style={styles.subtitle}>
            {item.subtitle}
          </AppText>
        ) : null}
        <AppText variant="caption" tone="muted" style={styles.time}>
          {time}
        </AppText>
      </View>
    </>
  );

  if (item.href) {
    const href = item.href;
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() => onNavigate?.(href)}
        style={({pressed}) => [
          styles.row,
          styles.rowLink,
          pressed ? styles.rowPressed : null,
        ]}
        testID={`widget-event-feed-row-${item.id}`}>
        {body}
      </Pressable>
    );
  }

  return (
    <View style={styles.row} testID={`widget-event-feed-row-${item.id}`}>
      {body}
    </View>
  );
}

/* ─── WidgetEventFeed (exported) ──────────────────────────────────────────── */

export function WidgetEventFeed({
  items,
  maxItems,
  compact = false,
  emptyMessage,
  emptyIcon,
  onNavigate,
}: WidgetEventFeedProps) {
  const {formatDateTime} = useDateFormat();

  function formatRelativeTime(isoStr: string): string {
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) {
      return 'Just now';
    }
    if (diffMin < 60) {
      return `${diffMin}m ago`;
    }
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) {
      return `${diffHrs}h ago`;
    }
    return formatDateTime(isoStr);
  }

  const limit = maxItems ?? (compact ? 3 : 10);

  const sorted = useMemo(
    () =>
      [...items]
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, limit),
    [items, limit],
  );

  if (sorted.length === 0) {
    return (
      <View style={styles.empty} testID="widget-event-feed-empty">
        {emptyIcon ? (
          <View style={styles.emptyIcon} accessibilityElementsHidden>
            {emptyIcon}
          </View>
        ) : null}
        <EmptyState
          title={emptyMessage ?? t('widget.noEvents', 'No events yet')}
          message=""
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.feed}
      contentContainerStyle={styles.feedContent}
      showsVerticalScrollIndicator={false}
      testID="widget-event-feed">
      {sorted.map((item, i) => (
        <TimelineRow
          key={item.id}
          item={item}
          time={formatRelativeTime(item.timestamp)}
          isLast={i === sorted.length - 1}
          onNavigate={onNavigate}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  feed: {
    flex: 1,
    minHeight: 0,
  },
  feedContent: {
    flexGrow: 1,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  emptyIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    columnGap: spacing.md,
  },
  rowLink: {
    marginHorizontal: -spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: 6,
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  rail: {
    alignItems: 'center',
  },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    width: StyleSheet.hairlineWidth,
    flex: 1,
    marginTop: 4,
    backgroundColor: colors.surfaceRaised,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  time: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
});
