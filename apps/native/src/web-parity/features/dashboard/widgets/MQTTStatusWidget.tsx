// Native parity port of web/src/features/dashboard/widgets/MQTTStatusWidget.tsx.
//
// The web widget is the dashboard "MQTT Status" tile. It polls
// `useMQTTStatus()` (GET /api/v1/telemetry — preserved verbatim by the
// already-ported native useTelemetry hook, which normalises the vehicles
// map/array + uptime fields) and renders one of two layouts driven by
// `size.cols`:
//   - Compact (cols <= 1): a centered `StatusBadge` (online/offline) over a big
//     `fmtNumber(messagesPerSec, 1)` value with a trailing "msg/s" unit.
//   - Standard (2x2+): a titled shell ("MQTT Status") wrapping a Status row
//     (uppercase "Status" label + StatusBadge), a 2-up `StatCard` grid
//     (Messages/sec = fmtNumber(,1), Total Messages = fmtInt), and a bottom
//     border-topped block with "Last Message" (formatRelative or em-dash) and
//     "Broker" rows.
// When `data` is missing both layouts fall back to an `EmptyState`
// ("No MQTT status data").
//
// Every state name (`data`, `isLoading`, `error`, `isFetching`, `isStale`,
// `isError`, `dataUpdatedAt`, `refetch`), the `size.cols <= 1` compact
// threshold, the `stats` useMemo + its `[data]` dependency, the
// `v.signalCount ?? v.signal_count ?? 0` / `v.signalsPerSecond ??
// v.signals_per_second ?? 0` / `v.lastReceived ?? v.last_received` null-safe
// derivations, the `lastReceivedDates.sort().reverse()[0]` newest-first pick,
// the `connected = data?.connected ?? false` / `broker = data?.broker ?? '—'`
// fallbacks, the `connected ? 'online' : 'offline'` badge status, and every
// `widget.mqtt.*` i18n key with its English fallback are preserved. Browser-only
// pieces are mapped to native-safe equivalents (documented in the parity
// sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as the APIUsageWidget /
//     ClimateStatusWidget ports), so every key + copy is preserved.
//   - lucide-react `Radio` has no native icon dependency; per the
//     APIUsageWidget glyph precedent it becomes a decorative monochrome Unicode
//     glyph ('\u25C9' fisheye — a dot-in-ring evoking the lucide broadcast dot)
//     in an `AppText` with `importantForAccessibility="no"`. h-3.5 (14px) ->
//     title icon fontSize 14 tinted to the success token (web `text-neon-green`,
//     mirroring the ClimateStatusWidget neon-cyan -> accent mapping); h-5 (20px)
//     -> empty icon fontSize 20 at the muted token.
//   - `@/lib/numberFormat` `fmtNumber`/`fmtInt` are inlined as native-safe
//     formatters mirroring the web module (locale-aware `toLocaleString`, the
//     out-of-box precision-2 / en-US defaults, safeNumber finite-or-0; fmtInt =
//     fmtNumber(v, 0)).
//   - `@/lib/dateFormat` `formatRelative` is inlined as a native-safe relative
//     formatter mirroring the web helper exactly ("just now" / "Nm ago" /
//     "Nh ago" / "Nd ago", else the "Apr 4, 2026" formatDate fallback; '—' for
//     nullish / invalid input).
//   - `@/components/data-display` `StatusBadge` (web reads its dot colour from
//     the `vehicle` FSM `getStateDefinition(...).badgeDot`) has no shared native
//     parity module, so it is reproduced locally (the VehicleHero StatusBadge
//     inline precedent): the badgeDot Tailwind classes resolve to literal hex
//     (online -> #4ade80 green-400, offline -> #f87171 red-400) and the dark
//     border/bg to #374151 / #1f2937; the `capitalize` CSS becomes a capitalize()
//     helper.
//   - `@/components/data-display` `StatCard` is the already-ported native parity
//     component. `@/components/feedback` `EmptyState` -> an inlined
//     `WidgetEmptyState` (centered glyph icon + muted message), and the web
//     `WidgetShell` (a transparent flex container with Skeleton loading +
//     QueryError + a DataFreshness header) -> an inlined native `WidgetShell` on
//     a GlassPanel (Spinner loading, danger-text error, uppercase title row + a
//     compact freshness dot/refresh control) — identical to the APIUsageWidget /
//     ClimateStatusWidget ports.
//   - `./WidgetShell` `WidgetShell` -> the inlined native WidgetShell above.
//     `./types` `WidgetProps` -> a local interface mirroring it (WidgetSize
//     {cols, rows}).

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useMQTTStatus} from '../../../api/hooks/useTelemetry';
import {StatCard} from '../../../components/data-display/StatCard';
import {Spinner} from '../../../components/feedback/Spinner';

/* ─── local widget types (mirror ./types — not yet ported) ─────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── i18n fallback shim (web react-i18next is unavailable in native) ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── native-safe number formatters (mirror web @/lib/numberFormat) ─────────── */

// The web `fmtNumber` reads a module-level global precision (default 2) + locale
// (default en-US) set by useSettings; the native parity layer has no settings
// store wired in here, so we mirror the web module's out-of-box defaults.
const DEFAULT_GLOBAL_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

// Mirrors web `fmtInt` (fmtNumber at precision 0 with locale separators).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── native-safe relative date formatting (web @/lib/dateFormat) ───────────── */

const EM_DASH = '\u2014';

// Mirrors web `formatDate` (toLocaleDateString {year, month:'short', day}).
function formatDate(iso: string | Date): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return EM_DASH;
  }
  try {
    return d.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return d.toDateString();
  }
}

// Mirrors web `formatRelative`: "just now" / "Nm ago" / "Nh ago" / "Nd ago",
// else the absolute date; '—' for nullish / invalid input.
function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return EM_DASH;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return EM_DASH;
  }
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
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
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(iso);
}

/* ─── decorative glyphs (lucide-react stand-ins) ───────────────────────────── */

// Monochrome dot-in-ring for lucide `Radio` so the accent tint applies.
const ICON_RADIO = '\u25C9';
const GLYPH_REFRESH = '\u21BB';

/* ─── inlined StatusBadge (web @/components/data-display/StatusBadge) ────────── */

// Vehicle FSM badgeDot Tailwind classes resolved to literal hex (the
// connected/disconnected states this widget passes; VehicleHero precedent).
const STATUS_DOT: Record<string, string> = {
  offline: '#f87171', // danger -> red-400
  online: '#4ade80', // success -> green-400
};
const STATUS_DOT_DEFAULT = '#9ca3af'; // neutral -> gray-400
const BADGE_BORDER = '#374151'; // dark:border-gray-700
const BADGE_BG = '#1f2937'; // dark:bg-gray-800

type BadgeSize = 'sm' | 'md';

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function StatusBadge({
  status,
  size = 'md',
}: {
  status: string;
  size?: BadgeSize;
}) {
  const dotColor = STATUS_DOT[status] ?? STATUS_DOT_DEFAULT;
  const isSm = size === 'sm';
  return (
    <View style={[styles.badge, isSm ? styles.badgeSm : styles.badgeMd]}>
      <View
        style={[
          styles.badgeDot,
          isSm ? styles.badgeDotSm : styles.badgeDotMd,
          {backgroundColor: dotColor},
        ]}
      />
      <AppText
        style={[styles.badgeText, isSm ? styles.badgeTextSm : styles.badgeTextMd]}>
        {capitalize(status)}
      </AppText>
    </View>
  );
}

StatusBadge.displayName = 'StatusBadge';

/* ─── inlined EmptyState (web @/components/feedback EmptyState) ─────────────── */

function WidgetEmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── inlined WidgetShell freshness control (web DataFreshness) ─────────────── */

interface WidgetFreshnessProps {
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetFreshness({
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetFreshnessProps) {
  let dotColor: string = colors.success;
  if (isError) {
    dotColor = colors.danger;
  } else if (isStale) {
    dotColor = colors.warning;
  } else if (isFetching) {
    dotColor = colors.accent;
  }

  const dot = (
    <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
  );

  if (!onRefresh) {
    return <View style={styles.freshnessRow}>{dot}</View>;
  }

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshnessRow}>
      {dot}
      <AppText importantForAccessibility="no" style={styles.freshnessGlyph}>
        {GLYPH_REFRESH}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined WidgetShell (web WidgetShell.tsx) ─────────────────────────────── */

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
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <Spinner size="sm" />
        </View>
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshness = showFreshness ? (
    <WidgetFreshness
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
    />
  ) : null;

  return (
    <GlassPanel style={styles.shell}>
      {title ? (
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            {icon}
            <AppText style={styles.titleText} tone="muted">
              {title}
            </AppText>
          </View>
          {freshness}
        </View>
      ) : freshness ? (
        <View style={styles.freshnessOverlay}>{freshness}</View>
      ) : null}
      {children}
    </GlassPanel>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function MQTTStatusWidget({size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useMQTTStatus();

  const isCompact = size.cols <= 1;

  const stats = useMemo(() => {
    const vehicles = data?.vehicles ?? [];
    const totalMessages = vehicles.reduce(
      (sum, v) => sum + (v.signalCount ?? v.signal_count ?? 0),
      0,
    );
    const messagesPerSec = vehicles.reduce(
      (sum, v) => sum + (v.signalsPerSecond ?? v.signals_per_second ?? 0),
      0,
    );
    const lastReceivedDates = vehicles
      .map(v => v.lastReceived ?? v.last_received)
      .filter(Boolean) as string[];
    const lastMessage =
      lastReceivedDates.length > 0
        ? lastReceivedDates.sort().reverse()[0]
        : null;
    return {totalMessages, messagesPerSec, lastMessage};
  }, [data]);

  const connected = data?.connected ?? false;
  const broker = data?.broker ?? EM_DASH;
  const badgeStatus = connected ? 'online' : 'offline';

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={
        isCompact ? undefined : (
          <AppText importantForAccessibility="no" style={styles.titleIcon}>
            {ICON_RADIO}
          </AppText>
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={isCompact ? undefined : t('widget.mqtt.title', 'MQTT Status')}
      updatedAt={dataUpdatedAt}>
      {data ? (
        isCompact ? (
          /* ── Compact layout (1×2) ── */
          <View style={styles.compact}>
            <StatusBadge size="sm" status={badgeStatus} />
            <View style={styles.compactValueRow}>
              <AppText numberOfLines={1} style={styles.compactValue}>
                {fmtNumber(stats.messagesPerSec, 1)}
              </AppText>
              <AppText style={styles.compactUnit}>
                {t('widget.mqtt.msgSec', 'msg/s')}
              </AppText>
            </View>
          </View>
        ) : (
          /* ── Standard layout (2×2+) ── */
          <View style={styles.standard}>
            {/* Connection status row */}
            <View style={styles.statusRow}>
              <AppText style={styles.statusLabel}>
                {t('widget.mqtt.status', 'Status')}
              </AppText>
              <StatusBadge size="sm" status={badgeStatus} />
            </View>

            {/* Stats grid */}
            <View style={styles.statsGrid}>
              <View style={styles.statsGridItem}>
                <StatCard
                  label={t('widget.mqtt.msgRate', 'Messages/sec')}
                  value={fmtNumber(stats.messagesPerSec, 1)}
                />
              </View>
              <View style={styles.statsGridItem}>
                <StatCard
                  label={t('widget.mqtt.totalToday', 'Total Messages')}
                  value={fmtInt(stats.totalMessages)}
                />
              </View>
            </View>

            {/* Last message & broker */}
            <View style={styles.footer}>
              <View style={styles.footerRow}>
                <AppText style={styles.footerLabel}>
                  {t('widget.mqtt.lastMessage', 'Last Message')}
                </AppText>
                <AppText numberOfLines={1} style={styles.footerValue}>
                  {stats.lastMessage
                    ? formatRelative(stats.lastMessage)
                    : EM_DASH}
                </AppText>
              </View>
              <View style={styles.footerRow}>
                <AppText style={styles.footerLabel}>
                  {t('widget.mqtt.broker', 'Broker')}
                </AppText>
                <AppText numberOfLines={1} style={styles.footerValue}>
                  {broker}
                </AppText>
              </View>
            </View>
          </View>
        )
      ) : (
        <WidgetEmptyState
          icon={
            <AppText
              importantForAccessibility="no"
              style={styles.emptyIconGlyph}>
              {ICON_RADIO}
            </AppText>
          }
          message={t('widget.mqtt.noData', 'No MQTT status data')}
        />
      )}
    </WidgetShell>
  );
}

MQTTStatusWidget.displayName = 'MQTTStatusWidget';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: BADGE_BG,
    borderColor: BADGE_BORDER,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
  },
  badgeDot: {
    borderRadius: 999,
  },
  badgeDotMd: {
    height: 8,
    width: 8,
  },
  badgeDotSm: {
    height: 6,
    width: 6,
  },
  badgeMd: {
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeSm: {
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.textSecondary,
  },
  badgeTextMd: {
    fontSize: 14,
    lineHeight: 18,
  },
  badgeTextSm: {
    fontSize: 12,
    lineHeight: 16,
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  compact: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactUnit: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '400',
    marginLeft: spacing.xs,
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  compactValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
  },
  emptyIconGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  footer: {
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
    gap: 6,
    marginTop: 'auto',
    paddingTop: spacing.sm,
  },
  footerLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerValue: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
    marginLeft: spacing.sm,
    textAlign: 'right',
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    zIndex: 5,
  },
  freshnessRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  shell: {
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  standard: {
    gap: spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statsGridItem: {
    flex: 1,
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.6,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  titleIcon: {
    color: colors.success,
    fontSize: 14,
    lineHeight: 16,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
