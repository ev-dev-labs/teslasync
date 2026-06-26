// Native parity port of
// web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx.
//
// A dashboard widget that summarises the most recent automation runs. In the
// wide (>1 col) layout it shows a success-rate Badge + total-run count header
// over a scrollable event feed of the latest runs; in the compact (1 col)
// layout it collapses to a big success-rate percentage + label + the last-run
// timestamp (or an EmptyState when there is no history yet). The shell renders
// the title, a play icon, and a query-freshness chip wired to refetch.
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (GlancePage / RateLimitStatusPanel)
// — every such dependency is reproduced inline with React Native primitives +
// the shared native building blocks and documented in the sidecar:
//
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet (the native
//     widgets directory is empty), so its structure is inlined as `WidgetShell`
//     here: loading -> a skeleton block; otherwise a header (icon + uppercase
//     muted title + freshness chip) over the children. Its DOM `<Skeleton>` /
//     `<QueryError>` and HelpTooltip/PinButton extras are out of scope for this
//     widget (it never passes help/widgetId/error), so only the props this
//     widget actually uses (title, icon, loading, updatedAt, isFetching,
//     isStale, isError, onRefresh) are honoured.
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/
//     error) query-freshness chip WidgetShell renders — is reproduced inline as
//     `WidgetFreshness`: same isError>fetching>stale>fresh precedence, same
//     dot colour tiers, the same "just now / Nm/Nh/Nd/Nw ago" relative ladder,
//     "updating…"/"error" labels, the 30s re-render tick, and onRefresh wired
//     to a Pressable (role=button) exactly like the web chip.
//   - WidgetEventFeed + EventFeedItem (web .../shared) -> inline `WidgetEventFeed`
//     + local `EventFeedItem` type: same maxItems default, the same timestamp
//     descending sort + slice, the same EmptyState fallback, and TimelineItem
//     (web data-display) reproduced as `TimelineRow` (status-coloured icon chip
//     + connector + title/subtitle/relative-time).
//   - WidgetProps (web .../types.ts) -> local `WidgetProps`/`WidgetSize` (only
//     `size.cols` is read here).
//   - @/components/ui Badge -> local `StatusBadge` reproducing the success/
//     warning/danger variant tints. @/components/data-display TimeStamp ->
//     relative-time label (native has no time_format_default preference wired,
//     so the 'auto' format resolves to the relative ladder).
//   - lucide-react PlayCircle/CheckCircle/XCircle/Clock have no native icon
//     font; the header play icon becomes a small accent "\u25B6" glyph and the
//     per-run icons collapse to short status glyphs (CheckCircle->OK,
//     XCircle->X, Clock->CK, PlayCircle->PL) while the meaningful signal — the
//     exact per-status hex colour from STATUS_MAP — is preserved verbatim.
//   - @/lib/dateFormat formatDurationMs + @/lib/numberFormat fmtNumber/fmtInt
//     are inlined verbatim (default precision 2, the "\u2014" fallback,
//     "Nms"/"N.Ns" ladder) without Intl/locale or useSettings wiring.
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.*/freshness.* key + {{var}} interpolation intact.
//
// The data hook is called unchanged: useAutomationHistory() via the native
// web-parity hook, so the API path (/automations/history?limit=20),
// snake_case fields (items, summary.success_rate, summary.total_executions,
// status, duration_ms, automation_name, triggered_at), and refetch interval
// are preserved. State names (data, isLoading, isFetching, isStale, isError,
// dataUpdatedAt, refetch, isCompact, items, summary, successRate, feedItems,
// lastEntry) are preserved. No DOM, react-router, framer-motion, lucide-react,
// Recharts, Leaflet, or old web UI components are imported.

import React, {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useAutomationHistory,
  type AutomationHistoryStatus,
} from '../../../api/hooks/useAutomations';

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

/* ─── Inlined formatters (web @/lib/numberFormat + @/lib/dateFormat) ───────── */

// Universal placeholder returned by the duration/date formatters (web FALLBACK).
const FALLBACK = '\u2014';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// web fmtNumber — locale-grouped, fixed precision. The web global precision
// defaults to 2 (set by useSettings, which native does not wire), so 2 is the
// faithful unconfigured default.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web fmtInt — integer with locale separators.
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// web formatDurationMs — "250ms", "1.5s", or "\u2014" for nullish/non-finite.
function formatDurationMs(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) {
    return FALLBACK;
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

// web formatDateTime — "Apr 4, 2026, 2:30 AM" (the absolute fallback the feed's
// relative-time helper rolls over to past 24h).
function formatDateTime(iso: string | Date | null | undefined): string {
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
// the absolute date-time. Also stands in for the web TimeStamp 'auto' label.
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

/* ─── Status -> visual mapping (web STATUS_MAP) ───────────────────────────── */

interface StatusVisual {
  glyph: string;
  color: string;
  severity: EventFeedItem['severity'];
}

// lucide CheckCircle->OK, XCircle->X, Clock->CK, PlayCircle->PL (the four
// distinct web icons). Colours are the exact web hex values, preserved verbatim.
const STATUS_MAP: Record<string, StatusVisual> = {
  success: {glyph: 'OK', color: '#22c55e', severity: 'info'},
  failed: {glyph: 'X', color: '#ef4444', severity: 'critical'},
  partial: {glyph: 'CK', color: '#f59e0b', severity: 'warning'},
  running: {glyph: 'CK', color: '#3b82f6', severity: 'info'},
  skipped: {glyph: 'CK', color: '#6b7280', severity: 'info'},
  cancelled: {glyph: 'X', color: '#6b7280', severity: 'info'},
  test: {glyph: 'PL', color: '#8b5cf6', severity: 'info'},
  undo: {glyph: 'CK', color: '#6b7280', severity: 'info'},
};

const DEFAULT_STATUS: StatusVisual = {
  glyph: 'PL',
  color: '#6b7280',
  severity: 'info',
};

/* ─── StatusBadge (web @/components/ui Badge: success/warning/danger) ─────── */

type BadgeVariant = 'success' | 'warning' | 'danger';

const BADGE_TINTS: Record<BadgeVariant, {bg: string; color: string}> = {
  success: {bg: colors.successSurface, color: colors.success},
  warning: {bg: colors.warningSurface, color: colors.warning},
  danger: {bg: colors.dangerSurface, color: colors.danger},
};

function StatusBadge({
  variant,
  children,
  testID,
}: {
  variant: BadgeVariant;
  children: string;
  testID?: string;
}) {
  const tint = BADGE_TINTS[variant];
  return (
    <View style={[styles.badge, {backgroundColor: tint.bg}]} testID={testID}>
      <AppText
        variant="caption"
        weight="semibold"
        numberOfLines={1}
        style={{color: tint.color}}>
        {children}
      </AppText>
    </View>
  );
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
      testID="automation-history-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="automation-history-freshness-dot"
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
    return (
      <View style={styles.skeleton} testID="automation-history-loading" />
    );
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
    <View style={styles.timelineRow} testID={`automation-run-${item.id}`}>
      <View style={styles.timelineRail}>
        <View
          style={[styles.timelineIcon, {backgroundColor: `${item.color}15`}]}>
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
      <View testID="automation-history-feed-empty">
        <EmptyState
          title={emptyMessage ?? t('widget.noEvents', 'No events yet')}
          message=""
        />
      </View>
    );
  }

  return (
    <View style={styles.feed} testID="automation-history-feed">
      {sorted.map((item, i) => (
        <TimelineRow key={item.id} item={item} isLast={i === sorted.length - 1} />
      ))}
    </View>
  );
}

/* ─── CompactView (web .../AutomationHistoryWidget CompactView) ───────────── */

function CompactView({
  successRate,
  lastRunTime,
}: {
  successRate: number;
  lastRunTime: string | null;
}) {
  return (
    <View style={styles.compact} testID="automation-history-compact">
      <AppText weight="bold" style={styles.compactValue}>
        {fmtNumber(successRate, 1)}%
      </AppText>
      <AppText variant="caption" tone="muted" style={styles.compactLabel}>
        {t('widget.successRate', 'Success Rate')}
      </AppText>
      {lastRunTime ? (
        <AppText
          variant="caption"
          tone="secondary"
          style={styles.compactTimestamp}
          testID="automation-history-compact-time">
          {formatRelativeTime(lastRunTime)}
        </AppText>
      ) : null}
    </View>
  );
}

/* ─── PlayGlyph (web header lucide PlayCircle, text-neon-cyan) ─────────────── */

function PlayGlyph({style}: {style?: StyleProp<ViewStyle>}) {
  return (
    <View style={[styles.playGlyph, style]} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" tone="accent">
        {'\u25B6'}
      </AppText>
    </View>
  );
}

/* ─── AutomationHistoryWidget ─────────────────────────────────────────────── */

export default function AutomationHistoryWidget({size}: WidgetProps) {
  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useAutomationHistory();

  const isCompact = size.cols <= 1;
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const summary = data?.summary;
  const successRate = summary?.success_rate ?? 0;

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      items.map(entry => {
        const mapped: StatusVisual =
          STATUS_MAP[entry.status as AutomationHistoryStatus] ?? DEFAULT_STATUS;
        const durationStr = formatDurationMs(entry.duration_ms ?? null);
        const statusLabel = entry.status ?? FALLBACK;
        return {
          id: entry.id,
          glyph: mapped.glyph,
          title: entry.automation_name ?? FALLBACK,
          subtitle: `${statusLabel} \u00b7 ${durationStr}`,
          timestamp: entry.triggered_at ?? new Date(0).toISOString(),
          color: mapped.color,
          severity: mapped.severity,
        };
      }),
    [items],
  );

  const lastEntry = items.length > 0 ? items[0] : null;

  return (
    <WidgetShell
      title={t('widget.automationHistory', 'Automation History')}
      icon={<PlayGlyph />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      testID="automation-history-widget">
      {isCompact ? (
        items.length > 0 ? (
          <CompactView
            successRate={successRate}
            lastRunTime={lastEntry?.triggered_at ?? null}
          />
        ) : (
          <View testID="automation-history-empty">
            <EmptyState
              title={t('widget.noAutomationRuns', 'No automation runs yet')}
              message=""
            />
          </View>
        )
      ) : (
        <View style={styles.wide}>
          <View style={styles.successHeader}>
            <StatusBadge
              variant={
                successRate >= 90
                  ? 'success'
                  : successRate >= 50
                    ? 'warning'
                    : 'danger'
              }
              testID="automation-history-success-rate">
              {`${fmtNumber(successRate, 1)}% ${t(
                'widget.successRate',
                'Success Rate',
              )}`}
            </StatusBadge>
            {summary ? (
              <AppText
                variant="caption"
                tone="muted"
                style={styles.totalRuns}
                testID="automation-history-total-runs">
                {`${fmtInt(summary.total_executions)} ${t(
                  'widget.totalRuns',
                  'runs',
                )}`}
              </AppText>
            ) : null}
          </View>

          <ScrollView
            style={styles.feedScroll}
            contentContainerStyle={styles.feedScrollContent}
            showsVerticalScrollIndicator={false}>
            <WidgetEventFeed
              items={feedItems}
              maxItems={10}
              emptyMessage={t('widget.noAutomationRuns', 'No automation runs yet')}
            />
          </ScrollView>
        </View>
      )}
    </WidgetShell>
  );
}

AutomationHistoryWidget.displayName = 'AutomationHistoryWidget';

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
  playGlyph: {
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: 4,
    paddingVertical: spacing.md,
  },
  compactValue: {
    fontSize: 24,
    lineHeight: 30,
    color: colors.textPrimary,
  },
  compactLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  compactTimestamp: {
    fontSize: 12,
    lineHeight: 16,
  },
  wide: {
    flex: 1,
    minHeight: 0,
    rowGap: spacing.sm,
  },
  successHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  badge: {
    flexShrink: 1,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
  },
  totalRuns: {
    fontSize: 10,
    lineHeight: 14,
    flexShrink: 1,
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
