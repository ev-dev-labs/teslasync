// Native parity port of web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx.
//
// `ClimateHistoryWidget` is a dashboard widget that charts the active vehicle's
// cabin (inside) vs ambient (outside) temperature history as two overlapping
// area series. It has two layouts driven by `size`:
//   - compact (cols <= 1): the stat summary only (no chart) — latest cabin +
//     outside temps — or an empty state when there is no history.
//   - full: a titled shell whose body is the stat summary + the area chart, or
//     an empty state.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3): the
// `vid = vehicleId ?? vehicles?.[0]?.id ?? 0` vehicle resolution (L43-44), the
// `toTemperatureDisplay = (v) => convertTempFromSI(v, unitPrefs.temperature)`
// closure (L46) + `tempUnit = unitPrefs.temperature` (L48), the
// `useClimateHistory(vid > 0 ? String(vid) : '')` query + its destructured
// result (data/isLoading/isFetching/isStale/isError/dataUpdatedAt/refetch)
// (L50-58), the memoized `chartData = buildChartData(data, toTemperatureDisplay)`
// (L60-63), the module-level `buildChartData` (L24-38: filter rows with
// created_at||timestamp, map to `{ time: created_at ?? timestamp ?? '',
// inside: insideTemp!=null ? toDisplay(insideTemp) : null, outside: same }`,
// then `.sort((a,b) => a.time.localeCompare(b.time))`), `hasData`/`isCompact`/
// `isWide`/`tick` (L65-67, L98), the `latestInside`/`latestOutside` reverse
// scans (L69-81), the `stats` ternary (L83-96: Cabin/Outside latest with the
// exact i18n keys + `tempUnit` units), and both render branches (L100-205).
// Every i18n key + English default, the `/climate?vehicle_id=` API path (via the
// already-ported `useClimateHistory` hook), the SI->display temperature handling
// and the snake_case/camelCase fields (created_at, timestamp, insideTemp,
// outsideTemp) are kept verbatim.
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local fallback
//     resolver returning the inline English string (same shim shape as the
//     ChargeSessionChart / AnomalyDetector widget ports); `{{name}}`
//     placeholders are interpolated from the options arg, the namespace arg is
//     accepted + ignored.
//   - `lucide-react` `ThermometerSun` (L3) -> a decorative `<GlyphIcon>` "🌡"
//     stand-in (there is no `react-native-svg` dependency); the header icon
//     keeps the web `text-neon-cyan` intent via `colors.accent`, the empty-state
//     icon takes the muted token (matching the web `EmptyState` icon styling).
//   - `@/components/charts` (L4-7): Recharts has no native renderer (the native
//     charts barrel's AreaChart/Area/XAxis/YAxis/Tooltip/ResponsiveContainer
//     render "unavailable" placeholders), so the `<AreaChart>` is re-implemented
//     with React Native primitives to preserve the visual intent — two
//     overlapping area series (inside #f97316, outside #3b82f6) drawn as a row of
//     bottom-anchored fills (fill = series colour at the web gradient's 0.3 stop
//     opacity, a `strokeWidth 2` top border = the web `<Area stroke>`), a shared
//     auto y-domain (Recharts default extent), a Y-axis tick column
//     (`tickFormatter (v) => `${fmt(v,0)}°``, `width 35`), an X-axis date-label
//     row (`tickFormatter formatTime`), and faint horizontal gridlines for
//     `chartGrid`. `fmt`/`safe` are inlined (en-US, nullish/non-finite -> 0).
//     `axisTick`/`axisTickSm` are inlined as `{ fill, fontSize }` tick
//     descriptors so the `tick = isWide ? axisTick : axisTickSm` selection (L98)
//     still drives the axis font size/colour. `chartMargin.top` -> plot
//     paddingTop. The Recharts hover `Tooltip` (no hover on touch) ->
//     per-point `accessibilityLabel`s reproducing the formatter output
//     (`${fmtInt(value)}${tempUnit}` per series) + the labelFormatter (formatTime
//     of the timestamp). The two `<linearGradient>` defs + `connectNulls`
//     (line continuity across gaps) + `chartAnimation` (Recharts enter
//     animation) have no native analog: gradients -> flat alpha fill, nulls ->
//     gaps, animation omitted — all documented.
//   - `@/hooks/useUnits` `useUnits` (L10) -> a local shim exposing
//     `unitPrefs.temperature`. There is no native settings/locale port yet, so it
//     resolves to '°C' (the web `deriveTemperature` default when
//     `settings.unit_of_temp !== 'F'`), keeping all temperatures SI on disk and
//     converting only at this display boundary.
//   - `@/lib/unitConversion` `convertTempFromSI` (L16) -> inlined verbatim
//     (°C -> °C, °C -> (c*9/5)+32).
//   - `@/lib/numberFormat` `fmtInt` (L11) -> inlined (en-US locale, 0 fraction
//     digits, nullish/NaN -> 0 via `safe`).
//   - `@/hooks/useDateFormat` `useDateFormat` (L12) -> local shim exposing
//     `formatDateTime` (web `@/lib/dateFormat`: Intl year/month-short/day +
//     2-digit hour/minute, '—' for nullish/invalid). No native settings/locale
//     port yet, so it resolves to 'en-US'.
//   - `./shared` `WidgetChartSummary` + `ChartSummaryStat` (L13) -> reproduced
//     locally (sibling not yet ported): `isEmpty -> EmptyState`, the stat row
//     (2-col compact / horizontal wide), and the `!compact` chart slot.
//   - `./WidgetShell` `WidgetShell` (L14) -> reproduced locally (same
//     self-contained approach as the sibling widget ports): loading -> skeleton
//     block, error -> centred danger text (surfaced, never hidden), title+icon
//     header, the freshness chip via the converted web-parity `DataFreshness`
//     port, the `noPadding` body switch, and the children body. The web
//     pulse-on-data-change glow / help-tooltip / pin-button header slots are
//     unused by this widget and are not modeled.
//   - `./types` `WidgetProps` (L15) -> `WidgetProps`/`WidgetSize`/`WidgetConfig`
//     reproduced + exported.
//   - `@/api/hooks/useVehicleSystems` `useClimateHistory` (L8) +
//     `@/api/hooks/useVehicles` `useVehicles` (L9) -> the already-ported
//     web-parity hooks (real TanStack Query against `/climate` + `/vehicles`).
//
// Tailwind spacing -> px (1 unit = 4px); var(--text-*) / text-neon-* -> the theme
// tokens so the light/dark cascade is preserved at the token boundary.

import React, { useMemo, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import { useVehicles } from '../../../api/hooks/useVehicles';
import { useClimateHistory } from '../../../api/hooks/useVehicleSystems';

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
// `formatDateTime` mirrors the web helper: Intl year/month-short/day + 2-digit
// hour/minute with the en-US locale (no native settings/locale port yet), and
// '—' for nullish/invalid input.
type DateFormatter = (value: string | Date | null | undefined) => string;

function formatDateTimeImpl(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
}

function useDateFormat(): { formatDateTime: DateFormatter } {
  return { formatDateTime: formatDateTimeImpl };
}

// ── Inlined number formatting (web @/components/charts `fmt`/`safe`) ──────────
function safe(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmt(v: unknown, decimals = 1): string {
  return safe(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Inlined `@/lib/numberFormat` `fmtInt` (locale-aware, 0 fraction digits) ───
function fmtInt(v: unknown): string {
  return fmt(v, 0);
}

// ── Inlined axis tick descriptors (web @/components/charts) ───────────────────
const axisTick = { fill: colors.textMuted, fontSize: 11 } as const;
const axisTickSm = { fill: colors.textMuted, fontSize: 10 } as const;

// ── Inlined `@/lib/unitConversion` `convertTempFromSI` ───────────────────────
type TemperatureUnitPref = '°C' | '°F';

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

// ── useUnits shim (web @/hooks/useUnits) ─────────────────────────────────────
// No native settings/locale port yet, so the temperature preference resolves to
// '°C' (the web `deriveTemperature` default when `unit_of_temp !== 'F'`). All
// values stay SI on disk and convert only at this display boundary.
interface UnitPrefsShim {
  temperature: TemperatureUnitPref;
}

function useUnits(): { unitPrefs: UnitPrefsShim } {
  return { unitPrefs: { temperature: '°C' } };
}

// Series colours (web `<Area stroke>` + `<linearGradient>` base colours).
const INSIDE_COLOR = '#f97316'; // cabin
const OUTSIDE_COLOR = '#3b82f6'; // outside
const AREA_FILL_OPACITY = 0.3; // web gradient `stopOpacity={0.3}` top stop

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

// ── Type reproduction (web ./shared `ChartSummaryStat`) ──────────────────────
export interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

interface ChartDatum {
  time: string;
  inside: number | null;
  outside: number | null;
}

function buildChartData(
  data: ReturnType<typeof useClimateHistory>['data'],
  toTemperatureDisplay: (c: number) => number,
): ChartDatum[] {
  const items = data ?? [];
  return items
    .filter((d) => d.created_at || d.timestamp)
    .map((d) => {
      const ts = d.created_at ?? d.timestamp ?? '';
      const inside = d.insideTemp != null ? toTemperatureDisplay(d.insideTemp) : null;
      const outside = d.outsideTemp != null ? toTemperatureDisplay(d.outsideTemp) : null;
      return { time: ts, inside, outside };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

interface ChartDomain {
  min: number;
  max: number;
}

/** Shared auto y-domain across both series (Recharts default data extent). */
function buildDomain(data: ChartDatum[]): ChartDomain {
  const vals: number[] = [];
  for (const d of data) {
    if (d.inside != null) {
      vals.push(d.inside);
    }
    if (d.outside != null) {
      vals.push(d.outside);
    }
  }
  if (vals.length === 0) {
    return { min: 0, max: 1 };
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (min === max) {
    const pad = Math.max(Math.abs(max) * 0.1, 1);
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

function heightForValue(value: number, domain: ChartDomain): DimensionValue {
  const span = domain.max - domain.min || 1;
  const percent = ((value - domain.min) / span) * 100;
  return `${Math.max(percent, 3)}%` as DimensionValue;
}

/** Thin the X-axis labels (Recharts auto-thins) — first / 1?3 / 2?3 / last. */
function pickXTicks(data: ChartDatum[]): ChartDatum[] {
  if (data.length <= 4) {
    return data;
  }
  const last = data.length - 1;
  const indices = [0, Math.round(last / 3), Math.round((last * 2) / 3), last];
  return Array.from(new Set(indices)).map((i) => data[i]);
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : hex;

  if (/^[\da-f]{6}$/i.test(expanded)) {
    const r = parseInt(expanded.slice(0, 2), 16);
    const g = parseInt(expanded.slice(2, 4), 16);
    const b = parseInt(expanded.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

// ── lucide `ThermometerSun` glyph stand-in ───────────────────────────────────
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

// ── Native area chart (web Recharts AreaChart) ───────────────────────────────
// Recharts has no native renderer, so the two-series overlapping area chart is
// rebuilt from RN primitives: a Y-axis tick column + a plot body (gridlines
// behind two bottom-anchored series layers) + an X-axis date-label row, with a
// per-point accessibility overlay reproducing the hover tooltip.
interface WidgetAreaChartProps {
  data: ChartDatum[];
  tick: { fill: string; fontSize: number };
  formatTime: DateFormatter;
  tempUnit: string;
  t: TFunc;
}

function WidgetAreaChart({ data, tick, formatTime, tempUnit, t }: WidgetAreaChartProps) {
  const domain = useMemo(() => buildDomain(data), [data]);
  const yTicks = useMemo(
    () => [domain.max, (domain.max + domain.min) / 2, domain.min],
    [domain],
  );
  const xTicks = useMemo(() => pickXTicks(data), [data]);

  const tickTextStyle: StyleProp<TextStyle> = {
    color: tick.fill,
    fontSize: tick.fontSize,
  };

  const cabinLabel = t('widget.climateHistory.cabin', 'Cabin');
  const outsideLabel = t('widget.climateHistory.outside', 'Outside');

  return (
    <View style={styles.chartWrap}>
      <View style={styles.plot}>
        {/* Y axis (Recharts <YAxis tickFormatter={(v) => `${fmt(v,0)}°`} width={35} />) */}
        <View style={styles.yAxis}>
          {yTicks.map((v, i) => (
            <AppText
              key={i}
              numberOfLines={1}
              style={[styles.tickText, tickTextStyle]}
            >
              {`${fmt(v, 0)}°`}
            </AppText>
          ))}
        </View>

        <View style={styles.plotBody}>
          <View style={styles.areasRow}>
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

            {/* Two area series (web <Area dataKey="inside|outside" />). nulls ->
                gaps (the web `connectNulls` line continuity has no native analog). */}
            <View pointerEvents="none" style={styles.seriesLayer}>
              {data.map((d, i) => (
                <View key={i} style={styles.column}>
                  {d.inside == null ? null : (
                    <View
                      style={[
                        styles.areaFill,
                        {
                          backgroundColor: withAlpha(INSIDE_COLOR, AREA_FILL_OPACITY),
                          borderTopColor: INSIDE_COLOR,
                          height: heightForValue(d.inside, domain),
                        },
                      ]}
                    />
                  )}
                </View>
              ))}
            </View>
            <View pointerEvents="none" style={styles.seriesLayer}>
              {data.map((d, i) => (
                <View key={i} style={styles.column}>
                  {d.outside == null ? null : (
                    <View
                      style={[
                        styles.areaFill,
                        {
                          backgroundColor: withAlpha(OUTSIDE_COLOR, AREA_FILL_OPACITY),
                          borderTopColor: OUTSIDE_COLOR,
                          height: heightForValue(d.outside, domain),
                        },
                      ]}
                    />
                  )}
                </View>
              ))}
            </View>

            {/* Accessibility overlay: per-point label reproduces the Recharts
                hover Tooltip (labelFormatter date + per-series value formatter). */}
            <View style={styles.seriesLayer}>
              {data.map((d, i) => {
                const insideText =
                  d.inside != null ? `${fmtInt(d.inside)}${tempUnit}` : '—';
                const outsideText =
                  d.outside != null ? `${fmtInt(d.outside)}${tempUnit}` : '—';
                return (
                  <View
                    // Index key mirrors the web data-index mapping; rows are static.
                    key={i}
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={`${formatTime(d.time)}: ${cabinLabel} ${insideText}, ${outsideLabel} ${outsideText}`}
                    style={styles.column}
                  />
                );
              })}
            </View>
          </View>

          {/* X axis (Recharts <XAxis dataKey="time" tickFormatter={formatTime} />) */}
          <View style={styles.xAxisRow}>
            {xTicks.map((d, i) => (
              <AppText
                key={i}
                numberOfLines={1}
                style={[styles.xAxisLabel, tickTextStyle]}
              >
                {formatTime(d.time)}
              </AppText>
            ))}
          </View>
        </View>
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

export default function ClimateHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime: formatTime } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;

  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useClimateHistory(vid > 0 ? String(vid) : '');

  const chartData = useMemo(
    () => buildChartData(data, toTemperatureDisplay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, tempUnit],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const latestInside = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].inside != null) return chartData[i].inside;
    }
    return null;
  }, [chartData]);

  const latestOutside = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].outside != null) return chartData[i].outside;
    }
    return null;
  }, [chartData]);

  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.climateHistory.cabin', 'Cabin'),
          value: latestInside != null ? fmtInt(latestInside) : '—',
          unit: tempUnit,
        },
        {
          label: t('widget.climateHistory.outside', 'Outside'),
          value: latestOutside != null ? fmtInt(latestOutside) : '—',
          unit: tempUnit,
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.climateHistory.noData', 'No climate history')}
          emptyIcon={<GlyphIcon glyph="🌡" color={colors.textMuted} size={20} />}
          stats={stats}
          chart={null}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.climateHistory.title', 'Climate History')}
      icon={<GlyphIcon glyph="🌡" color={colors.accent} size={14} />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.climateHistory.noData', 'No climate history')}
        emptyIcon={<GlyphIcon glyph="🌡" color={colors.textMuted} size={20} />}
        stats={stats}
        chart={
          <WidgetAreaChart
            data={chartData}
            tick={tick}
            formatTime={formatTime}
            tempUnit={tempUnit}
            t={t}
          />
        }
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
    width: 35, // YAxis width={35}
  },
  tickText: {
    color: colors.textMuted,
  },
  plotBody: {
    flex: 1,
  },
  areasRow: {
    flex: 1,
    position: 'relative',
  },
  seriesLayer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
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
  column: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 1,
  },
  areaFill: {
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    borderTopWidth: 2, // web <Area strokeWidth={2}>
    minHeight: 2,
    width: '100%',
  },
  xAxisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  xAxisLabel: {
    color: colors.textMuted,
    flex: 1,
    textAlign: 'center',
  },
});
