// Native parity port of
// web/src/features/dashboard/widgets/WallConnectorWidget.tsx.
//
// The web widget is a dashboard "Wall Connector" tile. It discovers the user's
// Tesla Energy sites (useTeslaEnergySites), takes the first site's
// energy_site_id, and fetches the last 14 days of Wall Connector charging
// history (useTeslaWCChargingHistory(siteId, since)). It aggregates the
// individual entries into per-day kWh buckets (energy_wh / 1000) for a bar
// chart and computes current-month stats (total kWh, session count, avg
// kWh/session). It then renders one of three layouts inside a <WidgetShell>:
//   1. No Energy site linked (!hasSites && !isLoading): a Plug EmptyState
//      ("No Tesla Energy site linked"), freshness fed only by the sites query.
//   2. Compact (size.cols ≤ 1): a stats-only WidgetChartSummary showing
//      "This Month" kWh + "Sessions", or a Plug EmptyState when there is no
//      Wall Connector data.
//   3. Standard (2×4+): a titled shell ("Wall Connector" + neon-green Plug)
//      with a 3-up stat row (This Month kWh / Sessions / Avg-per-Session kWh)
//      above a daily-energy bar chart, or a Plug EmptyState when empty.
// Combined query freshness (loading / fetching / stale / error / dataUpdatedAt)
// and a manual refresh (refetchSites + refetchHistory) feed the shell header.
//
// This native port preserves that contract 1:1 — the same useTeslaEnergySites
// / useTeslaWCChargingHistory hooks (same paths, same query keys), the same
// siteId / since (now − 14 days, ISO yyyy-mm-dd) derivations, the same
// shortDate (M/D) + isSameMonth helpers, the same chartData daily-kWh
// aggregation and monthTotalKwh / monthSessions / avgKwhPerSession math, the
// same isLoading / error / isFetching / isStale / isError / updatedAt
// combination, the same hasSites / isCompact / isWide / hasData branches, the
// same handleRefresh, the same i18n keys + English defaults, and the same
// visual intent — using React Native primitives, the existing native AppText +
// design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime → inline useNativeTranslation() returns t(key, fallback?) =
//     (fallback ?? key), preserving every key + English default.
//   - lucide-react Plug (web L3): DOM SVG icon → 🔌 glyph stand-in, tinted
//     neon-green (colors.success) for the title and muted for the EmptyState.
//   - @/components/charts (Recharts BarChart/Bar/XAxis/YAxis/Tooltip/
//     ResponsiveContainer + chartGrid/chartMargin/axisTick/axisTickSm/
//     chartAnimation/fmt) (web L4-7): reproduced as a native-safe
//     <WallConnectorBarChart> built from React Native Views (no DOM/SVG); the
//     hover-only Tooltip is dropped and replaced by an accessibilityLabel
//     summary; chartMargin/chartAnimation are Recharts-only presentation; the
//     `fmt` helper (1dp default) is inlined.
//   - @/api/hooks/useEnergy useTeslaWCChargingHistory / useTeslaEnergySites
//     (web L8): the already-ported web-parity hooks (same paths/keys/shapes).
//   - @/lib/numberFormat fmtNumber / fmtInt (web L9): inlined native fmtNumber
//     (en-US locale, min=max fraction digits) + fmtInt = fmtNumber(v, 0).
//   - ./shared WidgetChartSummary + ChartSummaryStat (web L10): native
//     equivalents (stat grid + chart slot + EmptyState).
//   - ./WidgetShell (web L11): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the 1500ms pulse-on-update glow, and the
//     inline DataFreshness chip (dot-only `compact` when title-less).
//   - ./types WidgetProps (web L12): the dashboard widget types module is not
//     yet ported, so the consumed subset (WidgetSize { cols, rows } +
//     WidgetProps) is mirrored as local interfaces.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View, type DimensionValue} from 'react-native';

import {
  useTeslaEnergySites,
  useTeslaWCChargingHistory,
} from '../../../api/hooks/useEnergy';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-in (web L3)                               */
/* ------------------------------------------------------------------ */

const ICON_PLUG = '\uD83D\uDD0C'; // 🔌 (Plug)

// web Bar fill="#10b981" (emerald-500) — single-series daily-energy bars.
const BAR_COLOR = '#10b981';

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
/*  ported: ChartDatum (web L14-17)                                    */
/* ------------------------------------------------------------------ */

interface ChartDatum {
  date: string;
  energy_kwh: number;
}

/* ------------------------------------------------------------------ */
/*  native-safe number formatters (web @/lib/numberFormat)             */
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

/** Port of web fmtInt — fmtNumber(v, 0). */
function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

/** Port of the web charts `fmt` helper — like fmtNumber but defaulting to 1dp. */
function fmt(value: unknown, decimals = 1): string {
  return fmtNumber(value, decimals);
}

/* ------------------------------------------------------------------ */
/*  ported helpers (web L19-29)                                        */
/* ------------------------------------------------------------------ */

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function isSameMonth(iso: string): boolean {
  const now = new Date();
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
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
  // Pulse on data change.
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
  // Compact (dot-only) when widget has no title.
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
/*  native WallConnectorBarChart (web Recharts BarChart, L208-244)     */
/* ------------------------------------------------------------------ */

const CHART_GRID_PERCENTS = [0, 50, 100] as const;

interface WallConnectorBarChartProps {
  data: ChartDatum[];
  tickFontSize: number;
  height: number;
}

function WallConnectorBarChart({
  data,
  tickFontSize,
  height,
}: WallConnectorBarChartProps) {
  // web YAxis auto-domains [0, max]; scale the bars to the largest day.
  const energyValues = data
    .map(d => d.energy_kwh)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const maxEnergy = energyValues.length > 0 ? Math.max(...energyValues) : 0;
  const domainMax = Math.max(maxEnergy, 1);

  const tickStyle = [styles.chartTick, {fontSize: tickFontSize}];
  const lastEnergy = data[data.length - 1]?.energy_kwh ?? 0;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Wall Connector energy over ${data.length} days; latest ${fmt(
        lastEnergy,
        1,
      )} kWh`}
      style={styles.chartRoot}>
      <View style={[styles.chartBody, {height}]}>
        {/* web YAxis tickFormatter: fmt(v, 0). */}
        <View style={styles.chartAxisLeft}>
          <AppText numberOfLines={1} style={tickStyle}>
            {fmt(domainMax, 0)}
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            {fmt(domainMax / 2, 0)}
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            {fmt(0, 0)}
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
                d.energy_kwh > 0
                  ? Math.max((d.energy_kwh / domainMax) * 100, 3)
                  : 0;
              return (
                <View key={`${index}-${d.date}`} style={styles.chartColumn}>
                  {d.energy_kwh > 0 ? (
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

      {/* web XAxis dataKey="date" — a label under every bar. */}
      <View style={styles.chartXAxis}>
        <View style={styles.chartAxisSpacer} />
        <View style={styles.chartXLabels}>
          {data.map((d, index) => (
            <AppText
              key={`label-${index}-${d.date}`}
              numberOfLines={1}
              style={[styles.chartXLabel, {fontSize: tickFontSize}]}>
              {d.date}
            </AppText>
          ))}
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  WallConnectorWidget (web L31-249)                                  */
/* ------------------------------------------------------------------ */

export default function WallConnectorWidget({size}: WidgetProps) {
  const t = useNativeTranslation();

  // Discover energy sites
  const {
    data: sites,
    isLoading: sitesLoading,
    isFetching: sitesFetching,
    isStale: sitesStale,
    isError: sitesIsError,
    dataUpdatedAt: sitesUpdatedAt,
    refetch: refetchSites,
  } = useTeslaEnergySites();

  const siteId = (sites ?? [])[0]?.energy_site_id;

  // Last 14 days
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
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
  } = useTeslaWCChargingHistory(siteId, since);

  const isLoading = sitesLoading || (!!siteId && historyLoading);
  const error = historyError;
  const isFetching = sitesFetching || historyFetching;
  const isStale = sitesStale || historyStale;
  const isError = sitesIsError || historyIsError;
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, historyUpdatedAt ?? 0);

  const hasSites = (sites ?? []).length > 0;

  // Aggregate daily energy (kWh) from individual entries
  const chartData = useMemo<ChartDatum[]>(() => {
    const entries = history ?? [];
    const byDay = new Map<string, number>();
    for (const entry of entries) {
      const day = (entry.timestamp ?? '').slice(0, 10);
      if (!day) {
        continue;
      }
      byDay.set(day, (byDay.get(day) ?? 0) + (entry.energy_wh ?? 0) / 1000);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, kwh]) => ({date: shortDate(day), energy_kwh: kwh}));
  }, [history]);

  // Stats for current month
  const {monthTotalKwh, monthSessions, avgKwhPerSession} = useMemo(() => {
    const entries = history ?? [];
    const monthEntries = entries.filter(e => isSameMonth(e.timestamp ?? ''));
    const total = monthEntries.reduce(
      (sum, e) => sum + (e.energy_wh ?? 0) / 1000,
      0,
    );
    const count = monthEntries.length;
    return {
      monthTotalKwh: total,
      monthSessions: count,
      avgKwhPerSession: count > 0 ? total / count : 0,
    };
  }, [history]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0 && chartData.some(d => d.energy_kwh > 0);

  const handleRefresh = () => {
    refetchSites();
    if (siteId) {
      refetchHistory();
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
          emptyIcon={<AppText style={styles.emptyGlyph}>{ICON_PLUG}</AppText>}
          emptyMessage={t(
            'widget.wallConnector.noSite',
            'No Tesla Energy site linked',
          )}
          isEmpty
          stats={[]}
        />
      </WidgetShell>
    );
  }

  // Compact (1-col): month total kWh as large number
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
          emptyIcon={<AppText style={styles.emptyGlyph}>{ICON_PLUG}</AppText>}
          emptyMessage={t(
            'widget.wallConnector.noData',
            'No Wall Connector data',
          )}
          isEmpty={!hasData}
          stats={
            hasData
              ? [
                  {
                    label: t('widget.wallConnector.monthTotal', 'This Month'),
                    value: fmtNumber(monthTotalKwh, 1),
                    unit: 'kWh',
                  },
                  {
                    label: t('widget.wallConnector.sessions', 'Sessions'),
                    value: fmtInt(monthSessions),
                  },
                ]
              : []
          }
        />
      </WidgetShell>
    );
  }

  // Standard (2×4+): bar chart + stats
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.wallConnector.monthTotal', 'This Month'),
          value: fmtNumber(monthTotalKwh, 1),
          unit: 'kWh',
        },
        {
          label: t('widget.wallConnector.sessions', 'Sessions'),
          value: fmtInt(monthSessions),
        },
        {
          label: t('widget.wallConnector.avgPerSession', 'Avg / Session'),
          value: fmtNumber(avgKwhPerSession, 1),
          unit: 'kWh',
        },
      ]
    : [];

  // web: tick = isWide ? axisTick : axisTickSm (fontSize 11 vs 10).
  const tickFontSize = isWide ? 11 : 10;

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={
        <AppText style={[styles.titleGlyph, {color: colors.success}]}>
          {ICON_PLUG}
        </AppText>
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={handleRefresh}
      title={t('widget.wallConnector.title', 'Wall Connector')}
      updatedAt={updatedAt}>
      <WidgetChartSummary
        chart={
          <WallConnectorBarChart
            data={chartData}
            height={isWide ? 150 : 130}
            tickFontSize={tickFontSize}
          />
        }
        emptyIcon={<AppText style={styles.emptyGlyph}>{ICON_PLUG}</AppText>}
        emptyMessage={t('widget.wallConnector.noData', 'No Wall Connector data')}
        isEmpty={!hasData}
        stats={stats}
      />
    </WidgetShell>
  );
}

WallConnectorWidget.displayName = 'WallConnectorWidget';

// shadow-[0_0_12px_rgba(34,197,94,0.15)] pulse-on-update glow.
const PULSE_GLOW = '#22c55e';

const styles = StyleSheet.create({
  barFill: {
    alignSelf: 'center',
    backgroundColor: BAR_COLOR,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
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
    flexBasis: '30%',
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
