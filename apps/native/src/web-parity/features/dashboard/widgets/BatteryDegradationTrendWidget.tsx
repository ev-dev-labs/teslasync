// Native parity port of web/src/features/dashboard/widgets/BatteryDegradationTrendWidget.tsx.
//
// The web widget is the dashboard "Battery Degradation" tile. It resolves a
// vehicle id (`vehicleId` prop, else the first vehicle from `useVehicles()`),
// reads battery-degradation analytics from `useBatteryDegradation(idStr)`
// (GET /api/v1/analytics/battery-degradation?vehicle_id=… — preserved verbatim
// by the already-ported native useEnergy hook) and renders, inside a
// `WidgetShell`, a `WidgetChartSummary`: a compact stat row (SoH, optional
// Degradation /mo, Cycles) plus — when the tile is not 1×1 compact — an area
// chart of monthly State-of-Health (%) with a red 80% end-of-life reference
// line.
//
// Every state name (`vehicles`, `id`, `idStr`, `data`, `isLoading`,
// `isFetching`, `isStale`, `isError`, `dataUpdatedAt`, `refetch`,
// `chartData`, `isCompact`, `currentHealth`, `degradationRate`, `totalCycles`,
// `stats`, `chart`), the `id = vehicleId ?? vehicles?.[0]?.id ?? null`
// resolution, the `idStr` String() coercion, the `data?.x ?? data?.y ?? null`
// null-safe derivations, the `current_health_pct ?? current_health` fallback,
// the `size.cols <= 1 && size.rows <= 1` compact threshold, the two `useMemo`s
// with their exact dependency arrays, the `degradationRate > 0` guard, the
// `widget.*` i18n keys with their English fallbacks, the U+2212 minus sign on
// the degradation value, the U+2014 em-dash placeholders, the `['dataMin - 2',
// 100]` y-domain, the y=80 reference line, and the "More data needed for trend"
// / "No degradation data" copy are preserved. Browser-only pieces are mapped to
// native-safe equivalents (documented in the parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as the APIUsageWidget /
//     AddWidgetButton / LayoutManager ports), so every key + copy is preserved.
//   - lucide-react `TrendingDown` has no native icon dependency; per the
//     APIUsageWidget / Spinner glyph precedent it becomes a decorative Unicode
//     down-trend glyph (↘ U+2198) in an `AppText` with
//     `importantForAccessibility="no"` (the shell title / empty message carries
//     the accessible meaning). `h-3.5 w-3.5` (14px) -> fontSize 14 in the title
//     accent (web `text-neon-amber` -> the warning token so the amber tint
//     actually applies); `h-5 w-5` (20px) -> fontSize 20 muted in the empty
//     state.
//   - The entire recharts area chart (`ResponsiveContainer`, `AreaChart`,
//     `Area`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`/`ChartTooltip`,
//     `ReferenceLine`, `areaGradient`, `AREA_DEFAULTS`, `axisTickSm`,
//     `chartGrid`, `useThemeChartPalette`) is DOM/SVG-only. It is reimplemented
//     as a native `DegradationTrendChart` of scaled Views: the `Area` health
//     series becomes per-month columns (the established native chart idiom —
//     see components/charts ChartSummary/MiniBarChart), `CartesianGrid` ->
//     horizontal grid lines, `XAxis dataKey="month"` -> centered axis labels,
//     `YAxis domain={['dataMin - 2', 100]}` + `tickFormatter ${v}%` -> a left
//     tick column showing the domain max/min as percentages, and
//     `ReferenceLine y={80} stroke="#ef4444" strokeOpacity={0.4}` -> a
//     positioned red rule + "80%" label (the `strokeDasharray="4 4"` dash is
//     flattened to a solid 1px low-opacity rule — RN has no first-class dashed
//     line without react-native-svg, consistent with the Spinner port). The
//     `<Tooltip>` hover affordance has no native analogue (no pointer) so it is
//     dropped; the plot exposes an accessible summary label instead. The
//     web `useThemeChartPalette().series[1]` series colour maps to the native
//     accent token. The `chartData.length > 1` "need more data" branch lives
//     inside the native chart.
//   - `@/lib/numberFormat` `fmtNumber` is inlined as a native-safe formatter
//     mirroring the web module (locale-aware `toLocaleString`, the out-of-box
//     precision-2 / en-US defaults — same approach as the APIUsageWidget port).
//   - `WidgetShell` (web: a transparent flex container with `Skeleton` loading
//     + `QueryError` error + a `DataFreshness` header affordance) is inlined on
//     a `GlassPanel`: loading -> a centered `Spinner`, error -> centered danger
//     text, otherwise an optional uppercase title row + a compact freshness
//     control (status dot coloured by isError/isStale/isFetching + a refresh
//     Pressable wired to `refetch`) over the children — identical to the
//     APIUsageWidget port.
//   - `WidgetChartSummary` + `ChartSummaryStat` (web shared/WidgetChartSummary)
//     are inlined: the `isEmpty` `EmptyState` branch, the `stats.length > 0`
//     2-col stat grid (label + value + optional unit), and the `!compact`
//     chart slot are reproduced with Views + `AppText`. `@/components/feedback`
//     `EmptyState` -> a small centered View with the glyph icon + muted message.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useBatteryDegradation} from '../../../api/hooks/useEnergy';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {Spinner} from '../../../components/feedback/Spinner';

/* ─── i18n fallback shim ───────────────────────────────────────────────────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── native-safe number formatter (mirror web @/lib/numberFormat) ──────────── */

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

/* ─── decorative glyph (lucide-react TrendingDown stand-in) ─────────────────── */

const ICON_TRENDING_DOWN = '\u2198'; // ↘ down-trend arrow (monochrome so tint applies)
const GLYPH_REFRESH = '\u21BB';
const EM_DASH = '\u2014'; // — placeholder for missing values

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

/* ─── inlined ChartSummaryStat (web shared/WidgetChartSummary) ──────────────── */

interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

interface ChartPoint {
  month: string;
  range: number;
  health: number;
  original: number;
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

/* ─── inlined WidgetEmptyState (web @/components/feedback EmptyState) ────────── */

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

/* ─── inlined degradation area chart (web recharts AreaChart) ───────────────── */

const CHART_GRID_LINES = [25, 50, 75]; // CartesianGrid horizontal lines
const REFERENCE_LINE_Y = 80; // web <ReferenceLine y={80} /> — battery EOL threshold
const REFERENCE_LINE_COLOR = 'rgba(239, 68, 68, 0.4)'; // web stroke #ef4444 @ strokeOpacity 0.4

function clamp01(v: number): number {
  if (v < 0) {
    return 0;
  }
  if (v > 1) {
    return 1;
  }
  return v;
}

function DegradationTrendChart({
  points,
  seriesColor,
  t,
}: {
  points: ChartPoint[];
  seriesColor: string;
  t: NativeTFunction;
}) {
  // web: `chartData.length > 1 ? <AreaChart/> : <p>More data needed…</p>`
  if (points.length <= 1) {
    return (
      <View style={styles.chartFallback}>
        <AppText style={styles.chartFallbackText} tone="muted">
          {t('widget.needMoreData', 'More data needed for trend')}
        </AppText>
      </View>
    );
  }

  const healthValues = points.map(point => point.health);
  const domainMin = Math.min(...healthValues) - 2; // web YAxis domain ['dataMin - 2', 100]
  const domainMax = 100;
  const span = Math.max(domainMax - domainMin, 1);
  const norm = (value: number) => clamp01((value - domainMin) / span);
  const showReference =
    REFERENCE_LINE_Y > domainMin && REFERENCE_LINE_Y < domainMax;
  const referenceBottom = `${norm(REFERENCE_LINE_Y) * 100}%` as DimensionValue;

  const seriesLabel = `${t('widget.healthPct', 'Health %')}: ${points
    .map(point => `${point.month} ${fmtNumber(point.health, 1)}%`)
    .join(', ')}`;

  return (
    <View style={styles.chart}>
      {/* YAxis tickFormatter ${v}% — domain max/min ticks */}
      <View style={styles.chartAxisColumn}>
        <AppText style={styles.chartAxisTick} tone="muted">
          {`${fmtNumber(domainMax, 0)}%`}
        </AppText>
        <AppText style={styles.chartAxisTick} tone="muted">
          {`${fmtNumber(domainMin, 0)}%`}
        </AppText>
      </View>

      <View style={styles.chartBody}>
        <View
          accessibilityLabel={seriesLabel}
          accessibilityRole="image"
          accessible
          style={styles.chartPlotPanel}>
          {/* CartesianGrid */}
          <View pointerEvents="none" style={styles.chartGridLayer}>
            {CHART_GRID_LINES.map(line => (
              <View
                key={`grid-${line}`}
                style={[
                  styles.chartGridLine,
                  {bottom: `${line}%` as DimensionValue},
                ]}
              />
            ))}
          </View>

          {/* ReferenceLine y={80} */}
          {showReference ? (
            <View
              pointerEvents="none"
              style={[styles.chartReferenceLine, {bottom: referenceBottom}]}>
              <AppText
                style={[styles.chartReferenceLabel, {color: REFERENCE_LINE_COLOR}]}>
                {`${REFERENCE_LINE_Y}%`}
              </AppText>
              <View
                style={[
                  styles.chartReferenceRule,
                  {backgroundColor: REFERENCE_LINE_COLOR},
                ]}
              />
            </View>
          ) : null}

          {/* Area dataKey="health" -> scaled columns */}
          <View style={styles.chartColumns}>
            {points.map(point => {
              const height = `${Math.max(
                norm(point.health) * 100,
                4,
              )}%` as DimensionValue;

              return (
                <View key={point.month} style={styles.chartColumn}>
                  <View style={styles.chartColumnTrack}>
                    <View
                      style={[
                        styles.chartColumnFill,
                        {backgroundColor: seriesColor, height},
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* XAxis dataKey="month" */}
        <View style={styles.chartAxisRow}>
          {points.map(point => (
            <AppText
              key={`x-${point.month}`}
              numberOfLines={1}
              style={styles.chartAxisLabel}
              tone="muted">
              {point.month}
            </AppText>
          ))}
        </View>
      </View>
    </View>
  );
}

/* ─── inlined WidgetChartSummary (web shared/WidgetChartSummary.tsx) ─────────── */

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
      <WidgetEmptyState
        icon={emptyIcon}
        message={emptyMessage ?? 'No data available'}
      />
    );
  }

  return (
    <View style={styles.summaryRoot}>
      {stats.length > 0 ? (
        <View style={[styles.statsRow, compact && styles.statsRowCompact]}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.statCell}>
              <AppText numberOfLines={1} style={styles.statLabel} tone="muted">
                {stat.label}
              </AppText>
              <AppText numberOfLines={1} style={styles.statValue}>
                {stat.value}
                {stat.unit ? (
                  <AppText style={styles.statUnit} tone="muted">
                    {stat.unit}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? <View style={styles.chartSlot}>{chart}</View> : null}
    </View>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function BatteryDegradationTrendWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useBatteryDegradation(idStr);

  const chartData = useMemo<ChartPoint[]>(() => {
    const trend = data?.monthly_trend ?? [];
    if (trend.length === 0) {
      return [];
    }
    const originalRange = trend[0].avg_range;
    return trend.map(entry => ({
      month: entry.month,
      range: entry.avg_range,
      health: entry.avg_health,
      original: originalRange,
    }));
  }, [data]);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const currentHealth = data?.current_health_pct ?? data?.current_health ?? null;
  const degradationRate = data?.degradation_rate_pct_per_month ?? null;
  const totalCycles = data?.current_cycles ?? null;

  // Series colour follows the active theme (web useThemeChartPalette().series[1]).
  const seriesColor = colors.accent;

  const stats = useMemo<ChartSummaryStat[]>(() => {
    const items: ChartSummaryStat[] = [];
    items.push({
      label: t('widget.soh', 'SoH'),
      value: currentHealth != null ? `${fmtNumber(currentHealth, 1)}%` : EM_DASH,
    });
    if (degradationRate != null && degradationRate > 0) {
      items.push({
        label: t('widget.degradation', 'Degradation'),
        value: `\u2212${fmtNumber(degradationRate, 2)}%`,
        unit: `/${t('widget.mo', 'mo')}`,
      });
    }
    items.push({
      label: t('widget.cycles', 'Cycles'),
      value: totalCycles != null ? fmtNumber(totalCycles, 0) : EM_DASH,
    });
    return items;
  }, [currentHealth, degradationRate, totalCycles, t]);

  const chart = (
    <DegradationTrendChart points={chartData} seriesColor={seriesColor} t={t} />
  );

  return (
    <WidgetShell
      icon={
        isCompact ? undefined : (
          <AppText importantForAccessibility="no" style={styles.titleIcon}>
            {ICON_TRENDING_DOWN}
          </AppText>
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => {
        void refetch();
      }}
      title={
        isCompact ? undefined : t('widget.batteryDegradation', 'Battery Degradation')
      }
      updatedAt={dataUpdatedAt}>
      <WidgetChartSummary
        chart={chart}
        compact={isCompact}
        emptyIcon={
          <AppText importantForAccessibility="no" style={styles.emptyIconGlyph}>
            {ICON_TRENDING_DOWN}
          </AppText>
        }
        emptyMessage={t('widget.noDegradation', 'No degradation data')}
        isEmpty={currentHealth == null && chartData.length === 0}
        stats={stats}
      />
    </WidgetShell>
  );
}

BatteryDegradationTrendWidget.displayName = 'BatteryDegradationTrendWidget';

const styles = StyleSheet.create({
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  chart: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 132,
  },
  chartAxisColumn: {
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  chartAxisLabel: {
    flex: 1,
    fontSize: 9,
    textAlign: 'center',
  },
  chartAxisRow: {
    flexDirection: 'row',
    gap: 4,
  },
  chartAxisTick: {
    fontSize: 9,
  },
  chartBody: {
    flex: 1,
    gap: spacing.xs,
  },
  chartColumn: {
    flex: 1,
  },
  chartColumnFill: {
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    opacity: 0.85,
    width: '100%',
  },
  chartColumnTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 6,
    flex: 1,
    justifyContent: 'flex-end',
    marginHorizontal: 1,
    overflow: 'hidden',
  },
  chartColumns: {
    alignItems: 'flex-end',
    flex: 1,
    flexDirection: 'row',
  },
  chartFallback: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 96,
  },
  chartFallbackText: {
    fontSize: 12,
    textAlign: 'center',
  },
  chartGridLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  chartGridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: spacing.xs,
    position: 'absolute',
    right: spacing.xs,
  },
  chartPlotPanel: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flex: 1,
    minHeight: 96,
    overflow: 'hidden',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
    position: 'relative',
  },
  chartReferenceLabel: {
    alignSelf: 'flex-end',
    fontSize: 9,
    marginBottom: 1,
  },
  chartReferenceLine: {
    left: spacing.xs,
    position: 'absolute',
    right: spacing.xs,
  },
  chartReferenceRule: {
    height: 1,
  },
  chartSlot: {
    flex: 1,
    marginTop: spacing.sm,
    minHeight: 0,
  },
  emptyIconGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 14,
    maxWidth: 320,
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
  statCell: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 72,
  },
  statLabel: {
    fontSize: 10,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statsRowCompact: {
    gap: spacing.xs,
  },
  statUnit: {
    fontSize: 10,
    fontWeight: '400',
    marginLeft: 2,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  summaryRoot: {
    flex: 1,
    gap: spacing.xs,
  },
  titleIcon: {
    color: colors.warning,
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
