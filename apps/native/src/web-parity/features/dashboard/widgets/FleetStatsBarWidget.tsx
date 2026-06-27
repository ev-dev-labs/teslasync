// Native parity port of web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx.
//
// Dashboard widget that merges two queries — the vehicle list and the trailing
// 30-day fleet analytics — into a 4-up stat bar (Vehicles, Online Now,
// Distance 30d, Energy 30d) inside a widget shell. The `size.rows < 2` compact
// size collapses the 4-column grid to a single column. The web file pulls in
// browser-only or web-UI dependencies that are absent from the native parity
// manifest (contract rules 4, 5 & 7); each is replaced with a React Native-safe
// equivalent and documented here + in the sidecar:
//
//   - react-i18next useTranslation('dashboard') (web L2, L15) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.fleetStatsBar.*','<English>') call keeps its English default +
//     translation-key intent (the established DashboardStats/MonthlyMileage port).
//   - lucide-react Car/Wifi/Route/Zap (web L3, L47/53/60/66/74/87) -> the shared
//     native SemanticIcon glyphs vehicle/wifi/navigation/bolt. lucide SVG has no
//     native renderer; SemanticIcon tone is fixed per name, so the web title
//     icon's text-cyan-400 tint collapses to the icon's intrinsic tone — the
//     same color-tint -> semantic-icon collapse used by the DashboardStats
//     (text-indigo-400->layoutDashboard) / MonthlyMileage (neon-cyan->analytics)
//     ports. Car->vehicle, Wifi->wifi, Route->navigation (route glyph),
//     Zap->bolt; the stat-bar semantic intent is preserved.
//   - `@/components/feedback` EmptyState (web L4, L86-90) -> inlined native
//     EmptyState (icon + message subset; honours the web `className="py-4"`
//     lighter padding), the established DashboardStats inline-empty precedent.
//   - `@/api/hooks/useVehicles` useVehicles (web L5) -> the ported native
//     useVehicles hook (same '/vehicles' query, same Vehicle[] shape with the
//     `state` string field this widget filters on).
//   - `@/api/hooks/useAnalytics` useFleetAnalytics (web L6) -> the ported native
//     useFleetAnalytics hook (same '/analytics/fleet?days=' query, same
//     FleetAnalytics shape with total_distance_km + total_energy_kwh).
//   - `@/hooks/useUnits` useUnits (web L7, L18) -> an inlined useUnits() bridge
//     over the ported useFormatPrefs() that exposes the same
//     { unitPrefs: { distance } } shape so the unitPrefs.distance call sites are
//     preserved (the MonthlyMileage port precedent).
//   - `@/lib/numberFormat` fmtNumber (web L8, L40/58/64) -> ported inline
//     (locale-aware fixed-precision toLocaleString, min==max fraction digits),
//     the same native fmtNumber the MonthlyMileage port inlines.
//   - `./WidgetShell` WidgetShell (web L9) -> inlined native WidgetShell (same
//     skeleton/error/header/overlay-freshness/pulse subset already ported by the
//     DashboardStats/MonthlyMileage widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./shared` WidgetStatGrid + type StatGridItem (web L10) -> inlined native
//     WidgetStatGrid rendering the ported native StatCard in a fixed RN column
//     grid (web's @container column table has no RN equivalent, so it collapses
//     to the resolved fixed column count — this widget passes cols={4}).
//   - `./types` WidgetProps (web L11) -> inlined native WidgetSize/WidgetProps
//     (the size subset this widget reads).
//   - `@/lib/unitConversion` convertDistanceFromSI (web L12, L19) -> imported
//     from the ported native format _formatPrimitives (meters -> km|mi), the same
//     native-safe SI display-boundary converter used by the MonthlyMileage port.
//     SI stays on the wire; conversion happens only at render.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives (StyleSheet/View), the shared native SemanticIcon / AppText / theme
// tokens, and the ported parity StatCard / DataFreshness / QueryError /
// useVehicles / useFleetAnalytics / useFormatPrefs / convertDistanceFromSI.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {useFleetAnalytics} from '../../../api/hooks/useAnalytics';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {StatCard} from '../../../components/data-display/StatCard';
import {
  convertDistanceFromSI,
  useFormatPrefs,
  type DistanceUnit,
} from '../../../components/data-display/format/_formatPrimitives';
import {QueryError} from '../../../components/feedback/QueryError';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/numberFormat fmtNumber (ported inline, native-safe) ──
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

// ── @/hooks/useUnits replacement (native bridge over useFormatPrefs) ──
// Native has no useUnits hook; the distance display preference is derived from
// the shared useFormatPrefs bridge (settings -> unit prefs) and exposed under
// the same { unitPrefs: { distance } } shape the web useUnits returns so the
// unitPrefs.distance call sites are preserved.
interface UnitPrefs {
  distance: DistanceUnit;
}

function useUnits(): {unitPrefs: UnitPrefs} {
  const {distanceUnit} = useFormatPrefs();
  return {unitPrefs: {distance: distanceUnit}};
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

export default function FleetStatsBarWidget({size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles, isLoading: vehiclesLoading} = useVehicles();
  const {
    data: analytics,
    isLoading: analyticsLoading,
    error,
    isFetching: analyticsFetching,
    isStale: analyticsStale,
    isError: analyticsIsError,
    dataUpdatedAt: analyticsUpdatedAt,
    refetch: refetchAnalytics,
  } = useFleetAnalytics(30);
  const {unitPrefs} = useUnits();
  // useCallback keeps the converter stable across renders so the stats useMemo
  // dependency list satisfies react-hooks/exhaustive-deps (the web file
  // recreated this inline each render; native lint is stricter). The computed
  // value is identical.
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;

  const isLoading = vehiclesLoading || analyticsLoading;

  const stats = useMemo(() => {
    const vehicleCount = vehicles?.length ?? 0;
    const onlineCount =
      vehicles?.filter(v => v.state === 'online').length ?? 0;
    // Preserved verbatim from web L28: total_distance_km is passed straight into
    // convertDistanceFromSI (no *1000). Behavior is reproduced exactly as the
    // web widget computes it.
    const totalDistance = toDistanceDisplay(analytics?.total_distance_km ?? 0);
    const totalEnergy = analytics?.total_energy_kwh ?? 0;
    return {vehicleCount, onlineCount, totalDistance, totalEnergy};
  }, [vehicles, analytics, toDistanceDisplay]);

  const isCompact = size.rows < 2;

  const hasData = (vehicles && vehicles.length > 0) || analytics;

  const items = useMemo<StatGridItem[]>(() => {
    const onlinePct =
      stats.vehicleCount > 0
        ? `${fmtNumber((stats.onlineCount / stats.vehicleCount) * 100, 0)}%`
        : undefined;

    return [
      {
        label: t('widget.fleetStatsBar.vehicles', 'Vehicles'),
        value: stats.vehicleCount,
        icon: <SemanticIcon decorative name="vehicle" size="sm" />,
        trendValue: `${stats.onlineCount} ${t('widget.fleetStatsBar.online', 'online')}`,
      },
      {
        label: t('widget.fleetStatsBar.onlineNow', 'Online Now'),
        value: stats.onlineCount,
        icon: <SemanticIcon decorative name="wifi" size="sm" />,
        trendValue: onlinePct,
      },
      {
        label: t('widget.fleetStatsBar.distance30d', 'Distance (30d)'),
        value: fmtNumber(stats.totalDistance, 1),
        unit: distanceUnit,
        icon: <SemanticIcon decorative name="navigation" size="sm" />,
      },
      {
        label: t('widget.fleetStatsBar.energy30d', 'Energy (30d)'),
        value: fmtNumber(stats.totalEnergy, 1),
        unit: 'kWh',
        icon: <SemanticIcon decorative name="bolt" size="sm" />,
      },
    ];
  }, [stats, t, distanceUnit]);

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<SemanticIcon decorative name="vehicle" size="sm" />}
      isError={analyticsIsError}
      isFetching={analyticsFetching}
      isStale={analyticsStale}
      loading={isLoading}
      onRefresh={() => refetchAnalytics()}
      title={t('widget.fleetStatsBar.title', 'Fleet Stats')}
      updatedAt={analyticsUpdatedAt}>
      {hasData ? (
        <WidgetStatGrid cols={4} compact={isCompact} stats={items} />
      ) : (
        <EmptyState
          icon={<SemanticIcon decorative name="vehicle" size="md" />}
          message={t('widget.fleetStatsBar.noData', 'No fleet data available')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
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
});
