// Native parity port of web/src/features/dashboard/widgets/BackupHistoryWidget.tsx.
//
// The web widget is a Tesla Energy "Backup History" dashboard tile. It resolves
// the first linked energy site (useTeslaEnergySites → energy_site_id), pulls the
// last 30 days of grid-outage / backup events (useTeslaBackupHistory(siteId,
// thirtyDaysAgo)), and renders one of three states inside a <WidgetShell>:
//   1. No energy site linked  → an EmptyState ("No Tesla Energy site linked").
//   2. Compact (size.cols ≤ 1) → a single "Outages (30d)" StatCard above a list of
//      up to 3 most-recent events (⚡ + formatted time + a neutral duration Badge).
//   3. Standard (≥ 2 cols)     → an "Outages (30d)" + "Avg Duration" StatCard row
//      above a list of up to 10 most-recent events (⚡ + time + "Duration: …"
//      subline + a neutral duration Badge), all under a "Backup History" title.
// Combined freshness (loading / fetching / stale / error / dataUpdatedAt) and a
// manual refresh are threaded from BOTH queries into the shell header, and events
// are sorted newest-first and capped by `maxEvents`.
//
// This native port preserves that contract 1:1 — identical hook calls + API
// paths, the same siteId/hasSites/since/items/totalOutages/avgDurationSec/
// isCompact/maxEvents/sortedItems derivations with the same `?? 0`/`?? ''`
// null-safety, the same three branches, the same fmtDuration("2h 15m"/"45m"/
// "30s") + thirtyDaysAgo() helpers, the same i18n keys + English defaults, and
// the same visual intent — using React Native primitives, the existing native
// AppText + design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime → inline useNativeTranslation() returns t(key, fallback?) =
//     fallback ?? key, preserving every key + English default.
//   - lucide-react BatteryFull / Zap (web L3): DOM SVG icons → emoji/glyph
//     stand-ins (🔋 / ⚡), tinted with the same emerald-400 / amber-400 intent
//     via theme tokens.
//   - @/components/data-display StatCard (web L4): reproduced as a native-safe
//     <StatCard> (label + value Card) — only the label/value slots this widget
//     uses are ported.
//   - @/components/ui Badge (web L5): reproduced as a native-safe neutral <Badge>
//     (gray-700 chip, gray-200 text, rounded-full); the optional `dense` flag
//     maps the compact list's text-[10px] override.
//   - @/components/feedback EmptyState (web L6): reproduced as a native-safe
//     <EmptyState> (centered icon glyph + muted message, py-4 spacing).
//   - @/api/hooks/useEnergy useTeslaBackupHistory / useTeslaEnergySites (web L7):
//     the already-ported web-parity useEnergy hooks (same signatures + types).
//   - @/lib/numberFormat fmtInt (web L8): inline native fmtInt (locale integer).
//   - @/hooks/useDateFormat useDateFormat().formatDateTime (web L9): inline
//     native formatDateTime (toLocaleString month/day/hour/minute; nullish → "—").
//   - ./WidgetShell (web L10): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the pulse-on-update effect, and the inline
//     DataFreshness chip (its web Skeleton / QueryError / DataFreshness internals
//     reduced to native equivalents; dot-only `compact` when title-less).
//   - ./types WidgetProps (web L11): the dashboard widget types module is not yet
//     ported, so the consumed subset (WidgetSize { cols, rows } + WidgetProps) is
//     mirrored as local interfaces.
//   - the web inner lists use overflow-y-auto; because the row set is already
//     hard-capped by `maxEvents` (3 / 10) via .slice(), and native dashboard
//     tiles render inside the screen's own scroll container, the scroll is
//     reduced to a bounded static column (avoiding the nested-scroll anti-pattern).

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useTeslaBackupHistory,
  useTeslaEnergySites,
  type TeslaBackupEvent,
} from '../../../api/hooks/useEnergy';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (web L3)                             */
/* ------------------------------------------------------------------ */

const ICON_BATTERY_FULL = '\uD83D\uDD0B'; // 🔋 (BatteryFull)
const ICON_ZAP = '\u26A1'; // ⚡ (Zap)

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
/*  native-safe formatters (web @/lib/numberFormat, @/hooks/useDateFormat) */
/* ------------------------------------------------------------------ */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Port of web fmtInt — integer with locale separators. */
function fmtInt(v: unknown): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(safeNumber(v)));
  }
}

/** Port of web useDateFormat().formatDateTime — "Jun 24, 2:30 PM"; nullish → "—". */
function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '\u2014';
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

/* ------------------------------------------------------------------ */
/*  ported helpers (web L13-28)                                        */
/* ------------------------------------------------------------------ */

/** Format seconds into human-readable duration (e.g. "2h 15m", "45m", "30s"). */
function fmtDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hrs > 0) {
    return remainMins > 0 ? `${hrs}h ${remainMins}m` : `${hrs}h`;
  }
  return `${mins}m`;
}

/** 30 days ago in ISO date form. */
function thirtyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
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
/*  native StatCard (web @/components/data-display StatCard)            */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: string;
}

function StatCard({label, value}: StatCardProps) {
  return (
    <View style={styles.statCard}>
      <AppText numberOfLines={1} style={styles.statCardLabel}>
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.statCardValue}>
        {value}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native Badge (web @/components/ui Badge, neutral variant)           */
/* ------------------------------------------------------------------ */

interface BadgeProps {
  children: ReactNode;
  dense?: boolean;
}

function Badge({children, dense}: BadgeProps) {
  return (
    <View style={styles.badge}>
      <AppText style={[styles.badgeText, dense ? styles.badgeTextDense : null]}>
        {children}
      </AppText>
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
/*  BackupHistoryWidget (web L30-225)                                  */
/* ------------------------------------------------------------------ */

export default function BackupHistoryWidget({size}: WidgetProps) {
  const t = useNativeTranslation();

  // ── Energy sites (to get siteId) ──
  const {
    data: sites,
    isLoading: sitesLoading,
    isFetching: sitesFetching,
    isStale: sitesStale,
    isError: sitesIsError,
    dataUpdatedAt: sitesUpdatedAt,
    refetch: refetchSites,
  } = useTeslaEnergySites();

  const siteId = (sites ?? [])[0]?.energy_site_id;
  const hasSites = (sites ?? []).length > 0;

  // ── Backup history (30 days) ──
  const since = useMemo(() => thirtyDaysAgo(), []);

  const {
    data: events,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isStale: eventsStale,
    isError: eventsIsError,
    dataUpdatedAt: eventsUpdatedAt,
    refetch: refetchEvents,
  } = useTeslaBackupHistory(siteId, since);

  // ── Combined freshness props ──
  const isLoading = sitesLoading || (!!siteId && eventsLoading);
  const isFetching = sitesFetching || eventsFetching;
  const isStale = sitesStale || eventsStale;
  const isError = sitesIsError || eventsIsError;
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, eventsUpdatedAt ?? 0);

  const handleRefresh = () => {
    refetchSites();
    if (siteId) {
      refetchEvents();
    }
  };

  // ── Derived stats ──
  const items = useMemo<TeslaBackupEvent[]>(() => events ?? [], [events]);

  const totalOutages = items.length;

  const avgDurationSec = useMemo(() => {
    if (items.length === 0) {
      return 0;
    }
    const totalSec = items.reduce(
      (sum, ev) => sum + (ev.duration_seconds ?? 0),
      0,
    );
    return totalSec / items.length;
  }, [items]);

  const isCompact = size.cols <= 1;
  const maxEvents = isCompact ? 3 : 10;

  const sortedItems = useMemo(
    () =>
      [...items]
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, maxEvents),
    [items, maxEvents],
  );

  // ── No energy sites linked ──
  if (!hasSites && !isLoading) {
    return (
      <WidgetShell
        error={null}
        isError={sitesIsError}
        isFetching={sitesFetching}
        isStale={sitesStale}
        loading={false}
        onRefresh={() => refetchSites()}
        updatedAt={sitesUpdatedAt}>
        <EmptyState
          icon={<AppText style={styles.emptyGlyph}>{ICON_BATTERY_FULL}</AppText>}
          message={t('widget.backupHistory.noSite', 'No Tesla Energy site linked')}
        />
      </WidgetShell>
    );
  }

  // ── Compact layout (1-col) ──
  if (isCompact) {
    return (
      <WidgetShell
        error={null}
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={handleRefresh}
        updatedAt={updatedAt}>
        {items.length === 0 && !isLoading ? (
          <EmptyState
            icon={
              <AppText style={styles.emptyGlyph}>{ICON_BATTERY_FULL}</AppText>
            }
            message={t(
              'widget.backupHistory.noEvents',
              'No backup events in the last 30 days',
            )}
          />
        ) : (
          <View style={styles.compactColumn}>
            <StatCard
              label={t('widget.backupHistory.outages30d', 'Outages (30d)')}
              value={fmtInt(totalOutages)}
            />
            <View style={styles.listCompact}>
              {sortedItems.map(ev => (
                <View key={ev.id} style={styles.eventRowCompact}>
                  <View style={styles.eventRowLeft}>
                    <AppText style={styles.zapGlyph}>{ICON_ZAP}</AppText>
                    <AppText numberOfLines={1} style={styles.eventTimeCompact}>
                      {formatDateTime(ev.timestamp ?? '')}
                    </AppText>
                  </View>
                  <Badge dense>{fmtDuration(ev.duration_seconds ?? 0)}</Badge>
                </View>
              ))}
            </View>
          </View>
        )}
      </WidgetShell>
    );
  }

  // ── Standard layout (2×4+) ──
  return (
    <WidgetShell
      error={null}
      icon={<AppText style={styles.titleGlyphEmerald}>{ICON_BATTERY_FULL}</AppText>}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={handleRefresh}
      title={t('widget.backupHistory.title', 'Backup History')}
      updatedAt={updatedAt}>
      {items.length === 0 && !isLoading ? (
        <EmptyState
          icon={<AppText style={styles.emptyGlyph}>{ICON_BATTERY_FULL}</AppText>}
          message={t(
            'widget.backupHistory.noEvents',
            'No backup events in the last 30 days',
          )}
        />
      ) : (
        <View style={styles.standardColumn}>
          {/* Stat summary row */}
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <StatCard
                label={t('widget.backupHistory.outages30d', 'Outages (30d)')}
                value={fmtInt(totalOutages)}
              />
            </View>
            <View style={styles.statCell}>
              <StatCard
                label={t('widget.backupHistory.avgDuration', 'Avg Duration')}
                value={fmtDuration(avgDurationSec)}
              />
            </View>
          </View>

          {/* Event list */}
          <View style={styles.listStandard}>
            {sortedItems.map(ev => (
              <View key={ev.id} style={styles.eventRowStandard}>
                <View style={styles.eventRowLeft}>
                  <AppText style={styles.zapGlyph}>{ICON_ZAP}</AppText>
                  <View style={styles.eventTextCol}>
                    <AppText numberOfLines={1} style={styles.eventTimeStandard}>
                      {formatDateTime(ev.timestamp ?? '')}
                    </AppText>
                    <AppText style={styles.eventDuration}>
                      {t('widget.backupHistory.duration', 'Duration')}:{' '}
                      {fmtDuration(ev.duration_seconds ?? 0)}
                    </AppText>
                  </View>
                </View>
                <Badge>{fmtDuration(ev.duration_seconds ?? 0)}</Badge>
              </View>
            ))}
          </View>
        </View>
      )}
    </WidgetShell>
  );
}

BackupHistoryWidget.displayName = 'BackupHistoryWidget';

// bg-white/[0.03] event-row surface; gray-700 / gray-200 neutral Badge.
const ROW_SURFACE = 'rgba(255, 255, 255, 0.03)';
const BADGE_BG = '#374151';
const BADGE_TEXT = '#e5e7eb';
// shadow-[0_0_12px_rgba(34,197,94,0.15)] pulse-on-update glow.
const PULSE_GLOW = '#22c55e';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: BADGE_BG,
    borderRadius: 999,
    flexDirection: 'row',
    flexShrink: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: BADGE_TEXT,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  badgeTextDense: {
    fontSize: 10,
  },
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  compactColumn: {
    rowGap: spacing.sm,
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
  eventDuration: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  eventRowCompact: {
    alignItems: 'center',
    backgroundColor: ROW_SURFACE,
    borderRadius: 8,
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  eventRowLeft: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  eventRowStandard: {
    alignItems: 'center',
    backgroundColor: ROW_SURFACE,
    borderRadius: 8,
    columnGap: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  eventTextCol: {
    flex: 1,
    minWidth: 0,
  },
  eventTimeCompact: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  eventTimeStandard: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
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
  listCompact: {
    rowGap: 6,
  },
  listStandard: {
    rowGap: 6,
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
  standardColumn: {
    rowGap: spacing.md,
  },
  statCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  statCardLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  statCardValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  statCell: {
    flex: 1,
  },
  statRow: {
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  titleGlyphEmerald: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 16,
  },
  zapGlyph: {
    color: colors.warning,
    flexShrink: 0,
    fontSize: 13,
    lineHeight: 16,
  },
});
