// Native parity port of
// web/src/features/dashboard/widgets/CostForecastWidget.tsx.
//
// The web widget is a dashboard "Cost Forecast" tile. It resolves the active
// vehicle (vehicleId prop, else the first vehicle, else null), fetches a
// charging cost forecast via useCostForecast(vid) (CostForecastData with
// historical + forecast month arrays), and derives:
//   - chartData = buildChartData(historical, forecast): a BarDatum[] of the last
//     6 months ({ month, cost, isForecast }), historical first then forecast.
//   - nextForecast / nextCost: the first forecast month's cost (?? 0).
//   - lastHistorical / lastCost: the final historical month's cost (?? 0).
//   - trendUp: nextCost >= lastCost.
// It renders one of two layouts inside a <WidgetShell>:
//   1. Compact (size.cols <= 1): a title-less shell wrapping a compact
//      <WidgetChartSummary> (chart hidden) with two stats — "Next Month"
//      (formatCurrency(nextCost, 0)) and "Trend" (↑/↓) — or a TrendingUp
//      EmptyState ("No forecast data") when there is no data.
//   2. Standard (size.cols >= 2): a titled shell ("Cost Forecast" + a trend
//      icon — amber TrendingUp when trendUp, else emerald TrendingDown) wrapping
//      a <WidgetChartSummary> whose stats are "Next Month", "Avg $/kWh"
//      (formatCurrency(lastHistorical.cost_per_kwh ?? 0, 2) or em-dash) and
//      "Trend" (↑/↓ with the signed delta), over a cost bar chart. A TrendingUp
//      EmptyState replaces the body when there is no data. Combined query
//      freshness (loading / fetching / stale / error / dataUpdatedAt) and a
//      manual refresh feed the shell header.
//
// This native port preserves that contract 1:1 — the same vid/useCostForecast
// resolution, the same buildChartData (last-6 slice, historical-then-forecast,
// month ?? em-dash, cost ?? 0, isForecast flag), the same nextCost/lastCost/
// trendUp derivations, the same isCompact/isWide/hasData branches, the same
// i18n keys + English defaults, and the same visual intent — using React Native
// primitives, the existing native AppText + design tokens, and the already-
// ported native useCostForecast / useVehicles / useSettings hooks.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?) =
//     (fallback ?? key), preserving every key + English default. None of this
//     widget's t() calls use interpolation.
//   - lucide-react TrendingUp / TrendingDown (web L3): DOM SVG icons -> emoji/
//     glyph stand-ins (📈 / 📉), tinted via the amber (trendUp) / emerald (down)
//     title intent and the muted EmptyState glyph.
//   - @/components/charts BarChart/Bar/XAxis/YAxis/Tooltip/ResponsiveContainer +
//     chartGrid/chartMargin/axisTick/axisTickSm/chartAnimation/fmt (web L4-7):
//     Recharts depends on browser DOM/SVG layout and is unavailable in React
//     Native, so the bar chart is reproduced as a native <CostForecastBarChart>
//     (a currency-axis + per-month bar approximation built from Views). The web
//     `fmt` helper (fmtNumber, 1dp default) is inlined; the `axisTick` /
//     `axisTickSm` font sizes (11 vs 10) drive the native tick sizing; the
//     single Bar fill (#6366f1) and the YAxis `${currencySymbol}${fmt(v,0)}`
//     tick formatter are preserved. The hover-only <Tooltip> has no native
//     analogue and is dropped (an accessibilityLabel summarises the series).
//   - @/api/hooks/useVehicles useVehicles (web L8): the already-ported web-parity
//     useVehicles hook (same data: Vehicle[] shape with `.id`).
//   - @/api/hooks/useCharging useCostForecast (web L9): the already-ported
//     web-parity useCostForecast hook (same /analytics/cost-forecast path,
//     queryKey, enabled, staleTime) returning CostForecastData.
//   - @/hooks/useFormatting useFormatting (web L10): not yet ported -> reproduced
//     here as a scoped native useFormatting() reading the same web-parity
//     useSettings() query (currency_symbol / decimal_precision) and exposing the
//     consumed currencySymbol + formatCurrency(amount, decimals?) with byte-for-
//     byte identical logic.
//   - ./shared WidgetChartSummary + ChartSummaryStat (web L11): reproduced as a
//     native <WidgetChartSummary> (stat grid + chart slot, EmptyState when empty,
//     chart hidden in compact) and the same ChartSummaryStat { label, value,
//     unit? } shape.
//   - ./WidgetShell WidgetShell (web L12): reproduced as a native-safe
//     <WidgetShell> — the loading skeleton, error body, the pulse-on-update
//     effect, and the inline DataFreshness chip (dot-only when title-less).
//   - ./types WidgetProps (web L13): the dashboard widget types module is not yet
//     ported, so the consumed subset (WidgetSize { cols, rows } + WidgetProps) is
//     mirrored as local interfaces.
//   - @/types/charging CostHistoricalMonth / CostForecastMonth (web L14): the
//     identical interfaces re-exported by the native useCharging hook are reused.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View, type DimensionValue} from 'react-native';

import {
  useCostForecast,
  type CostForecastMonth,
  type CostHistoricalMonth,
} from '../../../api/hooks/useCharging';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (web L3)                              */
/* ------------------------------------------------------------------ */

const ICON_TRENDING_UP = '\uD83D\uDCC8'; // 📈 (TrendingUp)
const ICON_TRENDING_DOWN = '\uD83D\uDCC9'; // 📉 (TrendingDown)

// web Bar fill="#6366f1" (indigo-500) — single-series cost bars.
const BAR_COLOR = '#6366f1';

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
/*  ported: ./shared ChartSummaryStat (web shared/WidgetChartSummary)  */
/* ------------------------------------------------------------------ */

export interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

/* ------------------------------------------------------------------ */
/*  native-safe number formatter (web @/lib/numberFormat fmtNumber)    */
/* ------------------------------------------------------------------ */

/** Port of web fmtNumber — locale-aware, min=max fraction digits. */
function fmtNumber(value: unknown, decimals = 2): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

/** Port of the web charts `fmt` helper — like fmtNumber but defaulting to 1dp. */
function fmt(value: unknown, decimals = 1): string {
  return fmtNumber(value, decimals);
}

/* ------------------------------------------------------------------ */
/*  scoped native useFormatting (web @/hooks/useFormatting, consumed)   */
/* ------------------------------------------------------------------ */

interface UseFormattingResult {
  currencySymbol: string;
  formatCurrency: (amount: number, decimals?: number) => string;
}

function useFormatting(): UseFormattingResult {
  const {data: settings} = useSettings();

  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;

  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string => {
      const d = decimals ?? userPrecision;
      return `${currencySymbol}${fmtNumber(amount, d)}`;
    },
    [currencySymbol, userPrecision],
  );

  return useMemo(
    () => ({currencySymbol, formatCurrency}),
    [currencySymbol, formatCurrency],
  );
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  fresh: '\u25CF', // ● Wifi
  fetching: '\u21BB', // ↻ RefreshCw
  stale: '\u25CF', // ● Wifi
  error: '\u2715', // ✕ WifiOff
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
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

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
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
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
/*  ported BarDatum + buildChartData (web L16-37)                      */
/* ------------------------------------------------------------------ */

interface BarDatum {
  month: string;
  cost: number;
  isForecast: boolean;
}

function buildChartData(
  historical: CostHistoricalMonth[],
  forecast: CostForecastMonth[],
): BarDatum[] {
  const hist: BarDatum[] = historical.map(h => ({
    month: h.month ?? '\u2014',
    cost: h.cost ?? 0,
    isForecast: false,
  }));
  const fore: BarDatum[] = forecast.map(f => ({
    month: f.month ?? '\u2014',
    cost: f.cost ?? 0,
    isForecast: true,
  }));
  return [...hist, ...fore].slice(-6);
}

/* ------------------------------------------------------------------ */
/*  native CostForecastBarChart (web Recharts BarChart, L145-179)      */
/* ------------------------------------------------------------------ */

const CHART_GRID_PERCENTS = [0, 50, 100] as const;

interface CostForecastBarChartProps {
  data: BarDatum[];
  tickFontSize: number;
  height: number;
  currencySymbol: string;
}

function CostForecastBarChart({
  data,
  tickFontSize,
  height,
  currencySymbol,
}: CostForecastBarChartProps) {
  // web YAxis auto-domains [0, max]; scale the bars to the largest cost.
  const costValues = data
    .map(d => d.cost)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const maxCost = costValues.length > 0 ? Math.max(...costValues) : 0;
  const domainMax = Math.max(maxCost, 1);

  const tickStyle = [styles.chartTick, {fontSize: tickFontSize}];
  const lastCost = data[data.length - 1]?.cost ?? 0;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Cost forecast over ${data.length} months; latest ${currencySymbol}${fmt(
        lastCost,
        0,
      )}`}
      style={styles.chartRoot}>
      <View style={[styles.chartBody, {height}]}>
        {/* web YAxis tickFormatter: `${currencySymbol}${fmt(v, 0)}`. */}
        <View style={styles.chartAxisLeft}>
          <AppText numberOfLines={1} style={tickStyle}>
            {`${currencySymbol}${fmt(domainMax, 0)}`}
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            {`${currencySymbol}${fmt(domainMax / 2, 0)}`}
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            {`${currencySymbol}${fmt(0, 0)}`}
          </AppText>
        </View>

        <View style={styles.chartPlot}>
          {CHART_GRID_PERCENTS.map(percent => (
            <View
              key={`grid-${percent}`}
              pointerEvents="none"
              style={[styles.chartGridLine, {top: `${percent}%` as DimensionValue}]}
            />
          ))}

          <View style={styles.chartColumns}>
            {data.map((d, index) => {
              const pct =
                d.cost > 0 ? Math.max((d.cost / domainMax) * 100, 3) : 0;
              return (
                <View key={`${index}-${d.month}`} style={styles.chartColumn}>
                  {d.cost > 0 ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.barFill,
                        {height: `${pct}%` as DimensionValue},
                      ]}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* web XAxis dataKey="month" — a label under every bar. */}
      <View style={styles.chartXAxis}>
        <View style={styles.chartAxisSpacer} />
        <View style={styles.chartXLabels}>
          {data.map((d, index) => (
            <AppText
              key={`label-${index}-${d.month}`}
              numberOfLines={1}
              style={[styles.chartXLabel, {fontSize: tickFontSize}]}>
              {d.month}
            </AppText>
          ))}
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetChartSummary (web ./shared/WidgetChartSummary)        */
/* ------------------------------------------------------------------ */

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
  if (isEmpty) {
    return (
      <EmptyState icon={emptyIcon} message={emptyMessage ?? 'No data available'} />
    );
  }

  return (
    <View style={styles.summaryRoot}>
      {stats.length > 0 ? (
        <View style={styles.statGrid}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.statCell}>
              <AppText numberOfLines={1} style={styles.statLabel}>
                {stat.label}
              </AppText>
              <View style={styles.statValueRow}>
                <AppText numberOfLines={1} style={styles.statValue}>
                  {stat.value}
                </AppText>
                {stat.unit ? (
                  <AppText numberOfLines={1} style={styles.statUnit}>
                    {stat.unit}
                  </AppText>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? <View style={styles.chartSlot}>{chart}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  CostForecastWidget (web L39-183)                                   */
/* ------------------------------------------------------------------ */

export default function CostForecastWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? null;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useCostForecast(vid != null ? String(vid) : null);

  const {formatCurrency} = useFormatting();
  const {currencySymbol} = useFormatting();

  const chartData = useMemo(
    () => buildChartData(data?.historical ?? [], data?.forecast ?? []),
    [data],
  );

  const nextForecast = (data?.forecast ?? [])[0];
  const nextCost = nextForecast?.cost ?? 0;

  const hist = data?.historical ?? [];
  const lastHistorical = hist.length > 0 ? hist[hist.length - 1] : undefined;
  const lastCost = lastHistorical?.cost ?? 0;
  const trendUp = nextCost >= lastCost;

  const isCompact = size.cols <= 1;
  const hasData = chartData.length > 0;

  // ── Compact (1×2): big predicted cost + trend ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}>
        <WidgetChartSummary
          compact
          chart={null}
          emptyIcon={<AppText style={styles.emptyGlyph}>{ICON_TRENDING_UP}</AppText>}
          emptyMessage={t('widget.costForecast.noData', 'No forecast data')}
          isEmpty={!hasData}
          stats={
            hasData
              ? [
                  {
                    label: t('widget.costForecast.nextMonth', 'Next Month'),
                    value: formatCurrency(nextCost, 0),
                  },
                  {
                    label: t('widget.costForecast.trend', 'Trend'),
                    value: trendUp ? '\u2191' : '\u2193',
                  },
                ]
              : []
          }
        />
      </WidgetShell>
    );
  }

  // ── Standard (2×4): stat header + bar chart ──
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.costForecast.nextMonth', 'Next Month'),
          value: formatCurrency(nextCost, 0),
        },
        {
          label: t('widget.costForecast.avgPerKwh', 'Avg $/kWh'),
          value: lastHistorical
            ? formatCurrency(lastHistorical.cost_per_kwh ?? 0, 2)
            : '\u2014',
        },
        {
          label: t('widget.costForecast.trend', 'Trend'),
          value: trendUp
            ? `\u2191 ${formatCurrency(nextCost - lastCost, 0)}`
            : `\u2193 ${formatCurrency(lastCost - nextCost, 0)}`,
        },
      ]
    : [];

  const isWide = size.cols >= 3;
  // web: tick = isWide ? axisTick : axisTickSm (fontSize 11 vs 10).
  const tickFontSize = isWide ? 11 : 10;

  return (
    <WidgetShell
      title={t('widget.costForecast.title', 'Cost Forecast')}
      icon={
        <AppText
          style={[
            styles.titleGlyph,
            {color: trendUp ? colors.warning : colors.success},
          ]}>
          {trendUp ? ICON_TRENDING_UP : ICON_TRENDING_DOWN}
        </AppText>
      }
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      <WidgetChartSummary
        chart={
          <CostForecastBarChart
            currencySymbol={currencySymbol}
            data={chartData}
            height={isWide ? 150 : 130}
            tickFontSize={tickFontSize}
          />
        }
        emptyIcon={<AppText style={styles.emptyGlyph}>{ICON_TRENDING_UP}</AppText>}
        emptyMessage={t('widget.costForecast.noData', 'No forecast data')}
        isEmpty={!hasData}
        stats={stats}
      />
    </WidgetShell>
  );
}

CostForecastWidget.displayName = 'CostForecastWidget';

// shadow-[0_0_12px_rgba(34,197,94,0.15)] pulse-on-update glow.
const PULSE_GLOW = '#22c55e';

const styles = StyleSheet.create({
  barFill: {
    alignSelf: 'center',
    backgroundColor: BAR_COLOR,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    maxWidth: 32,
    minHeight: 1,
    width: '100%',
  },
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  chartAxisLeft: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: 40,
  },
  chartAxisSpacer: {
    width: 40,
  },
  chartBody: {
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  chartColumn: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 1,
  },
  chartColumns: {
    alignItems: 'flex-end',
    columnGap: 1,
    flex: 1,
    flexDirection: 'row',
  },
  chartGridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.5,
    position: 'absolute',
    right: 0,
  },
  chartPlot: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  chartRoot: {
    width: '100%',
  },
  chartSlot: {
    marginTop: spacing.sm,
  },
  chartTick: {
    color: colors.textMuted,
  },
  chartXAxis: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  chartXLabel: {
    color: colors.textMuted,
    flex: 1,
    textAlign: 'center',
  },
  chartXLabels: {
    flex: 1,
    flexDirection: 'row',
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
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
  statCell: {
    flexBasis: '45%',
    flexGrow: 1,
    minWidth: 0,
  },
  statGrid: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  statUnit: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '400',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  statValueRow: {
    alignItems: 'baseline',
    columnGap: 2,
    flexDirection: 'row',
  },
  summaryRoot: {
    width: '100%',
  },
  titleGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
});
