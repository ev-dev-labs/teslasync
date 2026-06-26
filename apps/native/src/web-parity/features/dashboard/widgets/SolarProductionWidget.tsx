// Native parity port of web/src/features/dashboard/widgets/SolarProductionWidget.tsx.
//
// The web widget is the dashboard "Solar Production" tile. It resolves the first
// linked Tesla Energy site (`(sites ?? [])[0]?.energy_site_id` from
// `useTeslaEnergySites()`), reads the last 30 days of daily energy history via
// `useTeslaEnergyHistory(siteId, 'day', since)` (GET
// /api/v1/tesla/energy-sites/{siteId}/energy-history?period=day&since=… —
// preserved verbatim by the already-ported native useEnergy hooks), and renders,
// inside a `WidgetShell`, a `WidgetChartSummary`. It has three layouts:
//   - No site linked (`!hasSites && !isLoading`): a title-less shell whose
//     summary is the "No Tesla Energy site linked" empty state (sites-only
//     freshness, refetchSites refresh).
//   - Compact (cols <= 1): a title-less shell whose summary shows Today + Daily
//     Avg kWh as a compact stat row (no chart), or the "No solar data" empty
//     state.
//   - Standard (cols >= 2): a titled "Solar Production" shell whose summary shows
//     Today / 30-Day Total / Daily Avg kWh over an area chart of daily solar kWh.
//
// Every state name (`sites`, `sitesLoading`, `sitesError`, `sitesFetching`,
// `sitesStale`, `sitesIsError`, `sitesUpdatedAt`, `refetchSites`, `siteId`,
// `since`, `history`, `historyLoading`, `historyError`, `historyFetching`,
// `historyStale`, `historyIsError`, `historyUpdatedAt`, `refetchHistory`,
// `isLoading`, `error`, `isFetching`, `isStale`, `isError`, `updatedAt`,
// `hasSites`, `chartData`, `todayKwh`, `totalKwh`, `avgKwh`, `isCompact`,
// `isWide`, `hasData`, `handleRefresh`, `stats`, `tick`), the `siteId` resolution,
// the `since` 30-day-ago useMemo, the four `useMemo`s with their exact dependency
// arrays, the combined freshness derivations (`sitesLoading || (!!siteId &&
// historyLoading)`, `sitesError ?? historyError`, the `||` fetching/stale/error
// merges, the `Math.max(... ?? 0)` updatedAt), the `(solar_energy_wh ?? 0) / 1000`
// Wh->kWh display conversion, the `size.cols <= 1` / `>= 3` thresholds, the
// `hasData = length > 0 && some(solar_kwh > 0)` guard, the `handleRefresh`
// (refetchSites + conditional refetchHistory), the `error ? String(error) : null`
// coercion, the `widget.solarProduction.*` i18n keys with their English
// fallbacks, and the pure `shortDate`/`todayKey` helpers are preserved verbatim.
// Browser-only pieces are mapped to native-safe equivalents (documented in the
// parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as the BatteryDegradationTrendWidget
//     / APIUsageWidget ports), so every key + copy is preserved.
//   - lucide-react `Sun` has no native icon dependency; per the
//     BatteryDegradationTrendWidget / MQTTStatusWidget glyph precedent it becomes
//     a decorative Unicode sun glyph (\u2600) in an `AppText` with
//     `importantForAccessibility="no"` (the shell title / empty message carries
//     the accessible meaning). The title icon's `h-3.5 w-3.5` (14px)
//     `text-yellow-400` maps to fontSize 14 tinted with the literal yellow-400
//     `#facc15` (preserved verbatim — the web hard-codes the hex, it is not a
//     theme token); the empty-state `h-5 w-5` (20px) maps to fontSize 20 muted.
//   - The entire recharts area chart (`ResponsiveContainer`, `AreaChart`, `Area`,
//     `XAxis`, `YAxis`, `Tooltip`, `chartGrid` (CartesianGrid), `chartMargin`,
//     `chartAnimation`, `axisTick`/`axisTickSm`, `fmt`, the `solarGrad`
//     `<linearGradient>`) is DOM/SVG-only. It is reimplemented as a native
//     `SolarProductionChart` of scaled Views (the established native chart idiom —
//     see the BatteryDegradationTrendWidget port): the `Area` solar series becomes
//     per-day columns, `chartGrid` -> horizontal grid lines, `XAxis dataKey="date"`
//     -> centered axis labels (auto-thinned to ~6, mirroring recharts' tick
//     auto-skip so 30 daily labels don't overlap), `YAxis tickFormatter fmt(v, 0)`
//     + `width={40}` -> a left tick column (domain max / 0 as integers), and the
//     `solarGrad` #facc15 fade-to-transparent gradient + #facc15 stroke collapse to
//     a solid #facc15 column fill at 0.85 opacity (RN has no first-class SVG
//     gradient without react-native-svg, consistent with the Spinner port). The
//     `axisTick`(11px)/`axisTickSm`(10px) `isWide` split is preserved on the tick
//     fonts; `chartAnimation` (animationDuration 800) is dropped (no enter anim).
//     The `<Tooltip>` hover affordance has no native analogue (no pointer) so it is
//     dropped; the plot exposes an accessible summary label instead.
//   - `@/api/hooks/useEnergy` `useTeslaEnergyHistory` / `useTeslaEnergySites` ->
//     ../../../api/hooks/useEnergy (already-ported; the energy-history + energy-sites
//     routes + the TeslaEnergyHistoryEntry.timestamp/solar_energy_wh and
//     TeslaEnergySite.energy_site_id fields are intact).
//   - `@/lib/numberFormat` `fmtNumber`/`fmtInt` are inlined as native-safe
//     formatters mirroring the web module (locale-aware toLocaleString, the
//     out-of-box precision-2 / en-US defaults; `fmtInt` === `fmtNumber(v, 0)`).
//   - `./WidgetShell` (web: a transparent flex container with Skeleton loading +
//     QueryError error + a DataFreshness header affordance) is inlined on a
//     `GlassPanel`: loading -> centered Spinner, error -> centered danger text,
//     otherwise an optional uppercase title row + a compact freshness control
//     (status dot coloured by isError/isStale/isFetching + a refresh Pressable
//     wired to onRefresh) over the children — identical to the
//     BatteryDegradationTrendWidget port.
//   - `./shared` `WidgetChartSummary` + `ChartSummaryStat` (web
//     shared/WidgetChartSummary) are inlined: the `isEmpty` `EmptyState` branch,
//     the `stats.length > 0` 2-col stat grid (label + value + optional unit), and
//     the `!compact` chart slot are reproduced with Views + `AppText`.
//     `@/components/feedback` `EmptyState` -> a small centered `WidgetEmptyState`
//     (glyph icon + muted message).
//   - `./types` `WidgetProps` -> a local interface mirroring it (WidgetSize
//     {cols, rows}); `./types` is not yet ported.

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
import {
  useTeslaEnergyHistory,
  useTeslaEnergySites,
} from '../../../api/hooks/useEnergy';
import {Spinner} from '../../../components/feedback/Spinner';

/* ─── i18n fallback shim ───────────────────────────────────────────────────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── native-safe number formatters (mirror web @/lib/numberFormat) ─────────── */

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

// web `fmtInt(v) => fmtNumber(v, 0)`.
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── decorative glyph (lucide-react Sun stand-in) ─────────────────────────── */

const ICON_SUN = '\u2600'; // ☀ sun (monochrome so the tint applies)
const GLYPH_REFRESH = '\u21BB';

// web: the `Area`/icon series colour is the hard-coded yellow-400 `#facc15`
// (the lucide `text-yellow-400` icon + the solarGrad gradient + the Area stroke).
const SOLAR_COLOR = '#facc15';

/* ─── pure helpers (ported verbatim from the web module) ───────────────────── */

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

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

interface ChartDatum {
  date: string;
  solar_kwh: number;
}

/* ─── inlined ChartSummaryStat (web shared/WidgetChartSummary) ──────────────── */

interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
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

/* ─── inlined solar area chart (web recharts AreaChart) ─────────────────────── */

const CHART_GRID_LINES = [25, 50, 75]; // CartesianGrid horizontal lines
const MAX_AXIS_LABELS = 6; // recharts auto-skips overlapping XAxis ticks

function clamp01(v: number): number {
  if (v < 0) {
    return 0;
  }
  if (v > 1) {
    return 1;
  }
  return v;
}

function SolarProductionChart({
  points,
  seriesColor,
  isWide,
  t,
}: {
  points: ChartDatum[];
  seriesColor: string;
  isWide: boolean;
  t: NativeTFunction;
}) {
  if (points.length === 0) {
    return (
      <View style={styles.chartFallback}>
        <AppText style={styles.chartFallbackText} tone="muted">
          {t('widget.solarProduction.noData', 'No solar data')}
        </AppText>
      </View>
    );
  }

  const values = points.map(point => point.solar_kwh);
  const domainMax = Math.max(...values, 0); // YAxis auto domain top (Area baseline 0)
  const norm = (value: number) =>
    clamp01(domainMax > 0 ? value / domainMax : 0);

  const tickStyle = isWide ? styles.chartAxisTickWide : styles.chartAxisTick;
  const labelStep = Math.max(1, Math.ceil(points.length / MAX_AXIS_LABELS));

  const seriesLabel = `${t('widget.solarProduction.solar', 'Solar')}: ${points
    .map(point => `${point.date} ${fmtNumber(point.solar_kwh, 1)} kWh`)
    .join(', ')}`;

  return (
    <View style={styles.chart}>
      {/* YAxis tickFormatter fmt(v, 0) — domain max / 0 ticks (web width 40) */}
      <View style={styles.chartAxisColumn}>
        <AppText style={tickStyle} tone="muted">
          {fmtNumber(domainMax, 0)}
        </AppText>
        <AppText style={tickStyle} tone="muted">
          {fmtNumber(0, 0)}
        </AppText>
      </View>

      <View style={styles.chartBody}>
        <View
          accessibilityLabel={seriesLabel}
          accessibilityRole="image"
          accessible
          style={styles.chartPlotPanel}>
          {/* chartGrid (CartesianGrid) */}
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

          {/* Area dataKey="solar_kwh" (solarGrad fill) -> scaled columns */}
          <View style={styles.chartColumns}>
            {points.map(point => {
              const height = `${Math.max(
                norm(point.solar_kwh) * 100,
                2,
              )}%` as DimensionValue;

              return (
                <View key={point.date} style={styles.chartColumn}>
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

        {/* XAxis dataKey="date" (auto-thinned ticks) */}
        <View style={styles.chartAxisRow}>
          {points.map((point, index) => {
            const showLabel =
              index % labelStep === 0 || index === points.length - 1;
            return (
              <View key={`x-${point.date}`} style={styles.chartAxisLabelCell}>
                {showLabel ? (
                  <AppText numberOfLines={1} style={tickStyle} tone="muted">
                    {point.date}
                  </AppText>
                ) : null}
              </View>
            );
          })}
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

export default function SolarProductionWidget({size}: WidgetProps) {
  const t = useNativeTranslationFallback();

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
    d.setDate(d.getDate() - 30);
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
  } = useTeslaEnergyHistory(siteId, 'day', since);

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
      date: shortDate(entry.timestamp ?? ''),
      solar_kwh: (entry.solar_energy_wh ?? 0) / 1000,
    }));
  }, [history]);

  const todayKwh = useMemo(() => {
    const key = todayKey();
    const todayEntry = (history ?? []).find(
      e => (e.timestamp ?? '').slice(0, 10) === key,
    );
    return (todayEntry?.solar_energy_wh ?? 0) / 1000;
  }, [history]);

  const totalKwh = useMemo(
    () => chartData.reduce((sum, d) => sum + d.solar_kwh, 0),
    [chartData],
  );

  const avgKwh = chartData.length > 0 ? totalKwh / chartData.length : 0;

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData =
    chartData.length > 0 && chartData.some(d => d.solar_kwh > 0);

  const handleRefresh = () => {
    refetchSites();
    if (siteId) {
      refetchHistory();
    }
  };

  const emptyIcon = (
    <AppText importantForAccessibility="no" style={styles.emptyIconGlyph}>
      {ICON_SUN}
    </AppText>
  );

  // ── No energy sites linked ──
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
          emptyIcon={emptyIcon}
          emptyMessage={t(
            'widget.solarProduction.noSite',
            'No Tesla Energy site linked',
          )}
          isEmpty
          stats={[]}
        />
      </WidgetShell>
    );
  }

  // ── Compact (1-col): Today's kWh as large number ──
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
          emptyIcon={emptyIcon}
          emptyMessage={t('widget.solarProduction.noData', 'No solar data')}
          isEmpty={!hasData}
          stats={
            hasData
              ? [
                  {
                    label: t('widget.solarProduction.today', 'Today'),
                    value: fmtNumber(todayKwh, 1),
                    unit: 'kWh',
                  },
                  {
                    label: t('widget.solarProduction.avg', 'Daily Avg'),
                    value: fmtNumber(avgKwh, 1),
                    unit: 'kWh',
                  },
                ]
              : []
          }
        />
      </WidgetShell>
    );
  }

  // ── Standard (2×4+): stat header + area chart ──
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.solarProduction.today', 'Today'),
          value: fmtNumber(todayKwh, 1),
          unit: 'kWh',
        },
        {
          label: t('widget.solarProduction.total30d', '30-Day Total'),
          value: fmtInt(totalKwh),
          unit: 'kWh',
        },
        {
          label: t('widget.solarProduction.avg', 'Daily Avg'),
          value: fmtNumber(avgKwh, 1),
          unit: 'kWh',
        },
      ]
    : [];

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={
        <AppText importantForAccessibility="no" style={styles.titleIcon}>
          {ICON_SUN}
        </AppText>
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={handleRefresh}
      title={t('widget.solarProduction.title', 'Solar Production')}
      updatedAt={updatedAt}>
      <WidgetChartSummary
        chart={
          <SolarProductionChart
            isWide={isWide}
            points={chartData}
            seriesColor={SOLAR_COLOR}
            t={t}
          />
        }
        emptyIcon={emptyIcon}
        emptyMessage={t('widget.solarProduction.noData', 'No solar data')}
        isEmpty={!hasData}
        stats={stats}
      />
    </WidgetShell>
  );
}

SolarProductionWidget.displayName = 'SolarProductionWidget';

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
  chartAxisLabelCell: {
    alignItems: 'center',
    flex: 1,
  },
  chartAxisRow: {
    flexDirection: 'row',
    gap: 2,
  },
  chartAxisTick: {
    fontSize: 10,
  },
  chartAxisTickWide: {
    fontSize: 11,
  },
  chartBody: {
    flex: 1,
    gap: spacing.xs,
  },
  chartColumn: {
    flex: 1,
  },
  chartColumnFill: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    opacity: 0.85,
    width: '100%',
  },
  chartColumnTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 3,
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
    color: SOLAR_COLOR,
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
