// Native parity port of web/src/features/dashboard/widgets/DashboardStatsWidget.tsx.
//
// Dashboard widget that merges three queries — fleet stats, the active vehicle's
// FSM state, and its recent state-transition timeline — into a size-responsive
// summary inside a widget shell. Compact (1-col) widgets show a single big
// "trips" number; standard widgets show a 2-up stat grid + a current-state
// badge; wide (≥3-col) widgets additionally list the 5 most recent state
// transitions. The web file pulls in browser-only or web-UI dependencies that
// are absent from the native parity manifest (contract rules 4, 5 & 7); each is
// replaced with a React Native-safe equivalent and documented here + in the
// sidecar:
//
//   - react-i18next `useTranslation('dashboard')` (web L2, L17) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.dashboardStats.*','<English>') call keeps its English default +
//     translation-key intent (the established AlertFeed/ChargeHistory pattern).
//   - lucide-react LayoutDashboard (web L3, L73, L140) -> the shared native
//     SemanticIcon 'layoutDashboard' (its dashboard glyph). lucide SVG has no
//     native renderer; SemanticIcon tone is fixed per name, so the web title
//     icon's text-indigo-400 tint collapses to the icon's intrinsic violet tone
//     — the same color-tint -> semantic-icon collapse used by the AlertFeed
//     (neon-cyan->notifications) / ChargeHistory (neon-green->analytics) ports.
//   - `@/components/data-display` StatusBadge (web L4) -> the ported native
//     StatusBadge (same state-coloured dot + capitalized label).
//   - `@/components/ui` Badge (web L5, L123) -> inlined native Badge: the web
//     `variant="neutral"` chip is a gray rounded pill; reproduced with a RN View
//     (surfaceRaised bg + border) + capitalized 10px caption. No native Badge
//     port exists yet, so the neutral subset this widget uses is inlined.
//   - `@/components/feedback` EmptyState (web L6, L139) -> inlined native
//     EmptyState: the web icon+message (no title/action) centred placeholder is
//     reproduced with RN primitives (the established ChargeHistory inline-empty
//     precedent), honouring the widget's lighter `py-4` padding.
//   - `@/api/hooks/useDashboard` useDashboardStats (web L7) -> ported native hook
//     (same '/dashboard/stats' query, same DashboardStats shape).
//   - `@/api/hooks/useAdmin` useVehicleStateMachine + useStateTimeline (web L8)
//     -> ported native hooks (same '/vehicles/{id}/state' +
//     '/vehicle-states/timeline?vehicle_id=&days=' queries; the timeline route is
//     @deprecated/404 in both web + native and surfaces gracefully via isError).
//   - `@/api/hooks/useVehicles` useVehicles (web L9) -> ported native hook (same
//     '/vehicles' query, same Vehicle[] shape with numeric `id`).
//   - `@/lib/dateFormat` formatRelative (web L10, L129) -> inlined native-safe
//     port (verbatim "just now"/"Nm ago"/"Nh ago"/"Nd ago" ladder, falling back
//     to a locale short date), mirroring the AlertFeed/RecentActivity precedent.
//   - `@/lib/numberFormat` fmtInt (web L11, L36/40/44/90) -> inlined native-safe
//     0-decimal locale formatter (the web global-precision/global-locale state is
//     a display-only concern; native renders integers with en-US separators).
//   - `./WidgetShell` WidgetShell (web L12) -> inlined native WidgetShell (the
//     same skeleton/error/header/overlay-freshness/pulse subset already ported by
//     the AlertFeed/ChargeHistory widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./shared` WidgetStatGrid + type StatGridItem (web L13) -> inlined native
//     WidgetStatGrid rendering the ported native StatCard in a fixed RN column
//     grid (web's @container column table has no RN equivalent, so it collapses
//     to the resolved fixed column count). Separate source file, not yet ported,
//     so inlined here.
//   - `./types` WidgetProps (web L14) -> inlined native WidgetSize/WidgetProps
//     (the vehicleId/size subset this widget reads).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives, and the shared native SemanticIcon / AppText / theme tokens plus
// the ported parity StatusBadge / StatCard / DataFreshness / QueryError /
// useDashboardStats / useVehicleStateMachine / useStateTimeline / useVehicles.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {
  useStateTimeline,
  useVehicleStateMachine,
} from '../../../api/hooks/useAdmin';
import {useDashboardStats} from '../../../api/hooks/useDashboard';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {StatCard} from '../../../components/data-display/StatCard';
import {StatusBadge} from '../../../components/data-display/StatusBadge';
import {QueryError} from '../../../components/feedback/QueryError';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/numberFormat fmtInt (ported inline, native-safe 0-decimal) ──
function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  try {
    return n.toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(n));
  }
}

// ── @/lib/dateFormat formatRelative (ported inline subset, native-safe) ──
function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
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
  return formatDateShort(iso);
}

// ── @/components/ui Badge (neutral variant, ported inline native-safe) ──
function Badge({children}: {children: string}) {
  return (
    <View style={styles.badge}>
      <AppText numberOfLines={1} style={styles.badgeText} tone="secondary">
        {children}
      </AppText>
    </View>
  );
}

// ── @/components/feedback EmptyState (icon + message subset, ported inline) ──
interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
}

function EmptyState({icon, message}: EmptyStateProps) {
  // Transient empty state — surfaces when source data is missing; no specific
  // recovery action available (matches the web EmptyState no-action comment).
  return (
    <View style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ── ./shared WidgetStatGrid + StatGridItem (ported inline) ──
interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  valueColor?: string;
}

interface WidgetStatGridProps {
  stats: StatGridItem[];
  compact?: boolean;
  cols?: 2 | 3 | 4;
}

function autoCols(count: number): 2 | 3 | 4 {
  if (count % 3 === 0) {
    return 3;
  }
  if (count % 4 === 0) {
    return 4;
  }
  return 2;
}

function colWidthStyle(cols: 1 | 2 | 3 | 4) {
  switch (cols) {
    case 1:
      return styles.cellC1;
    case 3:
      return styles.cellC3;
    case 4:
      return styles.cellC4;
    default:
      return styles.cellC2;
  }
}

function WidgetStatGrid({stats, compact, cols}: WidgetStatGridProps) {
  if (stats.length === 0) {
    return <EmptyState message="No stats available" />;
  }

  // RN has no CSS container queries; the web @container column table collapses
  // to the resolved fixed column count.
  const resolvedCols = compact ? 1 : cols ?? autoCols(stats.length);

  return (
    <View style={styles.grid}>
      {stats.map(stat => (
        <View key={stat.label} style={[styles.cell, colWidthStyle(resolvedCols)]}>
          <StatCard
            icon={stat.icon}
            label={stat.label}
            trend={
              stat.trend && stat.trendValue
                ? {
                    direction: stat.trend,
                    positive: stat.trend === 'up',
                    value: stat.trendValue,
                  }
                : undefined
            }
            unit={stat.unit}
            value={stat.value}
          />
        </View>
      ))}
    </View>
  );
}

// ── ./WidgetShell (ported inline, native-safe subset) ──
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
  // Pulse-on-data-change glow (web WidgetShell L59-80).
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
    return (
      <View
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
        style={styles.skeleton}
      />
    );
  }

  if (error) {
    return (
      <View style={styles.errorWrap}>
        <QueryError error={new Error(error)} />
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1×1 widgets).
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
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            {icon}
            <AppText numberOfLines={1} style={styles.title}>
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.overlayFreshness}>{freshnessEl}</View>
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

// ── ./types WidgetSize / WidgetProps (ported inline subset) ──
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

export default function DashboardStatsWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : '';

  const stats = useDashboardStats();
  const fsm = useVehicleStateMachine(idStr);
  const timeline = useStateTimeline(idStr);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const dashStats = stats.data;
  const fsmState = fsm.data?.state ?? '—';
  // Memoized so the `?? []` fallback keeps a stable reference across renders
  // (web relied on its eslint config tolerating the fresh-array literal; the
  // native react-hooks/exhaustive-deps rule requires this). Value is identical.
  const transitions = useMemo(
    () => timeline.data?.transitions ?? [],
    [timeline.data?.transitions],
  );

  const statItems = useMemo<StatGridItem[]>(
    () => [
      {
        label: t('widget.dashboardStats.vehicles', 'Vehicles'),
        value: fmtInt(dashStats?.totalVehicles ?? 0),
      },
      {
        label: t('widget.dashboardStats.trips', 'Trips'),
        value: fmtInt(dashStats?.totalTrips ?? 0),
      },
      {
        label: t('widget.dashboardStats.sessions', 'Charge Sessions'),
        value: fmtInt(dashStats?.totalChargingSessions ?? 0),
      },
      {
        label: t('widget.dashboardStats.fsmState', 'FSM State'),
        value: fsmState,
      },
    ],
    [dashStats, fsmState, t],
  );

  const recentTransitions = useMemo(
    () => (isWide ? transitions.slice(0, 5) : []),
    [transitions, isWide],
  );

  /* Freshness: merge from all queries */
  const updatedAt = Math.max(
    stats.dataUpdatedAt ?? 0,
    fsm.dataUpdatedAt ?? 0,
    timeline.dataUpdatedAt ?? 0,
  );
  const isFetching = stats.isFetching || fsm.isFetching || timeline.isFetching;
  const isStale = stats.isStale || fsm.isStale || timeline.isStale;
  const isError = stats.isError || fsm.isError || timeline.isError;
  const isLoading = stats.isLoading || fsm.isLoading;

  const hasData = stats.data != null;

  return (
    <WidgetShell
      icon={
        isCompact ? undefined : (
          <SemanticIcon decorative name="layoutDashboard" size="sm" />
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => {
        void stats.refetch();
        void fsm.refetch();
        void timeline.refetch();
      }}
      title={
        isCompact ? undefined : t('widget.dashboardStats.title', 'Dashboard Stats')
      }
      updatedAt={updatedAt}>
      {hasData ? (
        <View style={styles.body}>
          {isCompact ? (
            <View style={styles.compact}>
              <AppText style={styles.compactValue} weight="bold">
                {fmtInt(dashStats?.totalTrips ?? 0)}
              </AppText>
              <AppText tone="secondary" variant="caption">
                {t('widget.dashboardStats.active', 'active')}
              </AppText>
            </View>
          ) : (
            <>
              <WidgetStatGrid cols={2} compact={false} stats={statItems} />

              {/* FSM badge row */}
              <View style={styles.fsmRow}>
                <AppText tone="secondary" variant="caption">
                  {t('widget.dashboardStats.currentState', 'Current State')}
                </AppText>
                <StatusBadge size="sm" status={fsmState} />
              </View>
            </>
          )}

          {/* Wide: recent state transitions */}
          {isWide && recentTransitions.length > 0 ? (
            <View style={styles.transitions}>
              <AppText
                style={styles.transitionsHeading}
                tone="muted"
                variant="caption">
                {t('widget.dashboardStats.recentTransitions', 'Recent Transitions')}
              </AppText>
              <ScrollView nestedScrollEnabled style={styles.transitionsList}>
                {recentTransitions.map((tr, i) => (
                  <View
                    key={`${tr.state}-${tr.startedAt}-${i}`}
                    style={styles.transitionRow}>
                    <View style={styles.transitionBadgeWrap}>
                      <Badge>{tr.state ?? '—'}</Badge>
                    </View>
                    <AppText
                      numberOfLines={1}
                      style={styles.transitionTime}
                      tone="secondary"
                      variant="caption">
                      {tr.startedAt ? formatRelative(tr.startedAt) : '—'}
                    </AppText>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : (
        <EmptyState
          icon={<SemanticIcon decorative name="layoutDashboard" size="md" />}
          message={t(
            'widget.dashboardStats.noData',
            'No dashboard stats available',
          )}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    textTransform: 'capitalize',
  },
  body: {
    flex: 1,
    gap: 12,
  },
  cell: {
    paddingBottom: 12,
    paddingHorizontal: 6,
  },
  cellC1: {
    width: '100%',
  },
  cellC2: {
    width: '50%',
  },
  cellC3: {
    width: '33.3333%',
  },
  cellC4: {
    width: '25%',
  },
  compact: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontVariant: ['tabular-nums'],
    lineHeight: 30,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyMessage: {
    maxWidth: 320,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  errorWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  fsmRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: -12,
    marginHorizontal: -6,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  overlayFreshness: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shell: {
    flex: 1,
  },
  shellPulse: {
    elevation: 6,
    shadowColor: '#22c55e',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flex: 1,
    minHeight: 120,
  },
  title: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  transitionBadgeWrap: {
    flex: 1,
    flexDirection: 'row',
    marginRight: 8,
    minWidth: 0,
  },
  transitionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  transitionTime: {
    fontVariant: ['tabular-nums'],
    maxWidth: '50%',
  },
  transitions: {
    flex: 1,
    gap: 6,
  },
  transitionsHeading: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  transitionsList: {
    flex: 1,
  },
});
