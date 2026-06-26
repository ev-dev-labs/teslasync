// Native parity port of web/src/features/dashboard/widgets/SystemHealthWidget.tsx.
//
// The web module is the dashboard "System Health" widget. It reads three admin
// queries — system health (GET /api/v1/system/health), DB stats
// (GET /api/v1/dev-tools/db-stats) and the connection pool / runtime info
// (GET /api/v1/dev-tools/runtime-info) — and renders one of two layouts driven
// by size.cols:
//   • Compact (1 col): a centred overall StatusBadge (online/away/offline) +
//     overall label (Healthy/Degraded/Down) + a "{healthyCount}/{total}
//     services" caption.
//   • Standard (>=2 cols): a 2-column service status grid (database / mqtt /
//     tesla_api / fleet_telemetry, each a glowing StatusDot + label) above a
//     2-column StatCard grid (DB Size, Active Conns, Memory, Goroutines).
// When the health query has no data the widget shows an EmptyState. Freshness +
// refresh are driven solely by the health query (updatedAt/fetching/stale/error/
// refetch), and the shell shows a Skeleton while loading and an inline error
// block on error — exactly as in the source.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?) returns the fallback (or key),
//     preserving every translation key verbatim.
//   • lucide-react Server -> the app SemanticIcon 'server' glyph rendered as a
//     colour-tinted AppText (GlyphIcon): the header Server is success-tinted
//     (web text-neon-green h-3.5) and the EmptyState Server is muted (web h-5,
//     no colour).
//   • @/components/data-display StatusBadge -> a local native pill StatusBadge
//     covering the three overall states this call site produces. The web badge
//     resolves its dot colour through getStateDefinition('vehicle', status):
//     'online' -> success green, 'offline' -> danger red, and 'away' (NOT a
//     registered vehicle FSM state) -> the neutral DEFAULT_STATE grey dot. That
//     grey-for-degraded resolution is reproduced faithfully (see sidecar note).
//   • @/components/data-display StatCard -> a local native StatCard (raised card
//     with a muted caption label + bold primary value), covering the four
//     label/value call sites (no icon/trend/sublabel/loading are used here).
//   • @/components/feedback EmptyState -> the native parity EmptyState (className
//     py-4 -> a paddingVertical style).
//   • @/api/hooks/useAdmin useSystemHealth/useDBStats/useConnectionPool -> the
//     already-ported native parity hooks (same names / return shapes / API
//     paths / refetch intervals).
//   • @/lib/numberFormat fmtInt -> inlined verbatim as fmtInt(v) = fixed-0-digit
//     en-US locale formatting via safeNumber (web fmtInt = fmtNumber(v, 0); the
//     web global-locale singleton has no RN analog so en-US — the web default
//     before a locale is configured — is used).
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly
//     the props this call site uses (title/icon/loading/error/updatedAt/
//     isFetching/isStale/isError/onRefresh/children): a Skeleton while loading,
//     an inline error block on error, a header row (icon + uppercase title +
//     freshness/refresh affordance), then the body.
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local
//     types (the shared registry types module is not yet in the parity tree).
//   • DOM <div>/<span> + Tailwind grids/classes + the shadow-[0_0_6px] glow ->
//     React Native View/AppText with StyleSheet tokens; the per-service status
//     dot keeps its coloured glow via shadowColor/shadowRadius; the stats grid's
//     `mt-auto` becomes marginTop:'auto'. The DataFreshness header indicator is
//     computed once at render (no interval) to avoid a dangling timer under
//     --detectOpenHandles.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {
  useConnectionPool,
  useDBStats,
  useSystemHealth,
} from '../../../api/hooks/useAdmin';

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

/* ─── i18n fallback (web react-i18next useTranslation/TFunction) ─────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation('dashboard'): the parity
// bundle ships no i18n runtime, so `t` returns the English fallback (or the key)
// while preserving every key at the call site.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat (fmtInt) ────────────────────────────────── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtInt(v) === fmtNumber(v, 0): locale-aware separators
// with zero fraction digits. The web global-locale singleton has no RN analog,
// so en-US (the web default before a locale is configured) is used.
function fmtInt(value: unknown): string {
  return safeNumber(value).toLocaleString('en-US', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

/* ─── domain constants + helpers (ported verbatim) ───────────────────────── */

type ServiceStatus = 'ok' | 'healthy' | 'degraded' | 'unhealthy';

const SERVICE_KEYS = [
  {key: 'database', i18n: 'db', emoji: '🟢'},
  {key: 'mqtt', i18n: 'mqtt', emoji: '🟢'},
  {key: 'tesla_api', i18n: 'teslaApi', emoji: '🟢'},
  {key: 'fleet_telemetry', i18n: 'workers', emoji: '🟢'},
] as const;

// web statusColor: ok/healthy -> green-500, degraded -> amber-400, else red-500
// (each carries a matching shadow-[0_0_6px] glow). Native maps to the success/
// warning/danger tokens; the glow is preserved via shadowColor in StatusDot.
function statusColor(status: ServiceStatus): string {
  if (status === 'ok' || status === 'healthy') return colors.success;
  if (status === 'degraded') return colors.warning;
  return colors.danger;
}

function StatusDot({status}: {status: ServiceStatus}) {
  const color = statusColor(status);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.statusDot, {backgroundColor: color, shadowColor: color}]}
    />
  );
}

function overallLabel(status: string, t: TFunc): string {
  if (status === 'healthy') return t('widget.systemHealth.healthy', 'Healthy');
  if (status === 'degraded') return t('widget.systemHealth.degraded', 'Degraded');
  return t('widget.systemHealth.down', 'Down');
}

type OverallBadge = 'online' | 'away' | 'offline';

function overallBadgeStatus(status: string): OverallBadge {
  if (status === 'healthy') return 'online';
  if (status === 'degraded') return 'away';
  return 'offline';
}

/* ─── tinted glyph icon (web lucide-react Server) ────────────────────────── */

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

/* ─── @/components/data-display StatusBadge (overall pill) ────────────────── */

// web StatusBadge resolves its dot colour through
// getStateDefinition('vehicle', status).badgeDot:
//   online  -> variant success -> bg-green-400  (success)
//   offline -> variant danger  -> bg-red-400    (danger)
//   away    -> NOT a registered vehicle FSM state -> DEFAULT_STATE neutral
//              -> bg-gray-400 (muted). Reproduced faithfully; see sidecar note.
const BADGE_DOT: Record<OverallBadge, string> = {
  online: colors.success,
  away: colors.textMuted,
  offline: colors.danger,
};

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function StatusBadge({
  status,
  size = 'md',
}: {
  status: OverallBadge;
  size?: 'sm' | 'md';
}) {
  const isSm = size === 'sm';
  return (
    <View
      style={[styles.statusBadge, isSm ? styles.statusBadgeSm : styles.statusBadgeMd]}
      testID="system-health-overall-badge">
      <View
        style={[
          styles.statusBadgeDot,
          isSm ? styles.statusBadgeDotSm : styles.statusBadgeDotMd,
          {backgroundColor: BADGE_DOT[status]},
        ]}
      />
      <AppText
        numberOfLines={1}
        style={isSm ? styles.statusBadgeTextSm : styles.statusBadgeTextMd}
        tone="secondary">
        {capitalize(status)}
      </AppText>
    </View>
  );
}

/* ─── @/components/data-display StatCard (label + value tile) ─────────────── */

function StatCard({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.statCard}>
      <AppText
        numberOfLines={1}
        style={styles.statLabel}
        tone="muted"
        variant="caption">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.statValue} weight="bold">
        {value}
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

/* ─── SystemHealthWidget ─────────────────────────────────────────────────── */

export default function SystemHealthWidget({size}: WidgetProps) {
  const {t} = useTranslation('dashboard');

  const health = useSystemHealth();
  const dbStats = useDBStats();
  const pool = useConnectionPool();

  const isCompact = size.cols <= 1;

  const services = useMemo(() => {
    const components = health.data?.components ?? {};
    return SERVICE_KEYS.map(svc => ({
      key: svc.key,
      label: t(
        `widget.systemHealth.${svc.i18n}`,
        svc.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      ),
      status: (components[svc.key]?.status ?? 'unhealthy') as ServiceStatus,
    }));
  }, [health.data, t]);

  const overallStatus = health.data?.status ?? 'unknown';
  const healthyCount = services.filter(
    s => s.status === 'ok' || s.status === 'healthy',
  ).length;

  const dbSize = health.data?.databaseSize ?? dbStats.data?.databaseSize ?? '—';
  const activeConns = pool.data?.inUse ?? 0;
  const maxConns = pool.data?.maxOpen ?? 0;
  const goroutines = (pool.data as Record<string, unknown> | undefined)
    ?.goroutines;
  const memory = (pool.data as Record<string, unknown> | undefined)?.memoryMB;

  const isLoading = health.isLoading;
  const hasError = health.error ? String(health.error) : null;
  const hasData = health.data != null;

  return (
    <WidgetShell
      title={
        isCompact ? undefined : t('widget.systemHealth.title', 'System Health')
      }
      icon={<GlyphIcon color={colors.success} name="server" size={13} />}
      loading={isLoading}
      error={hasError}
      updatedAt={health.dataUpdatedAt}
      isFetching={health.isFetching}
      isStale={health.isStale}
      isError={health.isError}
      onRefresh={() => health.refetch()}>
      {hasData ? (
        isCompact ? (
          // ── Compact layout (1×2) ──
          <View style={styles.compact} testID="system-health-compact">
            <StatusBadge size="sm" status={overallBadgeStatus(overallStatus)} />
            <AppText
              numberOfLines={1}
              style={styles.compactLabel}
              weight="semibold">
              {overallLabel(overallStatus, t)}
            </AppText>
            <AppText
              style={styles.compactMeta}
              tone="secondary"
              variant="caption">
              {healthyCount}/{services.length}{' '}
              {t('widget.systemHealth.services', 'services')}
            </AppText>
          </View>
        ) : (
          // ── Standard layout (2×4) ──
          <View style={styles.column}>
            {/* Service status grid */}
            <View style={styles.serviceGrid} testID="system-health-services">
              {services.map(svc => (
                <View key={svc.key} style={styles.serviceRow}>
                  <StatusDot status={svc.status} />
                  <AppText
                    numberOfLines={1}
                    style={styles.serviceLabel}
                    tone="secondary"
                    variant="caption">
                    {svc.label}
                  </AppText>
                </View>
              ))}
            </View>

            {/* Stats grid */}
            <View style={styles.statGrid} testID="system-health-stats">
              <View style={styles.statCell}>
                <StatCard
                  label={t('widget.systemHealth.dbSize', 'DB Size')}
                  value={dbSize}
                />
              </View>
              <View style={styles.statCell}>
                <StatCard
                  label={t('widget.systemHealth.activeConns', 'Active Conns')}
                  value={
                    maxConns > 0
                      ? `${fmtInt(activeConns)}/${fmtInt(maxConns)}`
                      : fmtInt(activeConns)
                  }
                />
              </View>
              <View style={styles.statCell}>
                <StatCard
                  label={t('widget.systemHealth.memory', 'Memory')}
                  value={memory != null ? `${fmtInt(memory)} MB` : '—'}
                />
              </View>
              <View style={styles.statCell}>
                <StatCard
                  label={t('widget.systemHealth.goroutines', 'Goroutines')}
                  value={goroutines != null ? fmtInt(goroutines) : '—'}
                />
              </View>
            </View>
          </View>
        )
      ) : (
        <EmptyState
          icon={<GlyphIcon color={colors.textSecondary} name="server" size={18} />}
          message={t('widget.systemHealth.noData', 'No system health data')}
          style={styles.emptyState}
        />
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
  // Compact layout
  compact: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    textAlign: 'center',
  },
  compactMeta: {
    fontSize: 12,
    textAlign: 'center',
  },
  // Standard layout
  column: {
    flex: 1,
    flexDirection: 'column',
    gap: spacing.md,
  },
  serviceGrid: {
    columnGap: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  serviceRow: {
    alignItems: 'center',
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    minHeight: 44,
  },
  serviceLabel: {
    flexShrink: 1,
    fontSize: 12,
  },
  statusDot: {
    borderRadius: 5,
    height: 10,
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.4,
    shadowRadius: 6,
    width: 10,
  },
  // StatusBadge (overall pill)
  statusBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: 'row',
  },
  statusBadgeSm: {
    gap: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadgeMd: {
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusBadgeDot: {
    borderRadius: 4,
  },
  statusBadgeDotSm: {
    height: 6,
    width: 6,
  },
  statusBadgeDotMd: {
    height: 8,
    width: 8,
  },
  statusBadgeTextSm: {
    fontSize: 12,
  },
  statusBadgeTextMd: {
    fontSize: 14,
  },
  // StatCard / Stats grid
  statGrid: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 'auto',
    rowGap: spacing.sm,
  },
  statCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'column',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 22,
  },
  emptyState: {
    paddingVertical: spacing.md,
  },
});
