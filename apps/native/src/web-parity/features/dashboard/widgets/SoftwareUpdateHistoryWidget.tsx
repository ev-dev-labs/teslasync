// Native parity port of
// web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx.
//
// The web module is the dashboard "Update History" widget. It reads the
// software-update history (GET /api/v1/software-updates) for the selected (or
// first) vehicle and renders one of two layouts driven by the grid `size.cols`:
//   • Compact (cols <= 1): a single row with a cyan download glyph + the latest
//     version and a status Badge ("Current" when installed, otherwise the raw
//     status), or an EmptyState when there is no history.
//   • Standard/Wide (cols >= 2): a scrollable WidgetEventFeed timeline of the
//     updates (newest first, capped at 15) — each row a colour-tinted status
//     glyph, the version, a "Current"/status subtitle and a relative timestamp —
//     or an EmptyState when empty.
// A status→visual map (STATUS_MAP / DEFAULT_STATUS) assigns each Tesla update
// status (installed/installing/downloading/available/scheduled) an icon, colour
// and severity; the newest installed update is highlighted as the "Current"
// build in cyan. The title is always shown by the shell in both layouts.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • lucide-react Download/CheckCircle2/Clock/ArrowDownCircle -> the app
//     SemanticIcon glyphs (download/success/clock/arrowDownToDot) rendered as a
//     colour-tinted AppText (GlyphIcon). The web lucide icons carry no colour of
//     their own — they inherit the TimelineItem box's `color` — so each feed
//     glyph is tinted with the row's resolved colour (cyan for the current
//     build, else the status colour), and the header/compact download glyphs use
//     the accent (text-neon-cyan) and the empty-slot glyph the muted token.
//   • @/components/ui Badge -> a local native pill (info/success/warning) backed
//     by the theme surface/foreground tokens (web info blue -> native accent
//     cyan, the closest theme token), preserving the source variant logic
//     (installed -> success, installing -> warning, else info).
//   • @/components/feedback EmptyState -> the already-ported native parity
//     EmptyState (icon + message + native `style` in place of `className`).
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly
//     the props this call site uses (title/icon/loading/updatedAt/isFetching/
//     isStale/isError/onRefresh/children): a Skeleton while loading, a header row
//     (icon + uppercase title + freshness/refresh chip) and the body.
//   • ./shared WidgetEventFeed + EventFeedItem -> a local native WidgetEventFeed
//     (newest-first sort + limit, EmptyState when empty, a ScrollView of native
//     TimelineItem rows porting @/components/data-display TimelineItem: a tinted
//     rounded icon box + connector line, title/subtitle/relative-time body). The
//     TimelineItem `href` drill-through (react-router-dom <Link>) has no native
//     analog and is dropped — this widget never sets it.
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local
//     types (the shared registry types module is not yet in the parity tree).
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?) returns the fallback (or key),
//     preserving every translation key verbatim (incl. the
//     t('widget.updateStatus', latestStatus) status-as-fallback call).
//   • @/hooks/useDateFormat (formatDateTime, used by the feed for >24h rows) ->
//     inlined from @/lib/dateFormat's option object ({year,month:'short',day,
//     hour:'2-digit',minute:'2-digit'}, "—" for missing/invalid) with the locale
//     threaded from the native useSettings() query; RN ships no ported
//     useTimezone so the device zone is used (MotorHistoryWidget precedent).
//   • @/api/hooks/useVehicles useVehicles + @/api/hooks/useVehicleSystems
//     useSoftwareUpdates -> the already-ported native parity hooks (same names /
//     return shapes / SoftwareUpdate fields).
//   • DOM <div>/<span> + Tailwind classes -> React Native View/AppText with
//     StyleSheet tokens. The DataFreshness header indicator is computed once at
//     render (no 30s interval) to avoid a dangling timer under
//     --detectOpenHandles.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSoftwareUpdates} from '../../../api/hooks/useVehicleSystems';
import {useSettings} from '../../../api/hooks/useSettings';

const DEFAULT_LOCALE = 'en-US';

// Highlight colour for the newest installed ("Current") build. Preserved
// verbatim from the source (#22d3ee, cyan-400).
const CURRENT_COLOR = '#22d3ee';

/* ─── ./types (dashboard widget registry types, ported verbatim) ─────────── */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ─── ./shared EventFeedItem (ported verbatim) ───────────────────────────── */

export interface EventFeedItem {
  id: string | number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
  /**
   * Optional navigation target. In the web source this turns the row into a
   * drill-through <Link>; React Native has no router analog so it is unused
   * here (this widget never sets it). Kept for type parity.
   */
  href?: string;
}

/* ─── i18n fallback (web react-i18next useTranslation/TFunction) ─────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation('dashboard'): the parity
// bundle ships no i18n runtime, so `t` returns the English fallback (or the key)
// while preserving every key at the call site.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/hooks/useDateFormat formatDateTime ───────────────────────── */

type DateInput = string | Date | null | undefined;

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// web @/lib/dateFormat formatDateTime: "Apr 4, 2026, 12:00 PM" (locale-driven);
// "—" for missing/invalid. The web useDateFormat also binds an IANA timezone; RN
// ships no ported useTimezone, so the device zone is used while the locale is
// threaded from settings.
function libFormatDateTime(value: DateInput, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Native bridge mirroring the web useDateFormat().formatDateTime, with the
// locale threaded from useSettings().
function useDateFormat(): {formatDateTime: (value: DateInput) => string} {
  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);
  const formatDateTime = useCallback(
    (value: DateInput) => libFormatDateTime(value, locale),
    [locale],
  );
  return {formatDateTime};
}

/* ─── tinted glyph icon (web lucide-react icons) ─────────────────────────── */

function GlyphIcon({
  name,
  color,
  size,
}: {
  name: SemanticIconName;
  color: string;
  size: number;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 2}]}>
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

/* ─── @/components/ui Badge (pill subset used by this widget) ─────────────── */

type BadgeVariant = 'info' | 'success' | 'warning';

// web Badge variants info/success/warning. The web `info` is blue; the native
// theme has no blue token, so it maps to the accent (cyan) surface/foreground.
const BADGE_PALETTE: Record<BadgeVariant, {bg: string; fg: string}> = {
  info: {bg: colors.accentSoft, fg: colors.accent},
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

/* ─── DataFreshness chip (web @/components/data-display) ──────────────────── */

// Computed once at render (no interval) to avoid a dangling timer under
// --detectOpenHandles.
function relativeTime(updatedAt: number): string {
  if (!updatedAt || updatedAt <= 0) {
    return 'never';
  }
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  let label: string;
  let dotColor: string;
  if (isError) {
    label = 'Error';
    dotColor = colors.danger;
  } else if (isFetching) {
    label = 'Updating…';
    dotColor = colors.accent;
  } else if (isStale) {
    label = 'Stale';
    dotColor = colors.warning;
  } else {
    label = relativeTime(updatedAt);
    dotColor = colors.success;
  }

  return (
    <Pressable
      accessibilityLabel={`Data ${label}. Refresh.`}
      accessibilityRole="button"
      disabled={!onRefresh}
      onPress={onRefresh}
      style={styles.freshness}
      testID="widget-freshness">
      <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
      {compact ? null : (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

/* ─── WidgetShell (web ./WidgetShell, subset used by this widget) ─────────── */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: WidgetShellProps) {
  if (loading) {
    return <Skeleton height={120} rounded style={styles.shellSkeleton} />;
  }

  if (error) {
    return (
      <View style={styles.shellError} testID="widget-error">
        <AppText style={styles.shellErrorText} tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1-col widgets).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
      updatedAt={updatedAt ?? 0}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellTitleRow}>
            {icon}
            <AppText
              numberOfLines={1}
              style={styles.shellTitle}
              tone="muted"
              variant="caption">
              {title.toUpperCase()}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : (
        freshnessEl && (
          <View pointerEvents="box-none" style={styles.shellFreshnessOverlay}>
            {freshnessEl}
          </View>
        )
      )}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── TimelineItem (web @/components/data-display) ────────────────────────── */

function TimelineItem({
  icon,
  title,
  subtitle,
  time,
  color,
  isLast,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  time: string;
  color: string;
  isLast?: boolean;
}) {
  return (
    <View style={styles.timelineRow} testID="timeline-item">
      <View style={styles.timelineIconCol}>
        {/* web rounded box: backgroundColor `${color}15` (~8% alpha), icon in `color`. */}
        <View style={[styles.timelineIconBox, {backgroundColor: `${color}15`}]}>
          {icon}
        </View>
        {!isLast ? <View style={styles.timelineConnector} /> : null}
      </View>
      <View style={styles.timelineBody}>
        <AppText numberOfLines={1} style={styles.timelineTitle}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.timelineSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        ) : null}
        <AppText style={styles.timelineTime} tone="muted" variant="caption">
          {time}
        </AppText>
      </View>
    </View>
  );
}

/* ─── WidgetEventFeed (web ./shared) ─────────────────────────────────────── */

function WidgetEventFeed({
  items,
  maxItems,
  compact = false,
  emptyMessage,
  emptyIcon,
  testID,
}: {
  items: EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  /** Native-only testing hook; absent from the web source. */
  testID?: string;
}) {
  const {t} = useTranslation('dashboard');
  const {formatDateTime} = useDateFormat();

  const formatRelativeTime = useCallback(
    (isoStr: string): string => {
      const d = new Date(isoStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMin = Math.floor(diffMs / 60_000);
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return `${diffHrs}h ago`;
      return formatDateTime(isoStr);
    },
    [formatDateTime],
  );

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
        style={styles.feedEmpty}
        testID={testID}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.feedList} testID={testID}>
      {sorted.map((item, i) => (
        <TimelineItem
          key={item.id}
          color={item.color}
          icon={item.icon}
          isLast={i === sorted.length - 1}
          subtitle={item.subtitle}
          time={formatRelativeTime(item.timestamp)}
          title={item.title}
        />
      ))}
    </ScrollView>
  );
}

/* ─── Status → visual mapping (web STATUS_MAP / DEFAULT_STATUS) ───────────── */

interface StatusVisual {
  iconName: SemanticIconName;
  color: string;
  severity: EventFeedItem['severity'];
}

// web lucide icons -> SemanticIcon glyphs: CheckCircle2 -> success, Download ->
// download, ArrowDownCircle -> arrowDownToDot, Clock -> clock. Colours/severity
// preserved verbatim from the source.
const STATUS_MAP: Record<string, StatusVisual> = {
  installed: {iconName: 'success', color: '#22c55e', severity: 'info'},
  installing: {iconName: 'arrowDownToDot', color: '#f59e0b', severity: 'warning'},
  downloading: {iconName: 'arrowDownToDot', color: '#3b82f6', severity: 'info'},
  available: {iconName: 'download', color: '#6b7280', severity: 'info'},
  scheduled: {iconName: 'clock', color: '#a78bfa', severity: 'info'},
};

const DEFAULT_STATUS: StatusVisual = {
  iconName: 'download',
  color: '#6b7280',
  severity: 'info',
};

/* ─── Compact layout (1-col) ─────────────────────────────────────────────── */

function CompactView({
  latestVersion,
  latestStatus,
  t,
}: {
  latestVersion: string;
  latestStatus: string;
  t: TFunc;
}) {
  const variant: BadgeVariant =
    latestStatus === 'installed'
      ? 'success'
      : latestStatus === 'installing'
        ? 'warning'
        : 'info';
  return (
    <View style={styles.compactRow}>
      <View style={styles.compactLeft}>
        <GlyphIcon color={colors.accent} name="download" size={14} />
        <AppText numberOfLines={1} style={styles.compactVersion}>
          {latestVersion}
        </AppText>
      </View>
      <Badge variant={variant}>
        {latestStatus === 'installed'
          ? t('widget.updateCurrent', 'Current')
          : t('widget.updateStatus', latestStatus)}
      </Badge>
    </View>
  );
}

/* ─── Main widget ────────────────────────────────────────────────────────── */

export default function SoftwareUpdateHistoryWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : '';

  const {
    data: updates,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSoftwareUpdates(vidStr);

  const isCompact = size.cols <= 1;
  const list = useMemo(() => updates ?? [], [updates]);

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      list.map((upd, idx) => {
        const mapped = STATUS_MAP[upd.status] ?? DEFAULT_STATUS;
        const isCurrent = idx === 0 && upd.status === 'installed';
        const color = isCurrent ? CURRENT_COLOR : mapped.color;
        const iconName: SemanticIconName = isCurrent ? 'success' : mapped.iconName;
        return {
          id: upd.id,
          icon: <GlyphIcon color={color} name={iconName} size={13} />,
          title: upd.version ?? '—',
          subtitle: isCurrent
            ? t('widget.updateCurrent', 'Current')
            : (upd.status ?? '—'),
          timestamp:
            upd.installedAt ??
            upd.scheduledAt ??
            upd.createdAt ??
            new Date(0).toISOString(),
          color,
          severity: mapped.severity,
        };
      }),
    [list, t],
  );

  // Latest installed version for compact view
  const latest = list.length > 0 ? list[0] : null;

  return (
    <WidgetShell
      icon={<GlyphIcon color={colors.accent} name="download" size={13} />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.softwareUpdateHistory', 'Update History')}
      updatedAt={dataUpdatedAt}>
      {isCompact ? (
        latest ? (
          <CompactView
            latestStatus={latest.status ?? '—'}
            latestVersion={latest.version ?? '—'}
            t={t}
          />
        ) : (
          <EmptyState
            icon={<GlyphIcon color={colors.textMuted} name="download" size={18} />}
            message={t('widget.noUpdates', 'No update history')}
            style={styles.compactEmpty}
            testID="software-update-empty"
          />
        )
      ) : (
        <View style={styles.feedWrap}>
          <WidgetEventFeed
            compact={false}
            emptyIcon={
              <GlyphIcon color={colors.textMuted} name="download" size={18} />
            }
            emptyMessage={t('widget.noUpdates', 'No update history')}
            items={feedItems}
            maxItems={15}
            testID="software-update-feed"
          />
        </View>
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  glyph: {
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // WidgetShell
  shell: {
    flex: 1,
    position: 'relative',
  },
  shellSkeleton: {
    height: '100%',
    minHeight: 120,
  },
  shellError: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellErrorText: {
    textAlign: 'center',
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // DataFreshness
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  freshnessLabel: {
    fontSize: 10,
  },
  // Badge (web Badge size="md")
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 9999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // CompactView (web flex items-center justify-between min-h-[44px])
  compactRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 44,
  },
  compactLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  compactVersion: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
  compactEmpty: {
    paddingVertical: spacing.md,
  },
  // WidgetEventFeed
  feedWrap: {
    flex: 1,
    minHeight: 0,
  },
  feedList: {
    paddingVertical: 2,
  },
  feedEmpty: {
    paddingVertical: spacing.md,
  },
  // TimelineItem (web flex gap-3)
  timelineRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  timelineIconCol: {
    alignItems: 'center',
  },
  timelineIconBox: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  timelineConnector: {
    backgroundColor: colors.border,
    flex: 1,
    marginTop: spacing.xs,
    width: 1,
  },
  timelineBody: {
    flex: 1,
    paddingBottom: spacing.md,
  },
  timelineTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  timelineSubtitle: {
    marginTop: 2,
  },
  timelineTime: {
    fontSize: 10,
    marginTop: spacing.xs,
  },
});
