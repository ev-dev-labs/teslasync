// Native parity port of web/src/features/dashboard/widgets/PowerFlowHistoryWidget.tsx.
//
// Dashboard widget that fetches the first linked Tesla Energy site, pulls its
// last-24h live-status history, derives a per-sample {solar, battery, grid,
// home} kW series (W -> kW at the display boundary) and renders a stat header
// (Avg Solar + Peak Home [+ Net Grid when wide]) plus a stacked area chart
// inside a widget shell. The compact (1-col) size drops the chart and shows
// only the two stats; a dedicated branch handles "no energy site linked". The
// web file pulls in browser-only or web-UI dependencies that are absent from
// the native parity manifest (contract rules 4, 5 & 7); each is replaced with a
// React Native-safe equivalent and documented here + in the sidecar:
//
//   - react-i18next useTranslation('dashboard') (web L2, L29) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.powerFlowHistory.*','<English>') call keeps its English default
//     + translation-key intent (the established ChargeHistory/MonthlyMileage
//     port pattern).
//   - lucide-react TrendingUp (web L3, L123, L147, L193, L205) -> the shared
//     native SemanticIcon 'trendUp' (its trending-up glyph). lucide SVG has no
//     native renderer. The title icon's text-cyan-400 tint collapses to the
//     SemanticIcon trendUp intrinsic tone (per-name fixed tone; no override) —
//     the same color-tint -> semantic-icon collapse used by the ChargeHistory
//     (neon-green->analytics) and MonthlyMileage (neon-cyan->analytics) ports;
//     the trend/power-flow intent is preserved. Title icon -> size='sm' (web
//     h-3.5≈sm); empty-state icons -> size='md' (web h-5 w-5≈md).
//   - `@/components/charts` AreaChart/Area/XAxis/YAxis/Tooltip/ResponsiveContainer
//     + chartGrid/chartMargin/axisTick/axisTickSm/chartAnimation/fmt (web L4-7)
//     -> the ported native charts barrel (../../../components/charts). React
//     Native has no Recharts/SVG backend, so the chart primitives render the
//     barrel's documented native-unavailable placeholder (the same approach the
//     MonthlyMileage/DriveTelemetry ports use); the chart structure, axis/tick/
//     margin/animation config, tooltip formatter and fmt formatter are preserved
//     verbatim. The web SVG <defs>/<linearGradient>/<stop> area-fill gradients
//     (web L237-254) are intrinsic SVG elements with no native equivalent, so
//     they are replaced 1:1 by the barrel's areaGradient(id, color, opacity)
//     native-safe placeholder (same DriveTelemetry precedent); the four gradient
//     ids/colors/top-opacity are retained and the Area fill='url(#<id>)'
//     references kept intact.
//   - `@/api/hooks/useEnergy` useTeslaEnergyLiveStatusHistory + useTeslaEnergySites
//     (web L8) -> the ported native useEnergy hooks (same '/tesla/energy-sites'
//     and '/tesla/energy-sites/{id}/live-status/history?since=' queries, same
//     UseQueryResult fields, same TeslaEnergySite/TeslaEnergyLiveStatus shapes).
//   - `@/lib/numberFormat` fmtNumber (web L9) -> ported inline (locale-aware
//     fixed-precision toLocaleString with a safeNumber guard), the same native
//     fmtNumber the MonthlyMileage/DriveTelemetry ports inline.
//   - `./shared` WidgetChartSummary + type ChartSummaryStat (web L10) -> inlined
//     native WidgetChartSummary: the stat row + optional chart + empty-state
//     contract reproduced with RN primitives (web's @container @sm flex
//     relaxation collapses to a plain 2-col row — RN has no container queries).
//   - `./WidgetShell` WidgetShell (web L11) -> inlined native WidgetShell (same
//     skeleton/error/header/overlay-freshness/pulse subset already ported by the
//     ChargeHistory/MonthlyMileage widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./types` WidgetProps (web L12) -> inlined native WidgetSize/WidgetProps
//     (the size subset this widget reads).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives, the shared native SemanticIcon / AppText / theme tokens, and the
// ported parity chart primitives / useEnergy hooks / DataFreshness / QueryError.

import React, {
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
import {
  useTeslaEnergyLiveStatusHistory,
  useTeslaEnergySites,
} from '../../../api/hooks/useEnergy';
import {
  Area,
  AreaChart,
  areaGradient,
  axisTick,
  axisTickSm,
  chartAnimation,
  chartGrid,
  chartMargin,
  fmt,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '../../../components/charts';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {QueryError} from '../../../components/feedback/QueryError';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/numberFormat fmtNumber (ported inline) ──
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

// ── Web ChartDatum + shortTime helper (ported verbatim) ──
interface ChartDatum {
  time: string;
  solar: number;
  battery: number;
  grid: number;
  home: number;
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  // Number.isNaN (vs the web's global isNaN) — identical for the numeric
  // getTime() result, lint-safe in the native codebase.
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
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

export default function PowerFlowHistoryWidget({size}: WidgetProps) {
  const t = useNativeTranslation();

  const {
    data: sites,
    isLoading: sitesLoading,
    error: sitesError,
    isFetching: sitesFetching,
    isStale: sitesStale,
    isError: sitesIsError,
    dataUpdatedAt: sitesUpdatedAt,
    refetch: refetchSites,
  } = useTeslaEnergySites();

  const siteId = (sites ?? [])[0]?.energy_site_id;

  const since = useMemo(() => {
    const d = new Date();
    d.setHours(d.getHours() - 24);
    return d.toISOString();
  }, []);

  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
    isFetching: historyFetching,
    isStale: historyStale,
    isError: historyIsError,
    dataUpdatedAt: historyUpdatedAt,
    refetch: refetchHistory,
  } = useTeslaEnergyLiveStatusHistory(siteId, since);

  const isLoading = sitesLoading || (!!siteId && historyLoading);
  const error = sitesError ?? historyError;
  const isFetching = sitesFetching || historyFetching;
  const isStale = sitesStale || historyStale;
  const isError = sitesIsError || historyIsError;
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, historyUpdatedAt ?? 0);

  const hasSites = (sites ?? []).length > 0;

  const chartData = useMemo<ChartDatum[]>(() => {
    const items = history ?? [];
    return items.map(entry => ({
      time: shortTime(entry.timestamp ?? ''),
      solar: (entry.solar_power ?? 0) / 1000,
      battery: (entry.battery_power ?? 0) / 1000,
      grid: (entry.grid_power ?? 0) / 1000,
      home: (entry.load_power ?? 0) / 1000,
    }));
  }, [history]);

  const avgSolarKw = useMemo(() => {
    if (chartData.length === 0) return 0;
    return chartData.reduce((s, d) => s + d.solar, 0) / chartData.length;
  }, [chartData]);

  const peakHomeKw = useMemo(
    () => chartData.reduce((mx, d) => Math.max(mx, d.home), 0),
    [chartData],
  );

  const netGridKwh = useMemo(
    () => chartData.reduce((s, d) => s + d.grid, 0),
    [chartData],
  );

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData =
    chartData.length > 0 &&
    chartData.some(
      d => d.solar !== 0 || d.battery !== 0 || d.grid !== 0 || d.home !== 0,
    );

  const handleRefresh = () => {
    void refetchSites();
    if (siteId) {
      void refetchHistory();
    }
  };

  // No energy sites linked
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
        <WidgetChartSummary
          chart={null}
          compact={isCompact}
          emptyIcon={<SemanticIcon decorative name="trendUp" size="md" />}
          emptyMessage={t(
            'widget.powerFlowHistory.noSite',
            'No Tesla Energy site linked',
          )}
          isEmpty
          stats={[]}
        />
      </WidgetShell>
    );
  }

  // Compact (1-col): summary stats only
  if (isCompact) {
    return (
      <WidgetShell
        error={error ? String(error) : null}
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={handleRefresh}
        updatedAt={updatedAt}>
        <WidgetChartSummary
          chart={null}
          compact
          emptyIcon={<SemanticIcon decorative name="trendUp" size="md" />}
          emptyMessage={t('widget.powerFlowHistory.noData', 'No power flow data')}
          isEmpty={!hasData}
          stats={
            hasData
              ? [
                  {
                    label: t('widget.powerFlowHistory.avgSolar', 'Avg Solar'),
                    value: fmtNumber(avgSolarKw, 1),
                    unit: 'kW',
                  },
                  {
                    label: t('widget.powerFlowHistory.peakHome', 'Peak Home'),
                    value: fmtNumber(peakHomeKw, 1),
                    unit: 'kW',
                  },
                ]
              : []
          }
        />
      </WidgetShell>
    );
  }

  // Standard (2×4+): stat header + stacked area chart
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.powerFlowHistory.avgSolar', 'Avg Solar'),
          value: fmtNumber(avgSolarKw, 1),
          unit: 'kW',
        },
        {
          label: t('widget.powerFlowHistory.peakHome', 'Peak Home'),
          value: fmtNumber(peakHomeKw, 1),
          unit: 'kW',
        },
        {
          label: t('widget.powerFlowHistory.netGrid', 'Net Grid'),
          value: fmtNumber(netGridKwh, 1),
          unit: 'kW',
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;
  const widgetId = 'pfh';

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<SemanticIcon decorative name="trendUp" size="sm" />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={handleRefresh}
      title={t('widget.powerFlowHistory.title', 'Power Flow History')}
      updatedAt={updatedAt}>
      <WidgetChartSummary
        chart={
          <ResponsiveContainer height="100%" width="100%">
            <AreaChart data={chartData} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis
                axisLine={false}
                dataKey="time"
                tick={tick}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tick={tick}
                tickFormatter={(v: number) => fmt(v, 1)}
                tickLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(0,0,0,0.85)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                cursor={{fill: 'rgba(255,255,255,0.04)'}}
                formatter={(value: number, name: string) => [
                  `${fmtNumber(value, 2)} kW`,
                  name,
                ]}
              />
              {areaGradient(`${widgetId}-solarGrad`, '#facc15', 0.4)}
              {areaGradient(`${widgetId}-batteryGrad`, '#22c55e', 0.4)}
              {areaGradient(`${widgetId}-gridGrad`, '#3b82f6', 0.4)}
              {areaGradient(`${widgetId}-homeGrad`, '#9ca3af', 0.4)}
              <Area
                dataKey="solar"
                fill={`url(#${widgetId}-solarGrad)`}
                name={t('widget.powerFlowHistory.solar', 'Solar')}
                stackId="1"
                stroke="#facc15"
                strokeWidth={2}
                type="monotone"
              />
              <Area
                dataKey="battery"
                fill={`url(#${widgetId}-batteryGrad)`}
                name={t('widget.powerFlowHistory.battery', 'Battery')}
                stackId="1"
                stroke="#22c55e"
                strokeWidth={2}
                type="monotone"
              />
              <Area
                dataKey="grid"
                fill={`url(#${widgetId}-gridGrad)`}
                name={t('widget.powerFlowHistory.grid', 'Grid')}
                stackId="1"
                stroke="#3b82f6"
                strokeWidth={2}
                type="monotone"
              />
              <Area
                dataKey="home"
                fill={`url(#${widgetId}-homeGrad)`}
                name={t('widget.powerFlowHistory.home', 'Home')}
                stackId="1"
                stroke="#9ca3af"
                strokeWidth={2}
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        }
        emptyIcon={<SemanticIcon decorative name="trendUp" size="md" />}
        emptyMessage={t('widget.powerFlowHistory.noData', 'No power flow data')}
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
