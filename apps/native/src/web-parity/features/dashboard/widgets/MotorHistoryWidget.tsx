// Native parity port of web/src/features/dashboard/widgets/MotorHistoryWidget.tsx.
//
// The web module is the dashboard "Motor History" widget. It reads the motor
// telemetry history (GET /api/v1/motor?vehicle_id={id}&limit=200) for the
// selected (or first) vehicle, turns the raw MotorSnapshot[] into time-sorted
// chart data (torque Nm, stator temp converted SI→display, gear, lateral and
// longitudinal g) and renders one of two layouts driven by the grid `size.cols`:
//   • Compact (cols <= 1): a WidgetChartSummary with the two latest summary
//     stats (Torque / Stator) and no chart, or an EmptyState when there is no
//     history.
//   • Standard (cols 2) / Wide (cols >= 3): the same two summary stats plus a
//     dual-axis time-series chart — a cyan torque line and an orange stator-temp
//     line, a red "danger zone" band above 100 °C (converted to the display
//     unit), and, on wide layouts, dashed lateral- and longitudinal-g overlays
//     plotted against the torque (left) axis — or an EmptyState when empty.
// Stator temperature is stored SI (°C) and converted at the display boundary to
// the user's temperature preference; the 100 °C danger threshold is converted
// the same way so the band tracks the unit.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • @/components/charts ComposedChart/Line/XAxis/YAxis/Tooltip/ReferenceArea/
//     ResponsiveContainer + chartGrid/chartMargin/axisTick/axisTickSm/
//     chartAnimation/fmt -> a native MotorHistoryChart. React Native ships no
//     Recharts/SVG, so the chart is projected with absolute-positioned <View>
//     line segments (the same technique as the ported Sparkline/MiniChart):
//     two independent scales (torque on the left auto-domain — shared by the
//     g-force overlays exactly like the web `yAxisId="torque"` — and stator temp
//     on a fixed [0, tempMax] domain matching the web right YAxis), the danger
//     band as a translucent red strip between y(dangerThreshold) and y(tempMax),
//     each series' `connectNulls` reproduced by projecting only the non-null
//     samples in order, and `fmt(v,0)` axis end-labels for the torque max (Nm)
//     and temp max (unit). The recharts hover Tooltip and its per-series
//     value/label formatter have no touch analog; the formatter's intent (which
//     line is which, with its unit) is surfaced as a static colour-keyed legend,
//     and the latest torque/stator values it would show on hover are already in
//     the summary-stat row. `chartGrid`/`chartMargin`/`chartAnimation` and the
//     `tick = isWide ? axisTick : axisTickSm` recharts style objects are
//     presentational-only and collapse to the native chart's fixed styling.
//   • ./shared WidgetChartSummary + ChartSummaryStat -> a local native
//     WidgetChartSummary (2-up stat row + optional chart slot, or an EmptyState
//     when `isEmpty`) and the ChartSummaryStat type ported verbatim.
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly
//     the props this call site uses (title/icon/loading/error/updatedAt/
//     isFetching/isStale/isError/onRefresh/children): Skeleton while loading, an
//     inline error block on error, a header row (icon + uppercase title +
//     freshness/refresh affordance) when titled, else an overlay freshness chip.
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local
//     types (the shared registry types module is not yet in the parity tree).
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?) returns the fallback (or key),
//     preserving every translation key verbatim.
//   • lucide-react Cog -> the app SemanticIcon 'settings' glyph rendered as a
//     colour-tinted AppText (GlyphIcon): accent (text-neon-cyan) in the header,
//     muted in the EmptyState slot (the web `h-5 w-5` icon carries no colour).
//   • @/hooks/useUnits (unitPrefs.temperature) + @/lib/unitConversion
//     convertTempFromSI -> inlined and derived from the native useSettings()
//     query exactly like the web hook (unit_of_temp 'F' -> '°F' else '°C';
//     °F = c*9/5+32).
//   • @/hooks/useDateFormat (formatDateTime) -> inlined from @/lib/dateFormat's
//     formatDateTime option object ({year,month:'short',day,hour:'2-digit',
//     minute:'2-digit'}, "—" for missing/invalid) with the locale threaded from
//     useSettings(); RN ships no ported useTimezone so the device zone is used
//     (KioskOverlay/ChargePlansWidget precedent).
//   • @/lib/numberFormat fmtNumber -> inlined locale-aware fixed-decimal helper
//     (min === max fraction digits; non-finite -> 0; bad locale -> en-US).
//   • @/api/hooks/useVehicles useMotorHistory + useVehicles -> the already-ported
//     native parity hooks (same names / return shapes / SI MotorSnapshot fields).
//   • DOM <div>/<span> + Tailwind classes -> React Native View/AppText with
//     StyleSheet tokens. The DataFreshness header indicator is computed once at
//     render (no 30s interval) to avoid a dangling timer under
//     --detectOpenHandles.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {
  useMotorHistory,
  useVehicles,
  type MotorSnapshot,
} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';

const DEFAULT_LOCALE = 'en-US';

// Recharts series colours, preserved verbatim from the source.
const SERIES_COLORS = {
  torque: '#06b6d4',
  statorTemp: '#f97316',
  lateralG: '#a78bfa',
  longitudinalG: '#34d399',
} as const;

// Danger-zone threshold in Celsius (100°C) — converted to display unit for
// rendering. Preserved verbatim from the source.
const DANGER_TEMP_C = 100;

const CHART_HEIGHT = 132;

/* ─── ./types (dashboard widget registry types, ported verbatim) ─────────── */

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

/* ─── ./shared ChartSummaryStat (ported verbatim) ────────────────────────── */

export interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

/* ─── chart datum (ported verbatim from the source) ──────────────────────── */

interface ChartDatum {
  time: string;
  torque: number | null;
  statorTemp: number | null;
  gear: string | null;
  lateralG: number | null;
  longitudinalG: number | null;
}

/* ─── i18n fallback (web react-i18next useTranslation/TFunction) ─────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation('dashboard'): the parity
// bundle ships no i18n runtime, so `t` returns the English fallback (or the key)
// while preserving every key at the call site.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtNumber ───────────────────────────────── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtNumber: locale-aware separators with a fixed
// fraction-digit count (min === max), falling back to en-US for bad locales.
function fmtNumber(value: unknown, decimals: number, locale: string): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

/* ─── inlined @/lib/unitConversion + @/hooks/useUnits (temperature) ───────── */

type TemperatureUnitPref = '°C' | '°F';

// Convert temperature from SI Celsius to the user's display unit.
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

interface UnitPrefs {
  temperature: TemperatureUnitPref;
  locale: string;
}

// web useUnits derive* helpers: unit_of_temp 'F' -> '°F' else '°C';
// empty locale -> 'en-US'.
function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// Native bridge mirroring the web useUnits() surface this widget reads
// (unitPrefs.temperature), derived from the native useSettings() query.
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  return {
    unitPrefs: {
      temperature: deriveTemperature(settings?.unit_of_temp),
      locale: deriveLocale(settings?.locale),
    },
  };
}

/* ─── inlined @/hooks/useDateFormat formatDateTime ───────────────────────── */

type DateInput = string | Date | null | undefined;

// web @/lib/dateFormat formatDateTime: "Apr 4, 2026, 12:00 PM" (locale-driven);
// "—" for missing/invalid. The web useDateFormat also binds an IANA timezone; RN
// ships no ported useTimezone, so the device zone is used while the locale is
// threaded from settings.
function libFormatDateTime(value: DateInput, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Native bridge mirroring the web useDateFormat().formatDateTime, with the
// locale threaded from useSettings().
function useDateFormat(): {formatDateTime: (value: DateInput) => string} {
  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);
  const formatDateTime = useCallback(
    (value: DateInput) => libFormatDateTime(value, locale),
    [locale],
  );
  return {formatDateTime};
}

/* ─── buildChartData (ported verbatim from the source) ───────────────────── */

/** Convert raw MotorSnapshot[] into sorted chart data. */
function buildChartData(
  data: MotorSnapshot[] | undefined,
  toTemperatureDisplay: (c: number) => number,
): ChartDatum[] {
  const items = data ?? [];
  return items
    .filter(d => d.ts || d.created_at)
    .map(d => {
      const ts = d.ts ?? d.created_at ?? '';
      const raw = d as unknown as Record<
        string,
        number | string | null | undefined
      >;
      const statorRaw = d.di_stator_temp ?? d.motor_temp_c_front ?? null;
      return {
        time: ts,
        torque: d.di_torque ?? null,
        statorTemp: statorRaw != null ? toTemperatureDisplay(statorRaw) : null,
        gear: d.gear ?? d.shift_state ?? null,
        lateralG: (raw.lateral_accel as number | null) ?? null,
        longitudinalG: (raw.longitudinal_accel as number | null) ?? null,
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

/* ─── tinted glyph icon (web lucide-react Cog) ───────────────────────────── */

function GlyphIcon({
  name,
  color,
  size,
}: {
  name: SemanticIconName;
  color: string;
  size: number;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 2}]}>
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

/* ─── DataFreshness chip (web @/components/data-display) ──────────────────── */

// Computed once at render (no interval) to avoid a dangling timer under
// --detectOpenHandles.
function relativeTime(updatedAt: number): string {
  if (!updatedAt || updatedAt <= 0) {
    return 'never';
  }
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  let label: string;
  let dotColor: string;
  if (isError) {
    label = 'Error';
    dotColor = colors.danger;
  } else if (isFetching) {
    label = 'Updating…';
    dotColor = colors.accent;
  } else if (isStale) {
    label = 'Stale';
    dotColor = colors.warning;
  } else {
    label = relativeTime(updatedAt);
    dotColor = colors.success;
  }

  return (
    <Pressable
      accessibilityLabel={`Data ${label}. Refresh.`}
      accessibilityRole="button"
      disabled={!onRefresh}
      onPress={onRefresh}
      style={styles.freshness}
      testID="widget-freshness">
      <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
      {compact ? null : (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

/* ─── WidgetShell (web ./WidgetShell, subset used by this widget) ─────────── */

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
    return <Skeleton height={120} rounded style={styles.shellSkeleton} />;
  }

  if (error) {
    return (
      <View style={styles.shellError} testID="widget-error">
        <AppText style={styles.shellErrorText} tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1-col widgets).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
      updatedAt={updatedAt ?? 0}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellTitleRow}>
            {icon}
            <AppText
              numberOfLines={1}
              style={styles.shellTitle}
              tone="muted"
              variant="caption">
              {title.toUpperCase()}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : (
        freshnessEl && (
          <View pointerEvents="box-none" style={styles.shellFreshnessOverlay}>
            {freshnessEl}
          </View>
        )
      )}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── WidgetChartSummary (web ./shared) ──────────────────────────────────── */

function WidgetChartSummary({
  stats,
  chart,
  compact,
  emptyMessage,
  emptyIcon,
  isEmpty,
}: {
  stats: ChartSummaryStat[];
  chart: ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  isEmpty?: boolean;
}) {
  if (isEmpty) {
    return (
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage ?? 'No data available'}
        style={styles.emptyState}
      />
    );
  }

  return (
    <View style={styles.summary}>
      {stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.statCol}>
              <AppText
                numberOfLines={1}
                style={styles.statLabel}
                tone="muted"
                variant="caption">
                {stat.label}
              </AppText>
              <AppText numberOfLines={1} style={styles.statValue} weight="semibold">
                {String(stat.value)}
                {stat.unit ? (
                  <AppText style={styles.statUnit} tone="muted" variant="caption">
                    {' '}
                    {stat.unit}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact && chart ? <View style={styles.chartSlot}>{chart}</View> : null}
    </View>
  );
}

/* ─── MotorHistoryChart (web @/components/charts ComposedChart) ───────────── */

interface ChartPoint {
  x: number;
  y: number;
}

interface ChartSegment {
  key: string;
  left: number;
  top: number;
  width: number;
  angle: string;
}

interface ChartSeries {
  key: string;
  color: string;
  strokeWidth: number;
  opacity: number;
  segments: ChartSegment[];
}

interface ChartGeometry {
  series: ChartSeries[];
  dangerBand: {top: number; height: number} | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Connect consecutive projected points with rounded, rotated <View> strokes —
// the same projection MiniChart/Sparkline use (RN has no SVG polyline).
function buildSegments(
  points: ChartPoint[],
  strokeWidth: number,
  prefix: string,
): ChartSegment[] {
  const segments: ChartSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    const deltaX = point.x - previous.x;
    const deltaY = point.y - previous.y;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (length <= 0) {
      continue;
    }
    const midpointX = previous.x + deltaX / 2;
    const midpointY = previous.y + deltaY / 2;
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    segments.push({
      angle: `${angle}deg`,
      key: `${prefix}-${i}`,
      left: midpointX - length / 2,
      top: midpointY - strokeWidth / 2,
      width: length,
    });
  }
  return segments;
}

// `connectNulls` parity: keep only the non-null samples, projected at their
// original index so the line bridges gaps exactly like the recharts series.
function collectPoints(
  data: ChartDatum[],
  xFor: (index: number) => number,
  pick: (datum: ChartDatum) => number | null,
  yFor: (value: number) => number,
): ChartPoint[] {
  const points: ChartPoint[] = [];
  data.forEach((datum, index) => {
    const value = pick(datum);
    if (value != null && Number.isFinite(value)) {
      points.push({x: xFor(index), y: yFor(value)});
    }
  });
  return points;
}

function buildChartGeometry(
  data: ChartDatum[],
  width: number,
  height: number,
  isWide: boolean,
  dangerThreshold: number,
  tempMax: number,
): ChartGeometry {
  if (width <= 0 || data.length === 0) {
    return {series: [], dangerBand: null};
  }

  const count = data.length;
  const xFor = (index: number) =>
    count === 1 ? width / 2 : (index / (count - 1)) * width;

  // Left (torque) axis domain — shared by the g-force overlays in wide mode,
  // exactly like the recharts `yAxisId="torque"`.
  const leftValues: number[] = [];
  data.forEach(datum => {
    if (datum.torque != null && Number.isFinite(datum.torque)) {
      leftValues.push(datum.torque);
    }
    if (isWide) {
      if (datum.lateralG != null && Number.isFinite(datum.lateralG)) {
        leftValues.push(datum.lateralG);
      }
      if (datum.longitudinalG != null && Number.isFinite(datum.longitudinalG)) {
        leftValues.push(datum.longitudinalG);
      }
    }
  });
  const leftMin = leftValues.length ? Math.min(...leftValues) : 0;
  const leftMax = leftValues.length ? Math.max(...leftValues) : 1;
  const leftRange = leftMax - leftMin || 1;
  const yLeft = (value: number) =>
    height - ((value - leftMin) / leftRange) * height;

  // Right (stator temp) axis — fixed [0, tempMax] domain matching the web YAxis.
  const tempSpan = tempMax || 1;
  const yTemp = (value: number) => height - (value / tempSpan) * height;

  const series: ChartSeries[] = [
    {
      key: 'torque',
      color: SERIES_COLORS.torque,
      strokeWidth: 2,
      opacity: 1,
      segments: buildSegments(
        collectPoints(data, xFor, d => d.torque, yLeft),
        2,
        'torque',
      ),
    },
    {
      key: 'statorTemp',
      color: SERIES_COLORS.statorTemp,
      strokeWidth: 2,
      opacity: 1,
      segments: buildSegments(
        collectPoints(data, xFor, d => d.statorTemp, yTemp),
        2,
        'statorTemp',
      ),
    },
  ];

  if (isWide) {
    series.push({
      key: 'lateralG',
      color: SERIES_COLORS.lateralG,
      strokeWidth: 1,
      // recharts strokeDasharray="4 2" has no rotated-View analog; approximate
      // the dashed g-force overlays with a thinner, semi-transparent stroke.
      opacity: 0.8,
      segments: buildSegments(
        collectPoints(data, xFor, d => d.lateralG, yLeft),
        1,
        'lateralG',
      ),
    });
    series.push({
      key: 'longitudinalG',
      color: SERIES_COLORS.longitudinalG,
      strokeWidth: 1,
      opacity: 0.8,
      segments: buildSegments(
        collectPoints(data, xFor, d => d.longitudinalG, yLeft),
        1,
        'longitudinalG',
      ),
    });
  }

  // Danger band: the recharts ReferenceArea between y1=dangerThreshold and
  // y2=tempMax on the temp scale.
  const bandTop = clamp(yTemp(tempMax), 0, height);
  const bandBottom = clamp(yTemp(dangerThreshold), 0, height);
  const dangerBand =
    bandBottom > bandTop ? {top: bandTop, height: bandBottom - bandTop} : null;

  return {series, dangerBand};
}

interface LegendEntry {
  key: string;
  color: string;
  label: string;
  unit: string;
}

function MotorHistoryChart({
  data,
  isWide,
  dangerThreshold,
  tempMax,
  formatTime,
  tempUnit,
  locale,
  t,
}: {
  data: ChartDatum[];
  isWide: boolean;
  dangerThreshold: number;
  tempMax: number;
  formatTime: (value: string) => string;
  tempUnit: string;
  locale: string;
  t: TFunc;
}) {
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const geometry = useMemo(
    () =>
      buildChartGeometry(
        data,
        width,
        CHART_HEIGHT,
        isWide,
        dangerThreshold,
        tempMax,
      ),
    [data, width, isWide, dangerThreshold, tempMax],
  );

  const axisLabels = useMemo(() => {
    if (data.length === 0) {
      return [];
    }
    const first = formatTime(data[0].time);
    const last = formatTime(data[data.length - 1].time);
    return data.length === 1 ? [first] : [first, last];
  }, [data, formatTime]);

  const legend: LegendEntry[] = [
    {
      key: 'torque',
      color: SERIES_COLORS.torque,
      label: t('widget.motorHistory.torque', 'Torque'),
      unit: 'Nm',
    },
    {
      key: 'statorTemp',
      color: SERIES_COLORS.statorTemp,
      label: t('widget.motorHistory.statorTemp', 'Stator'),
      unit: tempUnit,
    },
    ...(isWide
      ? [
          {
            key: 'lateralG',
            color: SERIES_COLORS.lateralG,
            label: t('widget.motorHistory.lateralG', 'Lateral G'),
            unit: 'g',
          },
          {
            key: 'longitudinalG',
            color: SERIES_COLORS.longitudinalG,
            label: t('widget.motorHistory.longG', 'Long. G'),
            unit: 'g',
          },
        ]
      : []),
  ];

  return (
    <View style={styles.chartWrap} testID="motor-history-chart">
      <View style={styles.chartAxisMaxRow}>
        <AppText style={styles.chartAxisMax} tone="muted" variant="caption">
          {`${fmtNumber(maxTorqueLabel(data, isWide), 0, locale)} Nm`}
        </AppText>
        <AppText style={styles.chartAxisMax} tone="muted" variant="caption">
          {`${fmtNumber(tempMax, 0, locale)}${tempUnit}`}
        </AppText>
      </View>

      <View onLayout={onLayout} style={styles.chartArea}>
        {geometry.dangerBand ? (
          <View
            pointerEvents="none"
            style={[
              styles.dangerBand,
              {height: geometry.dangerBand.height, top: geometry.dangerBand.top},
            ]}
            testID="motor-history-danger-band"
          />
        ) : null}
        {geometry.series.map(seriesItem =>
          seriesItem.segments.map(segment => (
            <View
              key={segment.key}
              pointerEvents="none"
              style={[
                styles.segment,
                {
                  backgroundColor: seriesItem.color,
                  borderRadius: seriesItem.strokeWidth / 2,
                  height: seriesItem.strokeWidth,
                  left: segment.left,
                  opacity: seriesItem.opacity,
                  top: segment.top,
                  transform: [{rotateZ: segment.angle}],
                  width: segment.width,
                },
              ]}
            />
          )),
        )}
      </View>

      {axisLabels.length > 0 ? (
        <View style={styles.chartXAxis}>
          {axisLabels.map((label, index) => (
            <AppText
              key={`${index}-${label}`}
              numberOfLines={1}
              style={styles.chartXLabel}
              tone="muted"
              variant="caption">
              {label}
            </AppText>
          ))}
        </View>
      ) : null}

      <View style={styles.legendRow}>
        {legend.map(entry => (
          <View key={entry.key} style={styles.legendItem}>
            <View style={[styles.legendDot, {backgroundColor: entry.color}]} />
            <AppText
              numberOfLines={1}
              style={styles.legendLabel}
              tone="muted"
              variant="caption">
              {`${entry.label} (${entry.unit})`}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

// Largest value on the torque (left) axis — torque plus the g-force overlays in
// wide mode — used for the left axis end-label (recharts `fmt(v,0)` tick).
function maxTorqueLabel(data: ChartDatum[], isWide: boolean): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const datum of data) {
    if (datum.torque != null && datum.torque > max) {
      max = datum.torque;
    }
    if (isWide) {
      if (datum.lateralG != null && datum.lateralG > max) {
        max = datum.lateralG;
      }
      if (datum.longitudinalG != null && datum.longitudinalG > max) {
        max = datum.longitudinalG;
      }
    }
  }
  return Number.isFinite(max) ? max : 0;
}

/* ─── MotorHistoryWidget ─────────────────────────────────────────────────── */

export default function MotorHistoryWidget({vehicleId, size}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {formatDateTime: formatTime} = useDateFormat();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );

  const tempUnit = unitPrefs.temperature;
  const locale = unitPrefs.locale;

  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useMotorHistory(vid, 200);

  const chartData = useMemo(
    () => buildChartData(data, toTemperatureDisplay),
    [data, toTemperatureDisplay],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Latest values for summary stats
  const latestTorque = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      const value = chartData[i].torque;
      if (value != null) return value;
    }
    return null;
  }, [chartData]);

  const latestStatorTemp = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      const value = chartData[i].statorTemp;
      if (value != null) return value;
    }
    return null;
  }, [chartData]);

  const dangerThreshold = useMemo(
    () => toTemperatureDisplay(DANGER_TEMP_C),
    [toTemperatureDisplay],
  );

  // Compute Y-axis domain for stator temp so the danger band renders correctly
  const tempMax = useMemo(() => {
    let max = dangerThreshold + 20;
    for (const d of chartData) {
      if (d.statorTemp != null && d.statorTemp > max) max = d.statorTemp;
    }
    return Math.ceil(max);
  }, [chartData, dangerThreshold]);

  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.motorHistory.torque', 'Torque'),
          value: latestTorque != null ? fmtNumber(latestTorque, 0, locale) : '—',
          unit: 'Nm',
        },
        {
          label: t('widget.motorHistory.statorTemp', 'Stator'),
          value:
            latestStatorTemp != null
              ? fmtNumber(latestStatorTemp, 0, locale)
              : '—',
          unit: tempUnit,
        },
      ]
    : [];

  const shellProps = {
    loading: isLoading,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <WidgetChartSummary
          compact
          chart={null}
          emptyIcon={
            <GlyphIcon color={colors.textMuted} name="settings" size={18} />
          }
          emptyMessage={t('widget.motorHistory.noData', 'No motor history')}
          isEmpty={!hasData}
          stats={stats}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      {...shellProps}
      icon={<GlyphIcon color={colors.accent} name="settings" size={13} />}
      title={t('widget.motorHistory.title', 'Motor History')}>
      <WidgetChartSummary
        chart={
          <MotorHistoryChart
            data={chartData}
            dangerThreshold={dangerThreshold}
            formatTime={formatTime}
            isWide={isWide}
            locale={locale}
            t={t}
            tempMax={tempMax}
            tempUnit={tempUnit}
          />
        }
        emptyIcon={
          <GlyphIcon color={colors.textMuted} name="settings" size={18} />
        }
        emptyMessage={t('widget.motorHistory.noData', 'No motor history')}
        isEmpty={!hasData}
        stats={stats}
      />
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  glyph: {
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // WidgetShell
  shell: {
    flex: 1,
    position: 'relative',
  },
  shellSkeleton: {
    height: '100%',
    minHeight: 120,
  },
  shellError: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellErrorText: {
    textAlign: 'center',
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // DataFreshness
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  freshnessLabel: {
    fontSize: 10,
  },
  // WidgetChartSummary
  emptyState: {
    paddingVertical: spacing.md,
  },
  summary: {
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statCol: {
    flex: 1,
    minWidth: 0,
  },
  statLabel: {
    fontSize: 10,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  statUnit: {
    fontSize: 10,
  },
  chartSlot: {
    flex: 1,
    marginTop: spacing.sm,
    minHeight: CHART_HEIGHT,
  },
  // MotorHistoryChart
  chartWrap: {
    flex: 1,
  },
  chartAxisMaxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chartAxisMax: {
    fontSize: 9,
  },
  chartArea: {
    height: CHART_HEIGHT,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  dangerBand: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  segment: {
    position: 'absolute',
  },
  chartXAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  chartXLabel: {
    fontSize: 9,
    maxWidth: '48%',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  legendDot: {
    borderRadius: 2,
    height: 4,
    width: 12,
  },
  legendLabel: {
    fontSize: 9,
  },
});
