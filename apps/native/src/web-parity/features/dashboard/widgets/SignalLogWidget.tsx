// Native parity port of web/src/features/dashboard/widgets/SignalLogWidget.tsx.
//
// The web widget is a dashboard "Signal Log" tile. It resolves the target
// vehicle (vehicleId prop -> first useVehicles() row -> 0), polls that vehicle's
// 20 most-recent signal observations (useSignalObservations(vid, { limit: 20 }))
// and the fleet MQTT status (useMQTTStatus()), then renders one of two layouts
// inside a <WidgetShell>:
//   - compact (size.cols <= 1): a <WidgetBigNumber> showing the aggregate
//     signals/sec summed across every streaming vehicle in the MQTT status;
//   - full: a <WidgetEventFeed> of the observations, each row mapping a
//     SignalObservation -> EventFeedItem with a coloured source <Badge> icon
//     (MQTT / API / Manual / Cache), the signal name as title, the formatted
//     value as subtitle, and a per-source hex dot colour.
// A header pause/resume <Button> (full layout only) freezes the displayed feed
// by snapshotting it into a ref while paused.
//
// This native port preserves that contract 1:1 — identical vid/isCompact
// derivations, the same useVehicles() + useSignalObservations(vid,{limit:20}) +
// useMQTTStatus() calls, the same SOURCE_COLORS / SOURCE_LABELS maps, the same
// formatSignalValue() branch order, the same feedItems mapping (id
// `${ts}-${signal_name}-${i}`, source ?? 'backfill', Badge variant success when
// fleet_telemetry else neutral, timestamp ts ?? epoch ISO, colour
// SOURCE_COLORS[source] ?? '#6b7280', severity 'info'), the same paused-freeze
// pausedDataRef logic + handleTogglePause, the same rate reducer
// (sum of signalsPerSecond ?? signals_per_second ?? 0), the same i18n keys +
// English defaults, and the same visual intent — using React Native primitives,
// the existing native AppText + design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?) =
//     fallback ?? key, preserving every key + English default.
//   - lucide-react ScrollText / Pause / Play (web L3): DOM SVG icons -> emoji /
//     glyph stand-ins (ScrollText -> 📜 tinted accent, Pause -> ⏸️, Play -> ▶️).
//   - @/components/ui Badge / Button (web L4): reproduced as native <FeedBadge>
//     (rounded-full success/neutral pill, sm padding) and a native pause/resume
//     <Pressable> with a 44x44 tap target (web min-h/min-w-[44px]).
//   - @/api/hooks/useTelemetry useSignalObservations / useMQTTStatus + the
//     SignalObservation type (web L5/L11): the already-ported web-parity hooks.
//   - @/api/hooks/useVehicles useVehicles (web L6): the already-ported hook.
//   - ./WidgetShell (web L7): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the 1500ms pulse-on-update effect, the
//     inline DataFreshness chip, AND the `actions` slot the Sentry port omitted.
//   - ./shared WidgetEventFeed / WidgetBigNumber + EventFeedItem (web L8-9):
//     reproduced as native-safe inline components mirroring the web feed
//     (sorted newest-first, sliced to maxItems, colour-tinted icon dot +
//     connector + title / subtitle / relative timestamp, EmptyState fallback)
//     and the centred big-number hero (the consumed value + label subset).
//   - ./types WidgetProps (web L10): the dashboard widget types module is not
//     yet ported, so WidgetSize { cols, rows } + WidgetProps are mirrored.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {
  useMQTTStatus,
  useSignalObservations,
  type SignalObservation,
} from '../../../api/hooks/useTelemetry';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (web L3)                              */
/* ------------------------------------------------------------------ */

const ICON_SCROLL_TEXT = '\uD83D\uDCDC'; // 📜 (ScrollText)
const ICON_PAUSE = '\u23F8\uFE0F'; // ⏸️ (Pause)
const ICON_PLAY = '\u25B6\uFE0F'; // ▶️ (Play)

/* feedItems subtitle / value fallback (web L33) */
const DASH = '\u2014'; // "—"

/* timeline connector + relative-time colours (web TimelineItem) */
const TIME_COLOR = '#4b5563'; // gray-600
const PULSE_GLOW = '#22c55e'; // shadow rgba(34,197,94,0.15)

/* native <Badge> variant palette (web @/components/ui Badge dark theme) */
const BADGE_SUCCESS_BG = '#14532d'; // dark:bg-green-900
const BADGE_SUCCESS_TEXT = '#bbf7d0'; // dark:text-green-200
const BADGE_NEUTRAL_BG = '#374151'; // dark:bg-gray-700
const BADGE_NEUTRAL_TEXT = '#e5e7eb'; // dark:text-gray-200

/* ------------------------------------------------------------------ */
/*  ported: Source -> visual mapping (web L15-27)                       */
/* ------------------------------------------------------------------ */

const SOURCE_COLORS: Record<string, string> = {
  fleet_telemetry: '#22c55e',
  fleet_api: '#06b6d4',
  manual: '#f59e0b',
  backfill: '#6b7280',
};

const SOURCE_LABELS: Record<string, string> = {
  fleet_telemetry: 'MQTT',
  fleet_api: 'API',
  manual: 'Manual',
  backfill: 'Cache',
};

/* ------------------------------------------------------------------ */
/*  ported: formatSignalValue (web L29-34)                             */
/* ------------------------------------------------------------------ */

function formatSignalValue(obs: SignalObservation): string {
  if (obs.value_numeric != null) {
    return String(obs.value_numeric);
  }
  if (obs.value_text != null) {
    return obs.value_text;
  }
  if (obs.value_bool != null) {
    return obs.value_bool ? 'true' : 'false';
  }
  return DASH;
}

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
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
/*  ported: ./shared EventFeedItem (web shared L7-18)                  */
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
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
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
/*  native FeedBadge (web @/components/ui Badge, feed icon)            */
/* ------------------------------------------------------------------ */

interface FeedBadgeProps {
  variant: 'success' | 'neutral';
  label: string;
}

function FeedBadge({variant, label}: FeedBadgeProps) {
  const isSuccess = variant === 'success';
  return (
    <View
      style={[
        styles.badge,
        isSuccess ? styles.badgeSuccess : styles.badgeNeutral,
      ]}>
      <AppText
        numberOfLines={1}
        style={[
          styles.badgeText,
          isSuccess ? styles.badgeTextSuccess : styles.badgeTextNeutral,
        ]}>
        {label}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  error: colors.danger,
  fetching: colors.accent,
  fresh: colors.success,
  stale: colors.warning,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  error: '\u2715', // ✕ WifiOff
  fetching: '\u21BB', // ↻ RefreshCw
  fresh: '\u25CF', // ● Wifi
  stale: '\u25CF', // ● Wifi
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
/*  native WidgetShell (web ./WidgetShell, incl. `actions` slot)       */
/* ------------------------------------------------------------------ */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  actions?: ReactNode;
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
  actions,
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
          <View style={styles.headerRight}>
            {freshnessEl}
            {actions}
          </View>
        </View>
      ) : (
        <>
          {freshnessEl ? (
            <View style={styles.freshnessOverlay}>{freshnessEl}</View>
          ) : null}
          {actions ? <View style={styles.actionsRow}>{actions}</View> : null}
        </>
      )}
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
/*  native WidgetBigNumber (web ./shared WidgetBigNumber)             */
/* ------------------------------------------------------------------ */

interface WidgetBigNumberProps {
  value: number | null;
  label?: string;
  nullDisplay?: string;
}

function WidgetBigNumber({
  value,
  label,
  nullDisplay = DASH,
}: WidgetBigNumberProps) {
  return (
    <View style={styles.bigNumber}>
      <AppText
        style={value !== null ? styles.bigNumberValue : styles.bigNumberNull}>
        {value !== null ? String(value) : nullDisplay}
      </AppText>
      {label ? (
        <AppText style={styles.bigNumberLabel}>{label}</AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  CompactView (web L38-51)                                          */
/* ------------------------------------------------------------------ */

function CompactView({rate, t}: {rate: number; t: NativeTFunction}) {
  return (
    <WidgetBigNumber
      label={t('widget.signalLog.signalsPerSec', 'signals/sec')}
      value={Math.round(rate)}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  SignalLogWidget (web L55-174)                                     */
/* ------------------------------------------------------------------ */

export default function SignalLogWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const [paused, setPaused] = useState(false);
  const pausedDataRef = useRef<EventFeedItem[]>([]);

  const {
    data: observations,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSignalObservations(vid, {limit: 20});

  const {data: mqttData} = useMQTTStatus();

  const isCompact = size.cols <= 1;

  // Map observations -> EventFeedItem[]
  const feedItems = useMemo<EventFeedItem[]>(() => {
    const list = observations ?? [];
    return list.map((obs, i) => {
      const source = obs.source ?? 'backfill';
      const sourceLabel = SOURCE_LABELS[source] ?? source;
      return {
        id: `${obs.ts}-${obs.signal_name}-${i}`,
        icon: (
          <FeedBadge
            label={sourceLabel}
            variant={source === 'fleet_telemetry' ? 'success' : 'neutral'}
          />
        ),
        title: obs.signal_name ?? DASH,
        subtitle: formatSignalValue(obs),
        timestamp: obs.ts ?? new Date(0).toISOString(),
        color: SOURCE_COLORS[source] ?? '#6b7280',
        severity: 'info' as const,
      };
    });
  }, [observations]);

  // Freeze display when paused
  const displayItems = useMemo(() => {
    if (!paused) {
      pausedDataRef.current = feedItems;
      return feedItems;
    }
    return pausedDataRef.current;
  }, [paused, feedItems]);

  const handleTogglePause = useCallback(() => {
    if (!paused) {
      pausedDataRef.current = feedItems;
    }
    setPaused(prev => !prev);
  }, [paused, feedItems]);

  // Aggregate signals/sec from MQTT status for compact view
  const rate = useMemo(() => {
    const vList = mqttData?.vehicles ?? [];
    return vList.reduce(
      (sum, v) => sum + (v.signalsPerSecond ?? v.signals_per_second ?? 0),
      0,
    );
  }, [mqttData]);

  const pauseAction = (
    <Pressable
      accessibilityLabel={
        paused
          ? t('widget.signalLog.resume', 'Resume')
          : t('widget.signalLog.pause', 'Pause')
      }
      accessibilityRole="button"
      hitSlop={8}
      onPress={handleTogglePause}
      style={styles.pauseButton}>
      <AppText style={styles.pauseGlyph}>
        {paused ? ICON_PLAY : ICON_PAUSE}
      </AppText>
    </Pressable>
  );

  return (
    <WidgetShell
      actions={!isCompact ? pauseAction : undefined}
      icon={<AppText style={styles.titleGlyph}>{ICON_SCROLL_TEXT}</AppText>}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.signalLog.title', 'Signal Log')}
      updatedAt={dataUpdatedAt}>
      {isCompact ? (
        <CompactView rate={rate} t={t} />
      ) : (
        <View style={styles.feedScroll}>
          <WidgetEventFeed
            compact={false}
            emptyIcon={
              <AppText style={styles.emptyGlyph}>{ICON_SCROLL_TEXT}</AppText>
            }
            emptyMessage={t(
              'widget.signalLog.noSignals',
              'No signal updates yet',
            )}
            items={displayItems}
            maxItems={20}
          />
        </View>
      )}
    </WidgetShell>
  );
}

SignalLogWidget.displayName = 'SignalLogWidget';

const styles = StyleSheet.create({
  actionsRow: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeNeutral: {
    backgroundColor: BADGE_NEUTRAL_BG,
  },
  badgeSuccess: {
    backgroundColor: BADGE_SUCCESS_BG,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 15,
  },
  badgeTextNeutral: {
    color: BADGE_NEUTRAL_TEXT,
  },
  badgeTextSuccess: {
    color: BADGE_SUCCESS_TEXT,
  },
  bigNumber: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    rowGap: spacing.xs,
  },
  bigNumberLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  bigNumberNull: {
    color: colors.textMuted,
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
  },
  bigNumberValue: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
  },
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
  feedIconBox: {
    alignItems: 'center',
    borderRadius: 8,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 32,
    paddingHorizontal: 4,
  },
  feedIconCol: {
    alignItems: 'center',
  },
  feedRow: {
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  feedScroll: {
    flex: 1,
    minHeight: 0,
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
  headerRight: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
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
  pauseButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  pauseGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
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
