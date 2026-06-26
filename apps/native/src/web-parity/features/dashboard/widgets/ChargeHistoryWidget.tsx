// Native parity port of web/src/features/dashboard/widgets/ChargeHistoryWidget.tsx.
//
// Dashboard widget that fetches a vehicle's 10 most recent charging sessions and
// renders their energy-added (kWh) as a chart-summary (Total + Avg stats plus an
// area chart) inside a widget shell. The web file pulls in browser-only or
// web-UI dependencies that are absent from the native parity manifest (contract
// rules 4, 5 & 7); each is replaced with a React Native-safe equivalent and
// documented here + in the sidecar:
//
//   - react-i18next `useTranslation('dashboard')` (web L2, L15) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.chargeHistory.*','<English>') / t('widget.noChargeHistory',…)
//     call keeps its English default + translation-key intent (the established
//     AlertFeed/RecentActivity port pattern).
//   - lucide-react BarChart3 (web L4, L63, L74, L85) -> the shared native
//     SemanticIcon 'analytics' (its bar-chart/analytics glyph). lucide SVG has no
//     native renderer. The title icon's text-neon-green tint collapses to the
//     SemanticIcon analytics intrinsic tone (per-name fixed tone; no override) —
//     the same color-tint -> semantic-icon collapse used by the BackupMonitor
//     (emerald->hardDrive) and AlertFeed (neon-cyan->notifications) ports; the
//     chart/charge-history intent is preserved.
//   - `@/components/charts` AreaChartWrapper + fmt (web L5, L44-45, L88-94) ->
//     imported from the ported native charts barrel (RN chart layers, no
//     Recharts). fmt keeps the same (value, decimals) numeric formatter.
//   - `@/api/hooks/useVehicles` useVehicles (web L6) -> the ported native
//     useVehicles hook (same '/vehicles' query, same UseQueryResult fields).
//   - `@/api/client` request (web L7) -> the ported native request<T>() client
//     (same '/api/v1'-relative path, same generic typing).
//   - `./shared` WidgetChartSummary + type ChartSummaryStat (web L8) -> inlined
//     native WidgetChartSummary: the stat row + optional chart + empty-state
//     contract reproduced with RN primitives (web's @container @sm flex
//     relaxation collapses to a plain 2-col row — RN has no container queries).
//     Separate source file, not yet ported, so inlined here.
//   - `./WidgetShell` WidgetShell (web L9) -> inlined native WidgetShell (same
//     skeleton/error/header/overlay-freshness/pulse subset already ported by the
//     AlertFeed/BackupMonitor widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./types` WidgetProps (web L10) -> inlined native WidgetSize/WidgetProps
//     (the vehicleId/size subset this widget reads).
//   - `../types` ChargingSession (web L11) -> inlined native ChargingSession
//     interface, ported verbatim from web dashboard/types.ts. The widget consumes
//     only the SI total_energy_added_wh field (converted to kWh at the display
//     boundary); the other fields are preserved for type fidelity.
//   - `@/lib/unitConversion` convertEnergyFromSI (web L12, L30) -> ported inline
//     (Wh -> kWh = wh / 1000), the same native-safe SI display-boundary converter
//     used by the RecentActivity port. SI stays on the wire; conversion happens
//     only at render.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives, @tanstack/react-query, the shared native SemanticIcon / AppText /
// theme tokens, and the ported parity AreaChartWrapper / fmt / useVehicles /
// request / DataFreshness / QueryError.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {StyleSheet, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AreaChartWrapper, fmt} from '../../../components/charts';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {QueryError} from '../../../components/feedback/QueryError';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/unitConversion convertEnergyFromSI (ported inline, SI display boundary) ──
type EnergyUnit = 'Wh' | 'kWh';

function convertEnergyFromSI(wh: number, to: EnergyUnit): number {
  return to === 'kWh' ? wh / 1000 : wh;
}

// ── ../types ChargingSession (ported verbatim from web dashboard/types.ts) ──
interface ChargingSession {
  id: number;
  vehicle_id: number;
  started_at: string;
  ended_at: string | null;
  total_energy_added_wh: number;
  start_soc_pct: number;
  end_soc_pct: number | null;
  cost_decimal: number | null;
  cost?: number | null;
  startedAt: string;
  duration_min: number;
}

// ── ./shared WidgetChartSummary + ChartSummaryStat (ported inline) ──
interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

interface WidgetChartSummaryProps {
  stats: ChartSummaryStat[];
  chart: ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  isEmpty?: boolean;
}

function WidgetChartSummary({
  stats,
  chart,
  compact,
  emptyMessage,
  emptyIcon,
  isEmpty,
}: WidgetChartSummaryProps) {
  // Transient empty state — surfaces when source data is missing; no specific
  // recovery action available (matches web EmptyState no-action comment).
  if (isEmpty) {
    return (
      <View style={styles.empty}>
        {emptyIcon ? <View style={styles.emptyIcon}>{emptyIcon}</View> : null}
        <AppText style={styles.emptyMessage} tone="muted" variant="caption">
          {emptyMessage ?? 'No data available'}
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.summaryRoot}>
      {stats.length > 0 ? (
        <View style={styles.statRow}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.statCell}>
              <AppText
                numberOfLines={1}
                style={styles.statLabel}
                tone="muted"
                variant="caption">
                {stat.label}
              </AppText>
              <AppText
                numberOfLines={1}
                style={styles.statValue}
                weight="semibold">
                {stat.value}
                {stat.unit ? (
                  <AppText style={styles.statUnit} tone="muted" weight="regular">
                    {` ${stat.unit}`}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? <View style={styles.chartArea}>{chart}</View> : null}
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

export default function ChargeHistoryWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: charges,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['charging', id, 'recent-10'],
    queryFn: () =>
      request<ChargingSession[]>(`/charging?vehicle_id=${id}&limit=10`),
    enabled: id > 0,
  });

  const chartData = useMemo(
    () =>
      (charges ?? [])
        .map((s, i) => ({
          i: String(i),
          energy: convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh'),
        }))
        .reverse(),
    [charges],
  );

  const hasData = chartData.length > 1;
  const isCompact = size.cols <= 1;

  const stats: ChartSummaryStat[] = useMemo(() => {
    if (!hasData) {
      return [];
    }
    const total = chartData.reduce((sum, d) => sum + d.energy, 0);
    const avg = total / chartData.length;
    return [
      {label: t('widget.chargeHistory.total', 'Total'), value: fmt(total, 1), unit: 'kWh'},
      {label: t('widget.chargeHistory.avg', 'Avg'), value: fmt(avg, 1), unit: 'kWh'},
    ];
  }, [chartData, hasData, t]);

  if (isCompact) {
    return (
      <WidgetShell
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={() => refetch()}
        updatedAt={dataUpdatedAt}>
        <WidgetChartSummary
          chart={null}
          compact
          emptyIcon={<SemanticIcon decorative name="analytics" size="md" />}
          emptyMessage={t('widget.noChargeHistory', 'No charge sessions yet')}
          isEmpty={!hasData}
          stats={stats}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      icon={<SemanticIcon decorative name="analytics" size="sm" />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.chargeHistory.title', 'Charge History')}
      updatedAt={dataUpdatedAt}>
      <WidgetChartSummary
        chart={
          <AreaChartWrapper
            data={chartData}
            height={200}
            series={[{key: 'energy', label: 'kWh', color: '#10b981'}]}
            xKey="i"
            yFormatter={v => `${v} kWh`}
          />
        }
        emptyIcon={<SemanticIcon decorative name="analytics" size="md" />}
        emptyMessage={t('widget.noChargeHistory', 'No charge sessions yet')}
        isEmpty={!hasData}
        stats={stats}
      />
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  chartArea: {
    flex: 1,
    marginTop: 8,
    minHeight: 0,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
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
  statCell: {
    flex: 1,
    minWidth: 0,
  },
  statLabel: {
    fontSize: 10,
  },
  statRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statUnit: {
    fontSize: 10,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  summaryRoot: {
    flex: 1,
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
