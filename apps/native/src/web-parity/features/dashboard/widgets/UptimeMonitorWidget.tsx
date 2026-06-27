// Native parity port of web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx.
//
// The web widget is the dashboard "Uptime Monitor" tile. It polls the fleet
// system-health endpoint (useSystemHealth()) and renders one of two layouts
// inside a <WidgetShell>:
//   - compact (1x1): an "Overall" status <Badge> plus a centred
//     {healthyCount}/{services.length} big number;
//   - full: the "Overall" status <Badge> plus one <ServiceRow> per service
//     (database / mqtt / tesla_api / fleet_telemetry), each a coloured
//     <StatusDot> + i18n label + an OK/status <Badge>;
//   - tall (rows >= 2, full only): an extra DB Size / Tables detail block
//     pinned to the bottom (mt-auto) above a faint top border.
// When `data` is missing it falls back to an <EmptyState>.
//
// This native port preserves that contract 1:1 — identical SERVICE_KEYS,
// statusVariant() branch order, the same useSystemHealth() destructuring,
// the same isCompact/isTall derivations, the same services useMemo (key,
// computed i18n label, status ?? 'unhealthy', failures ?? 0, lastError ??
// null), the same overallStatus ?? 'unknown' + healthyCount filter, the same
// i18n keys + English defaults, and the same visual intent — using React
// Native primitives, the existing native AppText + design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?) =
//     fallback ?? key, preserving every key + English default (incl. the
//     computed service-label default key.replace(/_/g,' ').replace(...)).
//   - lucide-react Activity (web L3): DOM SVG icon -> a glyph stand-in
//     (heartbeat 💓) tinted neon-green -> colors.success, reused at 20px muted
//     for the empty-state icon.
//   - @/components/ui Badge (web L4): reproduced as a native <Badge> with the
//     dark-theme success/warning/danger pill colours the web Tailwind classes
//     resolve to (rounded-full, font-medium, px-2/py-0.5); the ServiceRow
//     text-[10px] override becomes the `tiny` size.
//   - @/components/feedback EmptyState (web L5): reproduced as a native-safe
//     <EmptyState> (centred icon + muted message).
//   - @/api/hooks/useAdmin useSystemHealth (web L6): the already-ported
//     web-parity hook (../../../api/hooks/useAdmin).
//   - ./WidgetShell (web L7): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the 1500ms green pulse-on-update effect,
//     the inline DataFreshness chip (tap-to-refresh, dot-only when title-less),
//     and the `actions` slot.
//   - ./types WidgetProps (web L8): the dashboard widget types module is not
//     yet ported, so WidgetSize { cols, rows } + WidgetProps are mirrored.

import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useSystemHealth} from '../../../api/hooks/useAdmin';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-in (web L3)                               */
/* ------------------------------------------------------------------ */

const ICON_ACTIVITY = '\uD83D\uDC93'; // 💓 (Activity / heartbeat pulse)

/* services / detail fallback (web L115/L119) */
const DASH = '\u2014'; // "—"

/* StatusDot fill colours (web L23-26, Tailwind bg-{...}-{500/400}) */
const DOT_GREEN = '#22c55e'; // green-500
const DOT_AMBER = '#fbbf24'; // amber-400
const DOT_RED = '#ef4444'; // red-500

/* native <Badge> dark-theme palette (web @/components/ui Badge variants) */
const BADGE_SUCCESS_BG = '#14532d'; // dark:bg-green-900
const BADGE_SUCCESS_TEXT = '#bbf7d0'; // dark:text-green-200
const BADGE_WARNING_BG = '#713f12'; // dark:bg-yellow-900
const BADGE_WARNING_TEXT = '#fef08a'; // dark:text-yellow-200
const BADGE_DANGER_BG = '#7f1d1d'; // dark:bg-red-900
const BADGE_DANGER_TEXT = '#fecaca'; // dark:text-red-200

/* tall-detail divider (web border-white/[0.06]) + pulse glow */
const BORDER_FAINT = 'rgba(255, 255, 255, 0.06)';
const PULSE_GLOW = '#22c55e'; // shadow rgba(34,197,94,0.15)

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
/*  ported: SERVICE_KEYS / ServiceStatus / statusVariant (web L10-18)  */
/* ------------------------------------------------------------------ */

const SERVICE_KEYS = [
  'database',
  'mqtt',
  'tesla_api',
  'fleet_telemetry',
] as const;

type ServiceStatus = 'ok' | 'healthy' | 'degraded' | 'unhealthy';

type BadgeVariant = 'success' | 'warning' | 'danger';

function statusVariant(status: ServiceStatus): BadgeVariant {
  if (status === 'ok' || status === 'healthy') {
    return 'success';
  }
  if (status === 'degraded') {
    return 'warning';
  }
  return 'danger';
}

/* ------------------------------------------------------------------ */
/*  native Badge (web @/components/ui Badge)                            */
/* ------------------------------------------------------------------ */

interface BadgeProps {
  variant: BadgeVariant;
  label: string;
  tiny?: boolean;
}

function Badge({variant, label, tiny}: BadgeProps) {
  const bgStyle =
    variant === 'success'
      ? styles.badgeSuccess
      : variant === 'warning'
        ? styles.badgeWarning
        : styles.badgeDanger;
  const textColorStyle =
    variant === 'success'
      ? styles.badgeTextSuccess
      : variant === 'warning'
        ? styles.badgeTextWarning
        : styles.badgeTextDanger;

  return (
    <View style={[styles.badge, bgStyle]}>
      <AppText
        numberOfLines={1}
        style={[
          styles.badgeText,
          tiny ? styles.badgeTextTiny : styles.badgeTextSm,
          textColorStyle,
        ]}>
        {label}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  ported: StatusDot (web L20-29)                                     */
/* ------------------------------------------------------------------ */

function StatusDot({status}: {status: ServiceStatus}) {
  const color =
    status === 'ok' || status === 'healthy'
      ? DOT_GREEN
      : status === 'degraded'
        ? DOT_AMBER
        : DOT_RED;

  return (
    <View style={[styles.statusDot, {backgroundColor: color, shadowColor: color}]} />
  );
}

/* ------------------------------------------------------------------ */
/*  ported: ServiceRow (web L31-43)                                    */
/* ------------------------------------------------------------------ */

function ServiceRow({label, status}: {label: string; status: ServiceStatus}) {
  return (
    <View style={styles.serviceRow}>
      <View style={styles.serviceLeft}>
        <StatusDot status={status} />
        <AppText numberOfLines={1} style={styles.serviceLabel}>
          {label}
        </AppText>
      </View>
      <Badge
        tiny
        label={status === 'ok' || status === 'healthy' ? 'OK' : status}
        variant={statusVariant(status)}
      />
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
/*  UptimeMonitorWidget (web L45-133)                                 */
/* ------------------------------------------------------------------ */

export default function UptimeMonitorWidget({size}: WidgetProps) {
  const t = useNativeTranslation();
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSystemHealth();

  const isCompact = size.cols === 1 && size.rows === 1;
  const isTall = size.rows >= 2;

  const services = useMemo(() => {
    const components = data?.components ?? {};
    return SERVICE_KEYS.map(key => ({
      key,
      label: t(
        `widget.uptime.${key}`,
        key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      ),
      status: (components[key]?.status ?? 'unhealthy') as ServiceStatus,
      failures: components[key]?.consecutiveFailures ?? 0,
      lastError: components[key]?.lastError ?? null,
    }));
  }, [data, t]);

  const overallStatus = data?.status ?? 'unknown';
  const healthyCount = services.filter(
    s => s.status === 'ok' || s.status === 'healthy',
  ).length;

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<AppText style={styles.titleGlyph}>{ICON_ACTIVITY}</AppText>}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={isCompact ? undefined : t('widget.uptime.title', 'Uptime Monitor')}
      updatedAt={dataUpdatedAt}>
      {data ? (
        <View style={styles.container}>
          {/* Overall status badge */}
          <View style={styles.overallRow}>
            <AppText style={styles.overallLabel}>
              {t('widget.uptime.overall', 'Overall')}
            </AppText>
            <Badge
              label={
                overallStatus === 'healthy'
                  ? t('widget.uptime.allOk', 'All OK')
                  : overallStatus
              }
              variant={statusVariant(overallStatus as ServiceStatus)}
            />
          </View>

          {isCompact ? (
            /* Compact: just the count */
            <View style={styles.bigNumber}>
              <AppText style={styles.bigNumberText}>
                {healthyCount}/{services.length}
              </AppText>
            </View>
          ) : (
            /* Full: row per service */
            <View style={styles.serviceList}>
              {services.map(svc => (
                <ServiceRow key={svc.key} label={svc.label} status={svc.status} />
              ))}
            </View>
          )}

          {/* Extended detail in tall mode */}
          {isTall && !isCompact ? (
            <View style={styles.tallDetail}>
              <View style={styles.detailRow}>
                <AppText style={styles.detailLabel}>
                  {t('widget.uptime.dbSize', 'DB Size')}
                </AppText>
                <AppText style={styles.detailValue}>
                  {data.databaseSize ?? DASH}
                </AppText>
              </View>
              <View style={styles.detailRow}>
                <AppText style={styles.detailLabel}>
                  {t('widget.uptime.tables', 'Tables')}
                </AppText>
                <AppText style={styles.detailValue}>
                  {data.tableCount ?? DASH}
                </AppText>
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <EmptyState
          icon={<AppText style={styles.emptyGlyph}>{ICON_ACTIVITY}</AppText>}
          message={t('widget.uptime.noData', 'No system health data')}
        />
      )}
    </WidgetShell>
  );
}

UptimeMonitorWidget.displayName = 'UptimeMonitorWidget';

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
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeDanger: {
    backgroundColor: BADGE_DANGER_BG,
  },
  badgeSuccess: {
    backgroundColor: BADGE_SUCCESS_BG,
  },
  badgeText: {
    fontWeight: '500',
  },
  badgeTextDanger: {
    color: BADGE_DANGER_TEXT,
  },
  badgeTextSm: {
    fontSize: 12,
    lineHeight: 16,
  },
  badgeTextSuccess: {
    color: BADGE_SUCCESS_TEXT,
  },
  badgeTextTiny: {
    fontSize: 10,
    lineHeight: 14,
  },
  badgeTextWarning: {
    color: BADGE_WARNING_TEXT,
  },
  badgeWarning: {
    backgroundColor: BADGE_WARNING_BG,
  },
  bigNumber: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  bigNumberText: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  body: {
    flex: 1,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  container: {
    flex: 1,
    rowGap: spacing.sm,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailValue: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
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
  overallLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  overallRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  serviceLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  serviceLeft: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexShrink: 1,
  },
  serviceList: {
    rowGap: spacing.sm,
  },
  serviceRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  statusDot: {
    borderRadius: 999,
    elevation: 2,
    height: 10,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.4,
    shadowRadius: 6,
    width: 10,
  },
  tallDetail: {
    borderTopColor: BORDER_FAINT,
    borderTopWidth: 1,
    marginTop: 'auto',
    paddingTop: spacing.sm,
    rowGap: 2,
  },
  titleGlyph: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 16,
  },
});
