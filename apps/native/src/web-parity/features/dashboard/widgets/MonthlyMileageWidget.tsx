// Native parity port of web/src/features/dashboard/widgets/MonthlyMileageWidget.tsx.
//
// Dashboard widget that reads a vehicle's last-12-months mileage buckets
// (useMonthlyMileage), converts each SI total (total_km * 1000 m) to the user's
// display distance unit, and renders a stat header (This Month + 12-Mo Total)
// plus a per-month bar chart inside a widget shell. The compact (1-col) size
// drops the chart and shows only the two stats. The web file pulls in browser-
// only or web-UI dependencies that are absent from the native parity manifest
// (contract rules 4, 5 & 7); each is replaced with a React Native-safe
// equivalent and documented here + in the sidecar:
//
//   - react-i18next useTranslation('dashboard') (web L2, L40) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.monthlyMileage.*','<English>') call keeps its English default +
//     translation-key intent (the established ChargeHistory/DriveTelemetry port).
//   - lucide-react BarChart3 (web L3, L102, L142, L154) -> the shared native
//     SemanticIcon 'analytics' (its bar-chart/analytics glyph). lucide SVG has no
//     native renderer. The title icon's text-neon-cyan tint collapses to the
//     SemanticIcon analytics intrinsic tone (per-name fixed tone; no override) —
//     the same color-tint -> semantic-icon collapse used by the ChargeHistory
//     (neon-green->analytics) port; the chart/mileage intent is preserved.
//   - `@/components/charts` BarChart/Bar/XAxis/YAxis/Tooltip/ResponsiveContainer/
//     Cell + chartGrid/chartMargin/axisTick/axisTickSm/chartAnimation/fmt (web
//     L4-7) -> the ported native charts barrel (../../../components/charts). React
//     Native has no Recharts/SVG backend, so the chart primitives render the
//     barrel's documented native-unavailable placeholder (the same approach the
//     DriveTelemetry port uses for its ComposedChart); the chart structure,
//     axis/tick/margin/animation config and fmt formatter are preserved verbatim.
//   - `@/api/hooks/useAnalytics` useMonthlyMileage (web L8) -> the ported native
//     useMonthlyMileage hook (same '/mileage/monthly?vehicle_id=' query, same
//     select -> MonthlyMileageBucket[] with year_month + total_km).
//   - `@/api/hooks/useVehicles` useVehicles (web L9) -> the ported native
//     useVehicles hook (same '/vehicles' query, same UseQueryResult fields).
//   - `@/hooks/useUnits` useUnits (web L10, L43, L46) -> an inlined useUnits()
//     bridge over the ported useFormatPrefs() that exposes the same
//     { unitPrefs: { distance } } shape so the unitPrefs.distance call sites are
//     preserved (the DriveTelemetry port precedent).
//   - `@/lib/numberFormat` fmtNumber + fmtInt (web L11, L106, L111, L126, L131,
//     L181) -> ported inline (locale-aware fixed-precision toLocaleString), the
//     same native fmtNumber/fmtInt the DriveTelemetry port inlines.
//   - `./shared` WidgetChartSummary + type ChartSummaryStat (web L12) -> inlined
//     native WidgetChartSummary: the stat row + optional chart + empty-state
//     contract reproduced with RN primitives (web's @container @sm flex
//     relaxation collapses to a plain 2-col row — RN has no container queries).
//   - `./WidgetShell` WidgetShell (web L13) -> inlined native WidgetShell (same
//     skeleton/error/header/overlay-freshness/pulse subset already ported by the
//     ChargeHistory/DriveTelemetry widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./types` WidgetProps (web L14) -> inlined native WidgetSize/WidgetProps
//     (the vehicleId/size subset this widget reads).
//   - `@/lib/unitConversion` convertDistanceFromSI (web L15, L44) -> imported from
//     the ported native format _formatPrimitives (meters -> km|mi), the same
//     native-safe SI display-boundary converter used by the RecentActivity port.
//     SI stays on the wire; conversion happens only at render.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives, the shared native SemanticIcon / AppText / theme tokens, and the
// ported parity chart primitives / useMonthlyMileage / useVehicles /
// useFormatPrefs / convertDistanceFromSI / DataFreshness / QueryError.

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
import {useMonthlyMileage} from '../../../api/hooks/useAnalytics';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {
  axisTick,
  axisTickSm,
  Bar,
  BarChart,
  Cell,
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

// ── @/lib/numberFormat fmtNumber + fmtInt (ported inline) ──
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

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
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

// ── Local bar datum (ported verbatim from web L17-21) ──
interface BarDatum {
  month: string;
  distance: number;
  isCurrent: boolean;
}

/** Format "2026-04" → "Apr" (ported verbatim from web L23-30). */
function shortMonth(iso: string): string {
  const parts = iso.split('-');
  if (parts.length < 2) {
    return iso;
  }
  const idx = parseInt(parts[1], 10) - 1;
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return names[idx] ?? iso;
}

function currentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
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
  chart,
  compact,
  emptyIcon,
  emptyMessage,
  isEmpty,
  stats,
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

export default function MonthlyMileageWidget({size, vehicleId}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {unitPrefs} = useUnits();
  // useCallback keeps the converter stable across renders so the chartData
  // useMemo dependency list satisfies react-hooks/exhaustive-deps (the web file
  // recreated this inline each render; native lint is stricter).
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useMonthlyMileage(vid > 0 ? String(vid) : '');

  const curMonth = currentMonthKey();

  const chartData = useMemo<BarDatum[]>(() => {
    const items = data ?? [];
    return items.slice(-12).map(m => ({
      // Backend `/mileage/monthly` returns `year_month` ('YYYY-MM') and
      // `total_km`. SI-canonical convertDistanceFromSI expects meters.
      month: shortMonth(m.year_month ?? ''),
      distance: toDistanceDisplay((m.total_km ?? 0) * 1000),
      isCurrent: (m.year_month ?? '') === curMonth,
    }));
  }, [data, toDistanceDisplay, curMonth]);

  const totalDistance = useMemo(
    () => chartData.reduce((sum, d) => sum + d.distance, 0),
    [chartData],
  );

  const currentMonthDistance = useMemo(() => {
    const cur = chartData.find(d => d.isCurrent);
    return cur?.distance ?? 0;
  }, [chartData]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0 && chartData.some(d => d.distance > 0);

  // ── Compact (1-col): summary stats only ──
  if (isCompact) {
    return (
      <WidgetShell
        error={error ? String(error) : null}
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
          emptyMessage={t('widget.monthlyMileage.noData', 'No mileage data')}
          isEmpty={!hasData}
          stats={
            hasData
              ? [
                  {
                    label: t('widget.monthlyMileage.thisMonth', 'This Month'),
                    value: fmtInt(currentMonthDistance),
                    unit: distanceUnit,
                  },
                  {
                    label: t('widget.monthlyMileage.total12m', '12-Mo Total'),
                    value: fmtInt(totalDistance),
                    unit: distanceUnit,
                  },
                ]
              : []
          }
        />
      </WidgetShell>
    );
  }

  // ── Standard (2×4+): stat header + bar chart ──
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.monthlyMileage.thisMonth', 'This Month'),
          value: fmtInt(currentMonthDistance),
          unit: distanceUnit,
        },
        {
          label: t('widget.monthlyMileage.total12m', '12-Mo Total'),
          value: fmtInt(totalDistance),
          unit: distanceUnit,
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<SemanticIcon decorative name="analytics" size="sm" />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.monthlyMileage.title', 'Monthly Mileage')}
      updatedAt={dataUpdatedAt}>
      <WidgetChartSummary
        chart={
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={chartData} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis
                axisLine={false}
                dataKey="month"
                tick={tick}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tick={tick}
                tickFormatter={(v: number) => fmt(v, 0)}
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
                formatter={(value: number) => [
                  `${fmtNumber(value, 1)} ${distanceUnit}`,
                  t('widget.monthlyMileage.distance', 'Distance'),
                ]}
              />
              <Bar
                dataKey="distance"
                maxBarSize={32}
                name={t('widget.monthlyMileage.distance', 'Distance')}
                radius={[4, 4, 0, 0]}>
                {chartData.map((entry, idx) => (
                  <Cell
                    key={`bar-${idx}`}
                    fill={
                      entry.isCurrent ? '#22d3ee' : 'rgba(255,255,255,0.1)'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        }
        emptyIcon={<SemanticIcon decorative name="analytics" size="md" />}
        emptyMessage={t('widget.monthlyMileage.noData', 'No mileage data')}
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
