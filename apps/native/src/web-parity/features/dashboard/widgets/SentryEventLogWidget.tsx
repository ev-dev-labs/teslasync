// Native parity port of web/src/features/dashboard/widgets/SentryEventLogWidget.tsx.
//
// The web widget is a dashboard "Sentry Event Log" tile. It resolves the target
// vehicle (vehicleId prop -> first useVehicles() row -> 0), polls that vehicle's
// recent security snapshots (useQuery(['security-events', id, `sentry-log-N`]) ->
// request('/security?vehicle_id={id}&limit={N}'), refetchInterval 30s, enabled
// when id > 0), maps each SecurityEvent to a human-readable feed item via
// deriveEvent() (door-open / sentry on / sentry off / locked / unlocked /
// generic, each with its own icon + hex colour + severity), and renders the
// result through <WidgetShell> + <WidgetEventFeed>. The event limit scales with
// the tile size (cols >= 3 -> 10, rows >= 2 -> 7, else 4) and the lock/sentry
// emoji subtitle is only shown on wide tiles.
//
// This native port preserves that contract 1:1 — identical vehicleId/id/isWide/
// isTall/eventLimit derivations, the same useVehicles() + useQuery() calls with
// the exact same queryKey, /security query path, enabled guard and 30_000ms
// refetch interval, the same deriveEvent() branch order + titles + hex colours +
// severities, the same feedItems mapping (id fallback `${vehicle_id}-${ts}`,
// created_at ?? ts timestamp, isWide-gated emoji subtitle joined with " · " /
// "—"), the same i18n keys + English defaults, and the same visual intent —
// using React Native primitives, the existing native AppText + design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?) =
//     fallback ?? key, preserving every key + English default.
//   - lucide-react Shield / Lock / Unlock / Eye / EyeOff / DoorOpen / DoorClosed
//     (web L4): DOM SVG icons -> emoji/glyph stand-ins, each tinted with the same
//     hex colour deriveEvent() assigns (so the timeline dot colour is identical).
//   - @/api/hooks/useVehicles useVehicles (web L5): the already-ported web-parity
//     useVehicles hook (same signature + /vehicles path + types).
//   - @/api/client request (web L6): the already-ported web-parity request<T>().
//   - @/api/types SecurityEvent (web L7): the already-ported web-parity type.
//   - @/lib/typeGuards asNonEmptyString (web L8): reproduced verbatim (string &&
//     length > 0 ? string : null).
//   - ./WidgetShell (web L9): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the pulse-on-update effect, and the inline
//     DataFreshness chip (its web Skeleton / QueryError / DataFreshness internals
//     reduced to native equivalents; dot-only `compact` when title-less).
//   - ./shared WidgetEventFeed / EventFeedItem (web L10): reproduced as a
//     native-safe <WidgetEventFeed> mirroring the web TimelineItem feed — sorted
//     newest-first, sliced to maxItems, each row a colour-tinted icon dot +
//     connector + title / optional subtitle / relative timestamp, with the same
//     formatRelativeTime ("Just now" / "{n}m ago" / "{n}h ago" / formatDateTime)
//     and EmptyState fallback; the web overflow-y-auto is reduced to a bounded
//     static column because the rows are already hard-capped by maxItems.
//   - ./types WidgetProps (web L11): the dashboard widget types module is not yet
//     ported, so the consumed subset (WidgetSize { cols, rows } + WidgetProps) is
//     mirrored as local interfaces.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {request} from '../../../api/client';
import type {SecurityEvent} from '../../../api/types';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (web L4)                              */
/* ------------------------------------------------------------------ */

const ICON_SHIELD = '\uD83D\uDEE1\uFE0F'; // 🛡️ (Shield)
const ICON_LOCK = '\uD83D\uDD12'; // 🔒 (Lock)
const ICON_UNLOCK = '\uD83D\uDD13'; // 🔓 (Unlock)
const ICON_EYE = '\uD83D\uDC41\uFE0F'; // 👁️ (Eye)
const ICON_EYE_OFF = '\uD83D\uDE48'; // 🙈 (EyeOff stand-in)
const ICON_DOOR_OPEN = '\uD83D\uDEAA'; // 🚪 (DoorOpen)
const ICON_DOOR_CLOSED = '\uD83D\uDD10'; // 🔐 (DoorClosed / generic state)

/* deriveEvent severity hex palette (web L25/33/41/49/57/64) */
const COLOR_DOOR_OPEN = '#f59e0b';
const COLOR_SENTRY_ON = '#06b6d4';
const COLOR_SENTRY_OFF = '#6b7280';
const COLOR_LOCKED = '#22c55e';
const COLOR_UNLOCKED = '#ef4444';
const COLOR_GENERIC = '#8b5cf6';

/* feedItems subtitle tokens (web L89-91) */
const EMOJI_LOCKED = '\uD83D\uDD12 Locked'; // 🔒 Locked
const EMOJI_UNLOCKED = '\uD83D\uDD13 Unlocked'; // 🔓 Unlocked
const EMOJI_SENTRY_ON = '\uD83D\uDEE1\uFE0F Sentry On'; // 🛡️ Sentry On
const SENTRY_OFF = 'Sentry Off';
const SUBTITLE_SEP = ' \u00B7 '; // " · "
const DASH = '\u2014'; // "—"

/* timeline connector + relative-time colours (web TimelineItem) */
const TIME_COLOR = '#4b5563'; // gray-600
const PULSE_GLOW = '#22c55e'; // shadow rgba(34,197,94,0.15)

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  ported: @/lib/typeGuards asNonEmptyString (web L8)                  */
/* ------------------------------------------------------------------ */

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/* ------------------------------------------------------------------ */
/*  ported: ./types WidgetProps (consumed subset of the web types)     */
/* ------------------------------------------------------------------ */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  ported: ./shared EventFeedItem (web L7-18)                          */
/* ------------------------------------------------------------------ */

export interface EventFeedItem {
  id: string | number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
}

/* ------------------------------------------------------------------ */
/*  native-safe formatters (web @/hooks/useDateFormat)                 */
/* ------------------------------------------------------------------ */

/** Port of web useDateFormat().formatDateTime — "Jun 24, 2:30 PM". */
function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return DASH;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return value;
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Port of WidgetEventFeed.formatRelativeTime (web shared L38-48). */
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

/* ------------------------------------------------------------------ */
/*  native FeedGlyph (lucide icon -> colour-baked glyph)               */
/* ------------------------------------------------------------------ */

interface FeedGlyphProps {
  color: string;
  children: ReactNode;
}

function FeedGlyph({color, children}: FeedGlyphProps) {
  return (
    <AppText
      importantForAccessibility="no-hide-descendants"
      style={[styles.feedGlyph, {color}]}>
      {children}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  fresh: '\u25CF', // ● Wifi
  fetching: '\u21BB', // ↻ RefreshCw
  stale: '\u25CF', // ● Wifi
  error: '\u2715', // ✕ WifiOff
};

function relativeFreshness(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return `${Math.floor(seconds / 604_800)}w ago`;
}

interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: DataFreshnessProps) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';
  const color = FRESHNESS_COLOR[status];
  const relativeTime =
    updatedAt && !isFetching
      ? relativeFreshness(updatedAt, t)
      : isFetching
        ? t('freshness.updating', 'updating…')
        : isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!isFetching) {
          onRefresh?.();
        }
      }}
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      {!compact && relativeTime ? (
        <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse on data change (web L59-80).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return <View style={styles.skeleton} testID="widget-skeleton" />;
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <AppText style={styles.errorText} tone="danger">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (web L91).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated ? styles.shellPulse : null]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={[styles.body, !title ? styles.bodyTopPad : null]}>
        {children}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
}

function EmptyState({icon, message}: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyStateMessage}>{message}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetEventFeed (web ./shared WidgetEventFeed)              */
/* ------------------------------------------------------------------ */

interface WidgetEventFeedProps {
  items: EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

function WidgetEventFeed({
  items,
  maxItems,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetEventFeedProps) {
  const t = useNativeTranslation();

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
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage ?? t('widget.noEvents', 'No events yet')}
      />
    );
  }

  return (
    <View style={styles.feed}>
      {sorted.map((item, i) => {
        const isLast = i === sorted.length - 1;
        return (
          <View key={item.id} style={styles.feedRow}>
            <View style={styles.feedIconCol}>
              <View
                style={[
                  styles.feedIconBox,
                  {backgroundColor: `${item.color}15`},
                ]}>
                {item.icon}
              </View>
              {!isLast ? <View style={styles.feedConnector} /> : null}
            </View>
            <View style={styles.feedTextCol}>
              <AppText numberOfLines={1} style={styles.feedTitle}>
                {item.title}
              </AppText>
              {item.subtitle ? (
                <AppText numberOfLines={1} style={styles.feedSubtitle}>
                  {item.subtitle}
                </AppText>
              ) : null}
              <AppText style={styles.feedTime}>
                {formatRelativeTime(item.timestamp)}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  deriveEvent (web L13-67)                                           */
/* ------------------------------------------------------------------ */

/** Derive a human-readable event descriptor with severity from a security snapshot. */
function deriveEvent(ev: SecurityEvent): {
  icon: ReactNode;
  title: string;
  color: string;
  severity: EventFeedItem['severity'];
} {
  const doorRaw = asNonEmptyString(ev.door_state) ?? '';
  const openDoors = doorRaw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.toLowerCase().includes('open'));

  if (openDoors.length > 0) {
    return {
      icon: <FeedGlyph color={COLOR_DOOR_OPEN}>{ICON_DOOR_OPEN}</FeedGlyph>,
      title: `Door open: ${openDoors.join(', ')}`,
      color: COLOR_DOOR_OPEN,
      severity: 'warning',
    };
  }
  if (ev.sentry_mode) {
    return {
      icon: <FeedGlyph color={COLOR_SENTRY_ON}>{ICON_EYE}</FeedGlyph>,
      title: 'Sentry Mode activated',
      color: COLOR_SENTRY_ON,
      severity: 'info',
    };
  }
  if (ev.sentry_mode === false) {
    return {
      icon: <FeedGlyph color={COLOR_SENTRY_OFF}>{ICON_EYE_OFF}</FeedGlyph>,
      title: 'Sentry Mode deactivated',
      color: COLOR_SENTRY_OFF,
      severity: 'info',
    };
  }
  if (ev.locked) {
    return {
      icon: <FeedGlyph color={COLOR_LOCKED}>{ICON_LOCK}</FeedGlyph>,
      title: 'Vehicle locked',
      color: COLOR_LOCKED,
      severity: 'info',
    };
  }
  if (ev.locked === false) {
    return {
      icon: <FeedGlyph color={COLOR_UNLOCKED}>{ICON_UNLOCK}</FeedGlyph>,
      title: 'Vehicle unlocked',
      color: COLOR_UNLOCKED,
      severity: 'critical',
    };
  }
  return {
    icon: <FeedGlyph color={COLOR_GENERIC}>{ICON_DOOR_CLOSED}</FeedGlyph>,
    title: 'Security state updated',
    color: COLOR_GENERIC,
    severity: 'info',
  };
}

/* ------------------------------------------------------------------ */
/*  SentryEventLogWidget (web L69-123)                                 */
/* ------------------------------------------------------------------ */

export default function SentryEventLogWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;
  const eventLimit = isWide ? 10 : isTall ? 7 : 4;

  const {
    data: events,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['security-events', id, `sentry-log-${eventLimit}`],
    queryFn: () =>
      request<SecurityEvent[]>(`/security?vehicle_id=${id}&limit=${eventLimit}`),
    enabled: id > 0,
    refetchInterval: 30_000,
  });

  const feedItems = useMemo<EventFeedItem[]>(() => {
    return (events ?? []).map(ev => {
      const derived = deriveEvent(ev);
      const parts: string[] = [];
      if (ev.locked != null) {
        parts.push(ev.locked ? EMOJI_LOCKED : EMOJI_UNLOCKED);
      }
      if (ev.sentry_mode != null) {
        parts.push(ev.sentry_mode ? EMOJI_SENTRY_ON : SENTRY_OFF);
      }
      const subtitle = parts.join(SUBTITLE_SEP) || DASH;
      return {
        id: ev.id ?? `${ev.vehicle_id}-${ev.ts}`,
        icon: derived.icon,
        title: derived.title,
        subtitle: isWide ? subtitle : undefined,
        timestamp: ev.created_at ?? ev.ts,
        color: derived.color,
        severity: derived.severity,
      };
    });
  }, [events, isWide]);

  return (
    <WidgetShell
      icon={<AppText style={styles.titleGlyph}>{ICON_SHIELD}</AppText>}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.sentryEventLog', 'Sentry Event Log')}
      updatedAt={dataUpdatedAt}>
      <WidgetEventFeed
        emptyIcon={<AppText style={styles.emptyGlyph}>{ICON_SHIELD}</AppText>}
        emptyMessage={t('widget.noSentryEvents', 'No security events recorded')}
        items={feedItems}
        maxItems={eventLimit}
      />
    </WidgetShell>
  );
}

SentryEventLogWidget.displayName = 'SentryEventLogWidget';

const styles = StyleSheet.create({
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyStateMessage: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
  },
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.md + 4,
  },
  feed: {
    rowGap: 0,
  },
  feedConnector: {
    backgroundColor: colors.border,
    flex: 1,
    marginTop: spacing.xs,
    width: 1,
  },
  feedGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  feedIconBox: {
    alignItems: 'center',
    borderRadius: 8,
    flexShrink: 0,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  feedIconCol: {
    alignItems: 'center',
  },
  feedRow: {
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  feedSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  feedTextCol: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 16,
  },
  feedTime: {
    color: TIME_COLOR,
    fontSize: 10,
    lineHeight: 14,
    marginTop: spacing.xs,
  },
  feedTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  freshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  freshnessGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.xs + 2,
    top: spacing.xs + 2,
    zIndex: 5,
  },
  freshnessText: {
    fontSize: 10,
    lineHeight: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    columnGap: spacing.xs + 2,
    flexDirection: 'row',
  },
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
  titleGlyph: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 16,
  },
});
