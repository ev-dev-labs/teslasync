// Native parity port of
// web/src/features/dashboard/widgets/MediaHistoryWidget.tsx.
//
// A dashboard widget that lists the most recently played media tracks. In the
// wide (>1 col) layout it shows a scrollable event feed of the latest tracks
// (track + artist title, source-name subtitle, relative timestamp, and a
// playing/idle status colour); in the compact (1 col) layout it collapses to a
// single inline "Title \u2014 Artist" row (or "No tracks played" when the last
// entry has no title), and an EmptyState when there is no history at all. The
// shell renders the title, a list-music icon, and a query-freshness chip wired
// to refetch.
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (AutomationHistoryWidget /
// GlancePage / RateLimitStatusPanel) — every such dependency is reproduced
// inline with React Native primitives + the shared native building blocks and
// documented in the sidecar:
//
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell` here: loading -> a skeleton block;
//     otherwise a header (icon + uppercase muted title + freshness chip) over
//     the children. Its DOM <Skeleton>/<QueryError> and HelpTooltip/PinButton
//     extras are out of scope for this widget (it never passes help/widgetId/
//     error), so only the props this widget uses (title, icon, loading,
//     updatedAt, isFetching, isStale, isError, onRefresh) are honoured.
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/
//     error) chip WidgetShell renders — is reproduced inline as
//     `WidgetFreshness`: same isError>fetching>stale>fresh precedence, the same
//     dot colour tiers, "just now / Nm/Nh/Nd/Nw ago" ladder, "updating\u2026"/
//     "error" labels, the 30s re-render tick, and onRefresh wired to a
//     Pressable (role=button) exactly like the web chip.
//   - WidgetEventFeed + EventFeedItem (web .../shared) -> inline
//     `WidgetEventFeed` + local `EventFeedItem` type: same maxItems default,
//     the same timestamp-descending sort + slice, the same EmptyState fallback,
//     and TimelineItem (web data-display) reproduced as `TimelineRow`
//     (status-coloured icon chip + connector + title/subtitle/relative-time).
//   - WidgetProps (web .../types.ts) -> local `WidgetProps`/`WidgetSize` (only
//     `size.cols` is read here).
//   - feedback.EmptyState -> shared native EmptyState (web single `message`
//     -> native EmptyState `title`, empty `message`); its `emptyIcon`/`icon`
//     ReactNode has no native EmptyState slot, so it is dropped.
//   - lucide-react ListMusic/Music have no native icon font; the header icon
//     becomes an accent "\u266B" glyph, and the per-row / compact music icons
//     become a "\u266A" glyph (per-row tinted with the exact playing/idle hex).
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.*/freshness.* key + {{var}} interpolation intact.
//
// The data hooks are called unchanged: useVehicles() + useMediaHistory(vidStr)
// via the native web-parity hooks, so the API paths (/vehicles, /media?
// vehicle_id=), snake_case-derived vehicle id selection, and select(safeArray)
// are preserved. State names (vehicles, vid, vidStr, history, isLoading,
// isFetching, isStale, isError, dataUpdatedAt, refetch, isCompact, list,
// feedItems, lastTrack) are preserved. No DOM, react-router, framer-motion,
// lucide-react, Recharts, Leaflet, or old web UI components are imported.

import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useMediaHistory} from '../../../api/hooks/useVehicleSystems';
import {useVehicles} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.*/freshness.* key verbatim and applying the same
// {{var}} interpolation as the web `t`.
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

// Universal em-dash placeholder used by the web widget ('\u2014').
const FALLBACK = '\u2014';

// lucide Music -> "\u266A" (eighth note); lucide ListMusic -> "\u266B".
const MUSIC_GLYPH = '\u266A';
const LIST_MUSIC_GLYPH = '\u266B';
// Web prefixes every feed title with the 🎵 emoji ('\uD83C\uDFB5').
const TRACK_EMOJI = '\uD83C\uDFB5';

/* ─── Source -> label mapping (web sourceLabel) ───────────────────────────── */

// web sourceLabel — "USB" stays uppercase, otherwise capitalise the first
// character (e.g. "spotify" -> "Spotify").
function sourceLabel(source: string): string {
  const lower = source.toLowerCase();
  if (lower === 'usb') {
    return 'USB';
  }
  return source.charAt(0).toUpperCase() + source.slice(1);
}

/* ─── Inlined date formatters (web @/lib/dateFormat via useDateFormat) ─────── */

// web formatDateTime — "Apr 4, 2026, 2:30 AM" (the absolute fallback the feed's
// relative-time helper rolls over to past 24h).
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// web WidgetEventFeed.formatRelativeTime — "Just now", "5m ago", "2h ago", else
// the absolute date-time.
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  const diffMs = Date.now() - d.getTime();
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
  return formatDateTime(iso);
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── EventFeedItem (web .../shared WidgetEventFeed) ──────────────────────── */

interface EventFeedItem {
  id: string | number;
  glyph: string;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
}

/* ─── WidgetFreshness (web data-display DataFreshness 4-state chip) ────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

// web FRESHNESS_COLORS dot tiers (emerald-400 / sky-400 / amber-400 / red-400).
const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

// web DataFreshness.formatRelativeTime — minute/hour/day/week relative ladder.
function formatFreshnessRelative(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

function useThirtySecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

function WidgetFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  useThirtySecondTick(!!updatedAt && updatedAt > 0);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const relativeTime =
    updatedAt && updatedAt > 0 && !isFetching
      ? formatFreshnessRelative(updatedAt)
      : isFetching
        ? t('freshness.updating', 'updating\u2026')
        : isError
          ? t('freshness.error', 'error')
          : '';

  const refreshable = !!onRefresh && !isFetching;

  return (
    <Pressable
      accessibilityRole={onRefresh ? 'button' : 'text'}
      accessibilityLabel={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {state: status})
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="media-history-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="media-history-freshness-dot"
      />
      {relativeTime ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.freshnessLabel}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── ListMusicGlyph (web header lucide ListMusic, text-neon-cyan) ─────────── */

function ListMusicGlyph() {
  return (
    <View style={styles.headerGlyph} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" tone="accent">
        {LIST_MUSIC_GLYPH}
      </AppText>
    </View>
  );
}

/* ─── WidgetShell (web .../WidgetShell.tsx subset) ────────────────────────── */

function WidgetShell({
  title,
  icon,
  loading,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
  testID,
}: {
  title: string;
  icon: React.ReactNode;
  loading?: boolean;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
  testID?: string;
}) {
  if (loading) {
    return <View style={styles.skeleton} testID="media-history-loading" />;
  }

  return (
    <View style={styles.shell} testID={testID}>
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleRow}>
          {icon}
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shellTitle}>
            {title}
          </AppText>
        </View>
        <WidgetFreshness
          updatedAt={updatedAt}
          isFetching={isFetching}
          isStale={isStale}
          isError={isError}
          onRefresh={onRefresh}
        />
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── TimelineRow (web data-display TimelineItem) ─────────────────────────── */

function TimelineRow({item, isLast}: {item: EventFeedItem; isLast: boolean}) {
  return (
    <View style={styles.timelineRow} testID={`media-track-${item.id}`}>
      <View style={styles.timelineRail}>
        <View style={[styles.timelineIcon, {backgroundColor: `${item.color}15`}]}>
          <AppText variant="caption" weight="bold" style={{color: item.color}}>
            {item.glyph}
          </AppText>
        </View>
        {!isLast ? <View style={styles.timelineConnector} /> : null}
      </View>
      <View style={styles.timelineBody}>
        <AppText weight="semibold" numberOfLines={1} style={styles.timelineTitle}>
          {item.title}
        </AppText>
        {item.subtitle ? (
          <AppText
            variant="caption"
            tone="muted"
            numberOfLines={1}
            style={styles.timelineSubtitle}>
            {item.subtitle}
          </AppText>
        ) : null}
        <AppText variant="caption" tone="muted" style={styles.timelineTime}>
          {formatRelativeTime(item.timestamp)}
        </AppText>
      </View>
    </View>
  );
}

/* ─── WidgetEventFeed (web .../shared WidgetEventFeed) ────────────────────── */

function WidgetEventFeed({
  items,
  maxItems,
  emptyMessage,
}: {
  items: EventFeedItem[];
  maxItems?: number;
  emptyMessage?: string;
}) {
  const limit = maxItems ?? 10;

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
      <View testID="media-history-feed-empty">
        <EmptyState
          title={emptyMessage ?? t('widget.noEvents', 'No events yet')}
          message=""
        />
      </View>
    );
  }

  return (
    <View style={styles.feed} testID="media-history-feed">
      {sorted.map((item, i) => (
        <TimelineRow key={item.id} item={item} isLast={i === sorted.length - 1} />
      ))}
    </View>
  );
}

/* ─── CompactView (web .../MediaHistoryWidget CompactView, 1×2 layout) ─────── */

function CompactView({title, artist}: {title: string; artist: string}) {
  return (
    <View style={styles.compact} testID="media-history-compact">
      <View style={styles.compactIcon} accessibilityElementsHidden>
        <AppText tone="accent">{MUSIC_GLYPH}</AppText>
      </View>
      <AppText numberOfLines={1} style={styles.compactText}>
        {title !== FALLBACK
          ? `${title} \u2014 ${artist}`
          : t('widget.noMediaPlayed', 'No tracks played')}
      </AppText>
    </View>
  );
}

/* ─── MediaHistoryWidget ──────────────────────────────────────────────────── */

export default function MediaHistoryWidget({vehicleId, size}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const {
    data: history,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useMediaHistory(vidStr ?? '');

  const isCompact = size.cols <= 1;
  const list = useMemo(() => history ?? [], [history]);

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      list.map(item => {
        const trackTitle = item.title ?? FALLBACK;
        const artist = item.artist ?? FALLBACK;
        const source = item.source ?? '';
        const isPlaying = (item.playbackStatus ?? '').toLowerCase() === 'playing';

        return {
          id: item.id,
          glyph: MUSIC_GLYPH,
          title: `${TRACK_EMOJI} ${trackTitle} \u2014 ${artist}`,
          subtitle: source ? sourceLabel(source) : undefined,
          timestamp: item.timestamp ?? new Date(0).toISOString(),
          color: isPlaying ? '#22c55e' : '#6b7280',
          severity: 'info' as const,
        };
      }),
    [list],
  );

  const lastTrack = list.length > 0 ? list[0] : null;

  return (
    <WidgetShell
      title={t('widget.mediaHistory', 'Media History')}
      icon={<ListMusicGlyph />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      testID="media-history-widget">
      {isCompact ? (
        lastTrack ? (
          <CompactView
            title={lastTrack.title ?? FALLBACK}
            artist={lastTrack.artist ?? FALLBACK}
          />
        ) : (
          <View testID="media-history-empty">
            <EmptyState
              title={t('widget.noMediaPlayed', 'No tracks played')}
              message=""
            />
          </View>
        )
      ) : (
        <ScrollView
          style={styles.feedScroll}
          contentContainerStyle={styles.feedScrollContent}
          showsVerticalScrollIndicator={false}>
          <WidgetEventFeed
            items={feedItems}
            maxItems={10}
            emptyMessage={t('widget.noMediaPlayed', 'No tracks played')}
          />
        </ScrollView>
      )}
    </WidgetShell>
  );
}

MediaHistoryWidget.displayName = 'MediaHistoryWidget';

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  skeleton: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  headerGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    flexShrink: 0,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    minHeight: 44,
  },
  compactIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  feedScroll: {
    flex: 1,
    minHeight: 0,
  },
  feedScrollContent: {
    flexGrow: 1,
  },
  feed: {
    flex: 1,
  },
  timelineRow: {
    flexDirection: 'row',
    columnGap: spacing.md,
  },
  timelineRail: {
    alignItems: 'center',
  },
  timelineIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineConnector: {
    width: StyleSheet.hairlineWidth,
    flex: 1,
    marginTop: 4,
    backgroundColor: colors.surfaceRaised,
  },
  timelineBody: {
    flex: 1,
    minWidth: 0,
    paddingBottom: spacing.md,
  },
  timelineTitle: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  timelineSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  timelineTime: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
});
