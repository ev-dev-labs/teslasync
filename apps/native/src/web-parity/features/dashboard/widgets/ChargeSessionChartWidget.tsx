// Native parity port of web/src/features/dashboard/widgets/ChargeSessionChartWidget.tsx.
//
// `ChargeSessionChartWidget` is a dashboard widget that charts the energy added
// across the active vehicle's 10 most recent charging sessions, colour-coded by
// charger type (home/supercharger/dc). It has two layouts driven by `size`:
//   - compact (cols <= 1 && rows <= 1): the stat summary only (no chart), or an
//     empty state when there are no sessions.
//   - full: a titled shell whose body is the stat summary + a vertical bar chart
//     + a charger-type legend, or an empty state.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3): the
// `id = vehicleId ?? vehicles?.[0]?.id ?? 0` vehicle resolution (L43), the
// `useQuery` charging query (queryKey `['charging', id, 'session-chart-10']`,
// queryFn `request<ChargingSession[]>('/charging?vehicle_id=${id}&limit=10')`,
// `enabled: id > 0`, `staleTime: 60_000`) (L46-51), the memoized `chartData`
// (map each session to `{ label, energy, type }` with `formatDateShort(started_at)`
// else `#${i+1}`, `convertEnergyFromSI(total_energy_added_wh ?? 0, 'kWh')`,
// `classifyChargerType(s)`, then `.reverse()`) (L53-64), `hasData`/`isCompact`/
// `isWide`/`tick` (L66-69), the memoized `stats` (total/avg/sessions with the
// exact i18n keys + 'kWh' units) (L71-80), and both render branches (L82-176).
// Every i18n key + English default, the `/charging?vehicle_id=&limit=10` API
// path, the snake_case fields (charger_type, started_at, total_energy_added_wh)
// and the SI->kWh unit handling are kept verbatim.
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local fallback
//     resolver returning the inline English string (same shim shape as the
//     AnomalyDetector / BatteryDegradation widget ports); `{{name}}`
//     placeholders are interpolated from the options arg. The namespace arg is
//     accepted + ignored.
//   - `lucide-react` `Zap` (L4) -> a decorative `<GlyphIcon>` "⚡" stand-in
//     (there is no `react-native-svg` dependency); the header icon keeps the web
//     `text-emerald-400` (#34d399) colour, the empty-state icon takes the muted
//     token, matching the web `EmptyState` icon styling.
//   - `@/components/charts` (L5-8): Recharts has no native renderer (the native
//     charts barrel's BarChart/Bar/Cell/XAxis/YAxis/ResponsiveContainer/Tooltip
//     render "unavailable" placeholders), so the bar chart is re-implemented with
//     React Native primitives to preserve the visual intent — a row of vertical
//     bars (height ∝ energy / max, `maxBarSize 32` -> maxWidth 32, `radius
//     [4,4,0,0]` -> rounded top corners, `Cell fill` -> per-bar
//     `CHARGER_COLORS[type] ?? '#6366f1'`), an X-axis date-label row, a Y-axis
//     tick column (`tickFormatter (v) => fmt(v,0)`, `width 36`), and faint
//     horizontal gridlines for `chartGrid`. `fmt` + `safe` are inlined
//     (en-US, nullish/non-finite -> 0). `axisTick`/`axisTickSm` are inlined as
//     the `{ fill, fontSize }` tick descriptors so the `tick = isWide ? axisTick
//     : axisTickSm` selection still drives the axis font size/colour.
//     `chartMargin` -> plot padding. The Recharts hover `Tooltip` (no hover on
//     touch) -> each bar carries an `accessibilityLabel` reproducing the
//     formatter output (`${fmt(energy,1)} kWh`, charger-type label) + the
//     labelFormatter (date). `chartAnimation` (Recharts enter animation) has no
//     native analog and is intentionally omitted.
//   - `@/lib/colors` `CHARGER_COLORS` (L11) -> inlined verbatim (the full map,
//     internal + display-name keys).
//   - `@/hooks/useDateFormat` `useDateFormat` (L12) -> local shim exposing
//     `formatDateShort` (web `@/lib/dateFormat`: `Intl` month-short/day-numeric,
//     '—' for nullish/invalid, with a manual `M/D` fallback if `Intl` is
//     unavailable on the engine); there is no native settings/locale port yet so
//     it resolves to 'en-US', matching the English i18n fallback.
//   - `./shared` `WidgetChartSummary` + `ChartSummaryStat` (L13) -> reproduced
//     locally as `<WidgetChartSummary>` (sibling not yet ported): the
//     `isEmpty -> EmptyState`, the stat row (2-col compact / horizontal wide),
//     and the `!compact` chart slot.
//   - `./WidgetShell` `WidgetShell` (L14) -> reproduced locally (same
//     self-contained approach as the sibling widget ports): loading -> skeleton
//     block, error -> centred danger text (surfaced, never hidden), title+icon
//     header, the freshness chip via the converted web-parity `DataFreshness`
//     port, the `noPadding` body switch, and the children body. The web
//     pulse-on-data-change box-shadow glow / help-tooltip / pin-button header
//     slots are unused by this widget and are not modeled.
//   - `./types` `WidgetProps` (L15) -> `WidgetProps`/`WidgetSize`/`WidgetConfig`
//     reproduced + exported. `@/api/types` `ChargingSession` (L16) -> the
//     already-ported web-parity `ChargingSession` type (same snake_case shape).
//   - `@/lib/unitConversion` `convertEnergyFromSI` (L17) -> inlined verbatim
//     (Wh -> Wh / kWh -> Wh/1000).
//   - `@/api/hooks/useVehicles` `useVehicles` (L9) + `@/api/client` `request`
//     (L10) -> the already-ported web-parity hook + client (real TanStack Query
//     against `/vehicles` and `/charging`).
//
// Tailwind spacing -> px (1 unit = 4px); var(--text-*) -> the theme tokens so the
// light/dark cascade is preserved at the token boundary.

import React, { useMemo, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import { useVehicles } from '../../../api/hooks/useVehicles';
import { request } from '../../../api/client';
import type { ChargingSession } from '../../../api/types';

// ── i18n shim (web react-i18next `useTranslation`) ───────────────────────────
// Translations resolve to their inline English fallback; `{{name}}` placeholders
// are interpolated from the options arg. The namespace arg is accepted + ignored
// so the component body matches `const { t } = useTranslation('dashboard')`.
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, options?: TOptions) => string;

function useTranslation(_namespace?: string): { t: TFunc } {
  return {
    t: (_key, fallback, options) => {
      if (!options) {
        return fallback;
      }
      return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        options[name] != null ? String(options[name]) : match,
      );
    },
  };
}

// ── useDateFormat shim (web @/hooks/useDateFormat -> @/lib/dateFormat) ────────
// `formatDateShort` mirrors the web helper: 'Mmm D' via Intl with the en-US
// locale (no native settings/locale port yet), '—' for nullish/invalid input,
// and a manual `M/D` fallback if Intl is unavailable on the JS engine.
type DateFormatShort = (value: string | Date | null | undefined) => string;

function formatDateShortImpl(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
}

function useDateFormat(): { formatDateShort: DateFormatShort } {
  return { formatDateShort: formatDateShortImpl };
}

// ── Inlined number formatting (web @/components/charts `fmt` / `safe`) ────────
function safe(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmt(v: unknown, decimals = 1): string {
  return safe(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Inlined axis tick descriptors (web @/components/charts) ───────────────────
const axisTick = { fill: colors.textMuted, fontSize: 11 } as const;
const axisTickSm = { fill: colors.textMuted, fontSize: 10 } as const;

// ── Inlined `@/lib/unitConversion` `convertEnergyFromSI` ──────────────────────
type EnergyUnitPref = 'Wh' | 'kWh';

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

// ── Inlined `@/lib/colors` `CHARGER_COLORS` ──────────────────────────────────
const CHARGER_COLORS: Record<string, string> = {
  // Internal keys (Charging page)
  supercharger: '#ef4444',
  dc: '#f59e0b',
  home: '#10b981',
  // Display-name keys (CostAnalysis page)
  Home: '#10b981',
  Supercharger: '#ef4444',
  'Public DC': '#a855f7',
  'Work / L2': '#f59e0b',
  Other: '#6366f1',
};

const EMERALD_400 = '#34d399'; // web text-emerald-400 header icon
const DEFAULT_BAR_COLOR = '#6366f1'; // web Cell fill fallback

// ── Type reproductions (web ./types) ─────────────────────────────────────────
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

// ── Type reproduction (web ./shared `ChartSummaryStat`) ───────────────────────
export interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

/** Classify a charging session into a charger-type bucket for color-coding. */
function classifyChargerType(session: ChargingSession): string {
  const ft = (session.charger_type ?? '').toLowerCase();

  if (ft.includes('supercharger') || ft.includes('tesla')) {
    return 'supercharger';
  }
  if (ft && ft !== '<invalid>' && ft !== '') {
    return 'dc';
  }
  return 'home';
}

const CHARGER_TYPE_LABEL: Record<string, string> = {
  home: 'Home / AC',
  supercharger: 'Supercharger',
  dc: 'DC Fast',
};

interface ChartDatum {
  label: string;
  energy: number;
  type: string;
}

const LEGEND_TYPES = ['home', 'supercharger', 'dc'] as const;

// ── lucide `Zap` glyph stand-in ──────────────────────────────────────────────
function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}) {
  const glyphStyle: StyleProp<TextStyle> = {
    color,
    fontSize: size,
    lineHeight: size,
  };
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={glyphStyle}
    >
      {glyph}
    </AppText>
  );
}

// ── Local `EmptyState` (web @/components/feedback, icon+message) ──────────────
function LocalEmptyState({
  icon,
  message,
}: {
  icon?: ReactNode;
  message: string;
}) {
  // no-action: transient empty state — surfaces when source data is missing; no
  // specific recovery action available.
  return (
    <View style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// ── Native bar chart (web Recharts BarChart) ─────────────────────────────────
// Recharts has no native renderer, so the vertical bar chart is rebuilt from RN
// primitives: a Y-axis tick column + a plot body (gridlines behind a row of
// flex-end aligned bars) + an X-axis date-label row.
interface WidgetBarChartProps {
  data: ChartDatum[];
  tick: { fill: string; fontSize: number };
  t: TFunc;
}

function WidgetBarChart({ data, tick, t }: WidgetBarChartProps) {
  const maxEnergy = useMemo(
    () => Math.max(0, ...data.map((d) => d.energy)),
    [data],
  );
  const tickTextStyle: StyleProp<TextStyle> = {
    color: tick.fill,
    fontSize: tick.fontSize,
  };

  return (
    <View style={styles.chartWrap}>
      <View style={styles.plot}>
        {/* Y axis (Recharts <YAxis tickFormatter={(v) => fmt(v, 0)} width={36} />) */}
        <View style={styles.yAxis}>
          <AppText style={[styles.tickText, tickTextStyle]} numberOfLines={1}>
            {fmt(maxEnergy, 0)}
          </AppText>
          <AppText style={[styles.tickText, tickTextStyle]} numberOfLines={1}>
            {fmt(maxEnergy / 2, 0)}
          </AppText>
          <AppText style={[styles.tickText, tickTextStyle]} numberOfLines={1}>
            {fmt(0, 0)}
          </AppText>
        </View>

        <View style={styles.plotBody}>
          <View style={styles.barsRow}>
            {/* chartGrid (Recharts <CartesianGrid />) -> faint native gridlines */}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={[styles.gridLine, styles.gridLineTop]}
            />
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={[styles.gridLine, styles.gridLineMid]}
            />
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={[styles.gridLine, styles.gridLineBottom]}
            />

            {data.map((d, i) => {
              const ratio = maxEnergy > 0 ? d.energy / maxEnergy : 0;
              // Floor positive bars so tiny sessions stay visible (Recharts draws
              // a 1px sliver; RN needs an explicit minimum).
              const heightPct = Math.max(ratio * 100, d.energy > 0 ? 4 : 0);
              const color = CHARGER_COLORS[d.type] ?? DEFAULT_BAR_COLOR;
              return (
                <View
                  // Index key mirrors the web `<Cell key={i} />`; rows are static.
                  key={i}
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={`${d.label}: ${fmt(d.energy, 1)} kWh, ${
                    CHARGER_TYPE_LABEL[d.type] ?? d.type
                  }`}
                  style={styles.barColumn}
                >
                  <View
                    style={[
                      styles.bar,
                      {
                        backgroundColor: color,
                        height: `${heightPct}%` as DimensionValue,
                      },
                    ]}
                  />
                </View>
              );
            })}
          </View>

          {/* X axis (Recharts <XAxis dataKey="label" />) */}
          <View style={styles.xAxisRow}>
            {data.map((d, i) => (
              <AppText
                key={i}
                numberOfLines={1}
                style={[styles.xAxisLabel, tickTextStyle]}
              >
                {d.label}
              </AppText>
            ))}
          </View>
        </View>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {LEGEND_TYPES.map((type) => (
          <View key={type} style={styles.legendItem}>
            <View
              style={[styles.legendDot, { backgroundColor: CHARGER_COLORS[type] }]}
            />
            <AppText style={styles.legendText} numberOfLines={1}>
              {t(`widget.chargeSessionChart.type.${type}`, CHARGER_TYPE_LABEL[type])}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Local `WidgetChartSummary` (web ./shared) ────────────────────────────────
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
      <LocalEmptyState
        icon={emptyIcon}
        message={emptyMessage ?? 'No data available'}
      />
    );
  }

  return (
    <View style={styles.summaryRoot}>
      {stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map((stat) => (
            <View
              key={stat.label}
              style={[styles.statItem, compact ? styles.statItemCompact : null]}
            >
              <AppText style={styles.statLabel} numberOfLines={1}>
                {stat.label}
              </AppText>
              <AppText style={styles.statValue} numberOfLines={1}>
                {stat.value}
                {stat.unit ? (
                  <AppText style={styles.statUnit}>{` ${stat.unit}`}</AppText>
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

// ── Local `WidgetShell` (web ./WidgetShell) ──────────────────────────────────
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  noPadding?: boolean;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never). */
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
  noPadding,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  if (loading) {
    return <View accessibilityRole="progressbar" style={styles.skeleton} />;
  }
  if (error) {
    return (
      <View style={styles.errorBox}>
        <AppText tone="danger">{error}</AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl: ReactNode = showFreshness ? (
    <DataFreshness
      updatedAt={updatedAt > 0 ? updatedAt : null}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      isError={isError ?? false}
      onRefresh={onRefresh}
      compact={freshnessCompact}
    />
  ) : null;

  return (
    <View style={styles.shell}>
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
      <View style={noPadding ? styles.bodyNoPadding : styles.body}>
        {children}
      </View>
    </View>
  );
}

export default function ChargeSessionChartWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { formatDateShort } = useDateFormat();

  const {
    data: sessions,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['charging', id, 'session-chart-10'],
    queryFn: () =>
      request<ChargingSession[]>(`/charging?vehicle_id=${id}&limit=10`),
    enabled: id > 0,
    staleTime: 60_000,
  });

  const chartData = useMemo<ChartDatum[]>(
    () =>
      (sessions ?? [])
        .map((s, i) => ({
          label: s.started_at ? formatDateShort(s.started_at) : `#${i + 1}`,
          energy: convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh'),
          type: classifyChargerType(s),
        }))
        .reverse(),
    [sessions, formatDateShort],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const tick = isWide ? axisTick : axisTickSm;

  const stats: ChartSummaryStat[] = useMemo(() => {
    if (!hasData) {
      return [];
    }
    const total = chartData.reduce((sum, d) => sum + d.energy, 0);
    const avg = total / chartData.length;
    return [
      {
        label: t('widget.chargeSessionChart.total', 'Total'),
        value: fmt(total, 1),
        unit: 'kWh',
      },
      {
        label: t('widget.chargeSessionChart.avg', 'Avg'),
        value: fmt(avg, 1),
        unit: 'kWh',
      },
      {
        label: t('widget.chargeSessionChart.sessions', 'Sessions'),
        value: String(chartData.length),
      },
    ];
  }, [chartData, hasData, t]);

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t(
            'widget.chargeSessionChart.empty',
            'No charge sessions yet',
          )}
          emptyIcon={<GlyphIcon glyph="⚡" color={colors.textMuted} size={20} />}
          stats={stats}
          chart={null}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.chargeSessionChart.title', 'Charge Sessions')}
      icon={<GlyphIcon glyph="⚡" color={EMERALD_400} size={14} />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      noPadding
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t(
          'widget.chargeSessionChart.empty',
          'No charge sessions yet',
        )}
        emptyIcon={<GlyphIcon glyph="⚡" color={colors.textMuted} size={20} />}
        stats={stats}
        chart={<WidgetBarChart data={chartData} tick={tick} t={t} />}
      />
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16, // p-4
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11, // text-[11px]
    fontWeight: '500', // font-medium
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6, // gap-1.5
  },
  freshnessOverlay: {
    position: 'absolute',
    right: 6, // right-1.5
    top: 6, // top-1.5
    zIndex: 5,
  },
  body: {
    flex: 1,
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  bodyNoPadding: {
    flex: 1,
    overflow: 'hidden', // noPadding -> overflow-hidden
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  summaryRoot: {
    flex: 1,
  },
  statsRow: {
    columnGap: spacing.md, // @sm:gap-4
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm, // gap-2
  },
  statItem: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  statItemCompact: {
    flexBasis: '45%', // compact -> grid-cols-2
    flexGrow: 0,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
  },
  statUnit: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px] font-normal, ml-0.5
    fontWeight: '400',
  },
  chartArea: {
    flex: 1,
    marginTop: spacing.sm, // mt-2
    minHeight: 120,
  },
  chartWrap: {
    flex: 1,
    paddingBottom: 4, // pb-1
    paddingHorizontal: 8, // px-2
  },
  plot: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 96,
    paddingTop: 10, // chartMargin.top
  },
  yAxis: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingRight: 4,
    width: 36, // YAxis width={36}
  },
  tickText: {
    color: colors.textMuted,
  },
  plotBody: {
    flex: 1,
  },
  barsRow: {
    alignItems: 'flex-end',
    flex: 1,
    flexDirection: 'row',
    position: 'relative',
  },
  gridLine: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    left: 0,
    opacity: 0.4, // chartGrid strokeOpacity
    position: 'absolute',
    right: 0,
  },
  gridLineTop: {
    top: 0,
  },
  gridLineMid: {
    top: '50%',
  },
  gridLineBottom: {
    bottom: 0,
  },
  barColumn: {
    alignItems: 'center',
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    paddingHorizontal: 2,
  },
  bar: {
    borderTopLeftRadius: 4, // radius [4,4,0,0]
    borderTopRightRadius: 4,
    maxWidth: 32, // maxBarSize={32}
    minHeight: 2,
    width: '70%',
  },
  xAxisRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  xAxisLabel: {
    color: colors.textMuted,
    flex: 1,
    textAlign: 'center',
  },
  legend: {
    alignItems: 'center',
    columnGap: spacing.md, // gap-3
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 4, // pb-1
    paddingTop: 4,
  },
  legendItem: {
    alignItems: 'center',
    columnGap: 4, // gap-1
    flexDirection: 'row',
  },
  legendDot: {
    borderRadius: 999, // rounded-full
    height: 8, // h-2
    width: 8, // w-2
  },
  legendText: {
    color: colors.textSecondary,
    fontSize: 10, // text-[10px]
  },
});
