// Native parity port of web/src/features/dashboard/widgets/NotificationStatsWidget.tsx.
//
// `NotificationStatsWidget` is a dashboard widget that surfaces notification
// delivery health. It has two layouts driven by `size.cols`:
//   - compact (cols <= 1): one big delivery-rate "{rate}%" number + a "Delivery
//     Rate" caption + (when failed > 0) a "{n} failed" red line; or an
//     EmptyState when no stats.
//   - standard (2×2) / wide (2×4): a WidgetStatGrid of 4 core stats (Total Sent,
//     Delivery Rate, Failed, Active Channels) and — only when wide AND there are
//     recent logs — a DataTable of the most-recent notification logs
//     (channel/type/status/time); or an EmptyState when no stats.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3):
//   - The module-level `STATUS_VARIANT` map (sent->success, failed->danger,
//     pending->warning) (L14-18) is ported verbatim.
//   - The component reads `{ size }` (L20); `formatLogTime(isoStr)` (L24-34) is
//     ported verbatim — <1min "Just now", <60min "{n}m ago", <24h "{n}h ago",
//     else the `formatDateTime(isoStr)` fallback (these relative strings are NOT
//     i18n'd in the source, so they are kept verbatim — i18n intent unchanged).
//   - The destructured `useNotificationStats()` result (data:stats / isLoading:
//     statsLoading / error:statsError / isFetching:statsFetching / isStale:
//     statsStale / isError:statsIsError / dataUpdatedAt:statsUpdatedAt / refetch:
//     statsRefetch) (L36-45) and `useNotificationLogs()` result (data:logs /
//     isLoading:logsLoading / refetch:logsRefetch) (L47-51) are kept exact.
//   - `isCompact = size.cols <= 1`, `isWide = size.cols >= 3` (L53-54); the
//     derived `totalSent`/`sent`/`failed`/`enabledChannels` (`?? 0`) and
//     `deliveryRate = totalSent > 0 ? (sent / totalSent) * 100 : 0` (L56-60).
//   - The memoized `coreStats` (L62-94, deps [stats, totalSent, deliveryRate,
//     failed, enabledChannels, t]) — the 4 StatGridItems with their exact
//     labels/values/units/trends/trendValues and the `valueColor:'text-red-400'`
//     on Failed when failed>0 — is ported verbatim (icons swapped for glyph
//     stand-ins, see below). `recentLogs` (L96-102, deps [logs, isCompact]) — a
//     descending `created_at` sort sliced to (isCompact ? 3 : 5) — and the
//     memoized `logColumns` (L104-147, deps [t]) are ported verbatim. The
//     `handleRefresh` that fires both refetches (L149-152) is kept.
//   - Every i18n key + English default and every API field name (total_sent,
//     sent, failed, enabled_channels, title, message, status, created_at, id)
//     is kept verbatim. The API paths live in the reused `useNotifications`
//     parity hooks (/notifications/stats, /notifications/logs).
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local fallback
//     resolver returning the inline English string (it also interpolates
//     `{{name}}` placeholders from an options arg for parity with the sibling
//     widget shims, though this widget passes none). The namespace arg is
//     accepted + ignored.
//   - lucide-react icons (L3: Bell/Send/AlertTriangle/Radio/CheckCircle/XCircle/
//     Clock) -> there is no `react-native-svg` dependency, so they render as
//     decorative glyph stand-ins (the sibling SoftwareUpdateStatusWidget / Climate
//     History glyph precedent): Bell '🔔', Send '➤', AlertTriangle '⚠️',
//     Radio '📡', CheckCircle '✓', XCircle '✕', Clock '🕘'. The four stat-card
//     icons render via `<GlyphIcon>` (size 14 = h-3.5) inheriting the muted token
//     (the web StatCard icon slot is muted). The standard-header Bell keeps the
//     web `text-neon-cyan` accent via `colors.accent`; the two EmptyState Bells
//     (size 20 = h-5) take the muted token (matching the web EmptyState icon).
//     The three status icons (CheckCircle/XCircle/Clock) are rendered as an inline
//     glyph prefix inside the status Badge label — the native Badge wraps its
//     children in a single AppText carrying the variant text colour, so the glyph
//     inherits that colour, exactly reproducing the web `currentColor` icon tint
//     (and the `mr-1` gap becomes a single space). Only sent/failed/pending get a
//     glyph (matching the source's `status === ...` guards); other statuses show
//     the bare label.
//   - `@/components/ui` `Badge` + `Column` + `DataTable` (L4) -> the converted
//     web-parity Badge + DataTable ports. The status Badge keeps the
//     success/danger/warning variant from STATUS_VARIANT. The DataTable is driven
//     with the same `tableId`/`columns`/`data`/`keyExtractor`/`compact` props; the
//     web `className="text-xs"` (table) is ignored by the native DataTable
//     (className is a no-op), so the cell text size (text-xs -> 12) is applied via
//     the cell AppText styles. The per-column `className` strings
//     (`max-w-[120px]` / `max-w-[100px]` / `text-right whitespace-nowrap`) are
//     likewise ignored; truncation is reproduced with `numberOfLines={1}` and the
//     right-aligned Time column uses the native Column `align:'right'`.
//   - `@/components/feedback` `EmptyState` (L5) -> not yet ported, so its
//     icon+message rendering is reproduced locally as `<LocalEmptyState>` (centred
//     glyph + muted message, py-4). The source's "no-action transient empty state"
//     intent is preserved verbatim.
//   - `@/lib/numberFormat` `fmtInt` + `fmtNumber` (L7) -> inlined native-safe
//     equivalents (+ their `safeNumber` dep): nullish/non-finite -> 0, en-US
//     locale (no native locale-pref port yet), min=max fraction digits;
//     `fmtInt(v)` is `fmtNumber(v, 0)`.
//   - `@/hooks/useDateFormat` `useDateFormat` (L8) -> a local shim exposing
//     `formatDateTime` (web `@/lib/dateFormat`: Intl year/month-short/day +
//     2-digit hour/minute, '—' for nullish/invalid; resolves to en-US — no native
//     settings/locale port yet), matching the sibling ClimateHistoryWidget port.
//   - `./WidgetShell` `WidgetShell` (L9) -> reproduced locally (same
//     self-contained approach as the sibling widget ports): loading -> skeleton
//     block, error -> centred danger text (surfaced, never hidden), the title+icon
//     header with the freshness chip via the converted web-parity `DataFreshness`
//     port, the title-less overlay-freshness path (the compact 1×1 case), and the
//     px-4 pb-3 children body. The web pulse-on-data-change box-shadow glow
//     (L59-80, L116-118) is a CSS affordance with no native analog and is
//     intentionally omitted; the help-tooltip / pin-button / actions header slots
//     are unused by this widget and are not modeled.
//   - `./shared` `WidgetStatGrid` + `StatGridItem` (L10) -> the already-ported
//     sibling `./shared/WidgetStatGrid` (no barrel index in shared/).
//   - `./types` `WidgetProps` (L11) + `@/api/types` `NotificationLog` (L12) ->
//     the `WidgetProps`/`WidgetSize`/`WidgetConfig` subset is reproduced +
//     exported locally; `NotificationLog` is taken from the already-ported
//     web-parity `useNotifications` hook module (its inline type carries every
//     field this widget reads — id, title, message, status, created_at).
//
// Tailwind spacing -> px (1 unit = 4px): px-4->16, pt-3->12, pb-3->12, pb-1->4,
// gap-1.5->6, gap-0.5->2, space-y-3->12, mt-0.5->2, min-h-[44px]->44, py-4->16,
// text-2xl->24, text-xs->12, text-[10px]->10, text-[11px]->11. var(--text-*) ->
// the theme tokens so the light/dark cascade is preserved at the token boundary;
// text-red-400 kept as #f87171; uppercase/tracking-wider -> textTransform +
// letterSpacing. No DOM elements, Recharts, Leaflet, or old web UI components are
// imported — only RN primitives, AppText, theme tokens, and the converted
// web-parity Badge / DataTable / DataFreshness / WidgetStatGrid + the
// useNotifications parity hooks.

import React, {useMemo, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {Badge} from '../../../components/ui/Badge';
import {DataTable, type Column} from '../../../components/ui/DataTable';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {WidgetStatGrid, type StatGridItem} from './shared/WidgetStatGrid';
import {
  useNotificationStats,
  useNotificationLogs,
  type NotificationLog,
} from '../../../api/hooks/useNotifications';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. `{{name}}` placeholders are interpolated from the
// options arg for parity with the sibling widget shims (this widget passes
// none). The hook shape mirrors the web `const { t } = useTranslation('dashboard')`
// so the component body is unchanged.
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, options?: TOptions) => string;

function useTranslation(_namespace?: string): {t: TFunc} {
  return {
    t: (_key, fallback, options) => {
      if (!options) {
        return fallback;
      }
      return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        options[name] != null ? String(options[name]) : match,
      );
    },
  };
}

// ── useDateFormat shim (web @/hooks/useDateFormat -> @/lib/dateFormat) ────────
// `formatDateTime` mirrors the web helper: Intl year/month-short/day + 2-digit
// hour/minute with the en-US locale (no native settings/locale port yet), and
// '—' for nullish/invalid input.
type DateFormatter = (value: string | Date | null | undefined) => string;

function formatDateTimeImpl(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
}

function useDateFormat(): {formatDateTime: DateFormatter} {
  return {formatDateTime: formatDateTimeImpl};
}

// ── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber / fmtInt) ────────────
// Locale-aware formatting matching the web helpers: nullish/non-finite input
// coerces to 0, en-US locale, min=max fraction digits; `fmtInt` is
// `fmtNumber(v, 0)` (integer with locale separators).
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 0): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// ── lucide glyph stand-ins + colour intent ───────────────────────────────────
const NEON_CYAN = colors.accent; // text-neon-cyan
const RED_400 = '#f87171'; // text-red-400

const GLYPH_BELL = '\u{1F514}'; // 🔔 lucide Bell
const GLYPH_SEND = '\u{27A4}'; // ➤ lucide Send
const GLYPH_ALERT = '\u{26A0}\u{FE0F}'; // ⚠️ lucide AlertTriangle
const GLYPH_RADIO = '\u{1F4E1}'; // 📡 lucide Radio
const GLYPH_CHECK = '\u{2713}'; // ✓ lucide CheckCircle
const GLYPH_XCIRCLE = '\u{2715}'; // ✕ lucide XCircle
const GLYPH_CLOCK = '\u{1F558}'; // 🕘 lucide Clock

function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}) {
  const glyphStyle: StyleProp<TextStyle> = {
    color,
    fontSize: size,
    lineHeight: size,
  };
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={glyphStyle}>
      {glyph}
    </AppText>
  );
}

// ── Type reproductions (web ./types) ─────────────────────────────────────────
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

// Source L14-18: notification status -> Badge variant.
const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning'> = {
  sent: 'success',
  failed: 'danger',
  pending: 'warning',
};

// The status glyph prefix for the three statuses the web renders an icon for
// (sent/failed/pending). Other statuses show the bare label, matching the
// source's `status === ...` guards.
const STATUS_GLYPH: Record<string, string> = {
  sent: GLYPH_CHECK,
  failed: GLYPH_XCIRCLE,
  pending: GLYPH_CLOCK,
};

// ── Local `EmptyState` (web @/components/feedback, icon+message) ──────────────
function LocalEmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  // no-action: transient empty state — surfaces when source data is missing; no
  // specific recovery action available.
  return (
    <View style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// ── Local `WidgetShell` (web ./WidgetShell) ──────────────────────────────────
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never). */
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
  if (loading) {
    return <View accessibilityRole="progressbar" style={styles.skeleton} />;
  }
  if (error) {
    return (
      <View style={styles.errorBox}>
        <AppText tone="danger">{error}</AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl: ReactNode = showFreshness ? (
    <DataFreshness
      updatedAt={updatedAt > 0 ? updatedAt : null}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      isError={isError ?? false}
      onRefresh={onRefresh}
      compact={freshnessCompact}
    />
  ) : null;

  return (
    <View style={styles.shell}>
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
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export default function NotificationStatsWidget({size}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {formatDateTime} = useDateFormat();

  function formatLogTime(isoStr: string): string {
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

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsIsError,
    dataUpdatedAt: statsUpdatedAt,
    refetch: statsRefetch,
  } = useNotificationStats();

  const {
    data: logs,
    isLoading: logsLoading,
    refetch: logsRefetch,
  } = useNotificationLogs();

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const totalSent = stats?.total_sent ?? 0;
  const sent = stats?.sent ?? 0;
  const failed = stats?.failed ?? 0;
  const enabledChannels = stats?.enabled_channels ?? 0;
  const deliveryRate = totalSent > 0 ? (sent / totalSent) * 100 : 0;

  const coreStats = useMemo((): StatGridItem[] => {
    if (!stats) {
      return [];
    }
    return [
      {
        label: t('widget.notificationStats.totalSent', 'Total Sent (7d)'),
        value: fmtInt(totalSent),
        icon: <GlyphIcon glyph={GLYPH_SEND} color={colors.textMuted} size={14} />,
        trend: totalSent > 0 ? ('up' as const) : ('flat' as const),
        trendValue: totalSent > 0 ? fmtInt(totalSent) : undefined,
      },
      {
        label: t('widget.notificationStats.deliveryRate', 'Delivery Rate'),
        value: fmtNumber(deliveryRate, 1),
        unit: '%',
        icon: (
          <GlyphIcon glyph={GLYPH_CHECK} color={colors.textMuted} size={14} />
        ),
        trend:
          deliveryRate >= 95
            ? ('up' as const)
            : deliveryRate > 0
              ? ('down' as const)
              : ('flat' as const),
        trendValue:
          deliveryRate >= 95
            ? t('widget.notificationStats.healthy', 'Healthy')
            : undefined,
      },
      {
        label: t('widget.notificationStats.failed', 'Failed'),
        value: fmtInt(failed),
        icon: (
          <GlyphIcon glyph={GLYPH_ALERT} color={colors.textMuted} size={14} />
        ),
        valueColor: failed > 0 ? 'text-red-400' : undefined,
        trend: failed > 0 ? ('down' as const) : ('flat' as const),
        trendValue:
          failed > 0
            ? t('widget.notificationStats.needsAttention', 'Needs attention')
            : undefined,
      },
      {
        label: t('widget.notificationStats.activeChannels', 'Active Channels'),
        value: fmtInt(enabledChannels),
        icon: (
          <GlyphIcon glyph={GLYPH_RADIO} color={colors.textMuted} size={14} />
        ),
      },
    ];
  }, [stats, totalSent, deliveryRate, failed, enabledChannels, t]);

  const recentLogs = useMemo(() => {
    const list = logs ?? [];
    const limit = isCompact ? 3 : 5;
    return [...list]
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, limit);
  }, [logs, isCompact]);

  const logColumns = useMemo<Column<NotificationLog>[]>(
    () => [
      {
        key: 'channel',
        header: t('widget.notificationStats.channel', 'Channel'),
        className: 'max-w-[120px]',
        render: log => (
          <AppText numberOfLines={1} style={styles.cellSecondary}>
            {log.title ?? '—'}
          </AppText>
        ),
      },
      {
        key: 'type',
        header: t('widget.notificationStats.type', 'Type'),
        className: 'max-w-[100px]',
        render: log => (
          <AppText numberOfLines={1} style={styles.cellSecondary}>
            {log.message ?? '—'}
          </AppText>
        ),
      },
      {
        key: 'status',
        header: t('widget.notificationStats.status', 'Status'),
        render: log => {
          const glyph = STATUS_GLYPH[log.status];
          const label = log.status ?? '—';
          return (
            <Badge variant={STATUS_VARIANT[log.status] ?? 'warning'}>
              {glyph ? `${glyph} ${label}` : label}
            </Badge>
          );
        },
      },
      {
        key: 'time',
        header: t('widget.notificationStats.time', 'Time'),
        className: 'text-right whitespace-nowrap',
        align: 'right',
        render: log => (
          <AppText style={styles.cellMuted}>
            {formatLogTime(log.created_at)}
          </AppText>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const handleRefresh = () => {
    statsRefetch();
    logsRefetch();
  };

  // Compact layout: single big number
  if (isCompact) {
    return (
      <WidgetShell
        loading={statsLoading}
        error={statsError ? String(statsError) : null}
        updatedAt={statsUpdatedAt}
        isFetching={statsFetching}
        isStale={statsStale}
        isError={statsIsError}
        onRefresh={handleRefresh}>
        {stats ? (
          <View style={styles.compactBody}>
            <AppText style={styles.compactRate}>
              {fmtNumber(deliveryRate, 1)}%
            </AppText>
            <AppText style={styles.compactLabel}>
              {t('widget.notificationStats.deliveryRate', 'Delivery Rate')}
            </AppText>
            {failed > 0 && (
              <AppText style={styles.compactFailed}>
                {fmtInt(failed)}{' '}
                {t('widget.notificationStats.failedLabel', 'failed')}
              </AppText>
            )}
          </View>
        ) : (
          <LocalEmptyState
            icon={<GlyphIcon glyph={GLYPH_BELL} color={colors.textMuted} size={20} />}
            message={t('widget.notificationStats.noData', 'No notification data')}
          />
        )}
      </WidgetShell>
    );
  }

  const isLoading = statsLoading || logsLoading;

  // Standard (2×2) and Wide (2×4)
  return (
    <WidgetShell
      title={t('widget.notificationStats.title', 'Notification Stats')}
      icon={<GlyphIcon glyph={GLYPH_BELL} color={NEON_CYAN} size={14} />}
      loading={isLoading}
      error={statsError ? String(statsError) : null}
      updatedAt={statsUpdatedAt}
      isFetching={statsFetching}
      isStale={statsStale}
      isError={statsIsError}
      onRefresh={handleRefresh}>
      {stats ? (
        <View style={styles.standardStack}>
          <WidgetStatGrid stats={coreStats} cols={isWide ? 4 : 2} />

          {isWide && recentLogs.length > 0 && (
            <DataTable
              tableId="dashboard:notification-stats-recent"
              columns={logColumns}
              data={recentLogs}
              keyExtractor={log => log.id}
              compact
              className="text-xs"
            />
          )}
        </View>
      ) : (
        <LocalEmptyState
          icon={<GlyphIcon glyph={GLYPH_BELL} color={colors.textMuted} size={20} />}
          message={t('widget.notificationStats.noData', 'No notification data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  cellMuted: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
  },
  cellSecondary: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
  },
  compactBody: {
    alignItems: 'center',
    flex: 1,
    gap: 2, // gap-0.5
    justifyContent: 'center',
    minHeight: 44, // min-h-[44px]
  },
  compactFailed: {
    color: RED_400, // text-red-400
    fontSize: 10, // text-[10px]
    lineHeight: 14,
    marginTop: 2, // mt-0.5
  },
  compactLabel: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 10, // text-[10px]
    letterSpacing: 0.6, // tracking-wider
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  compactRate: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 24, // text-2xl
    fontWeight: '700', // font-bold
    lineHeight: 30,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16, // py-4
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16, // p-4
  },
  freshnessOverlay: {
    position: 'absolute',
    right: 6, // right-1.5
    top: 6, // top-1.5
    zIndex: 5,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11, // text-[11px]
    fontWeight: '500', // font-medium
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6, // gap-1.5
  },
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
  standardStack: {
    gap: 12, // space-y-3
  },
});
