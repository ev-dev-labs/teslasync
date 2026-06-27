// Native parity port of web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx.
//
// The web widget is a dashboard tile that plots a vehicle's 4-corner tire
// pressure history as a multi-series Recharts <LineChart> (FL/FR/RL/RR), with
// two recommended-range <ReferenceLine>s, an axis pair, a hover <Tooltip>, and a
// <WidgetChartSummary> header strip of the latest per-corner values. Data comes
// from useTirePressureHistory(vid) (vid falls back to the first vehicle), and
// every plotted/displayed value is projected from SI Pascals to the user's
// preferred pressure unit via usePressureFormat()'s toPressureValue, formatted
// with fmtNumber, and timestamped through useDateFormat()'s formatDateTime.
//
// React Native has no DOM, no Recharts and no SVG primitive, so — mirroring the
// sibling native ports (DriveScoreGaugeWidget, SignalHealthWidget,
// LifetimeStatsWidget) — every web dependency with no native port is rebuilt
// inline with React Native primitives, AppText, the repo SemanticIcon glyphs and
// the design tokens. The only deps kept as real imports are the ones that
// already have a native parity module: useTirePressureHistory
// (../../../api/hooks/useVehicleSystems), useVehicles
// (../../../api/hooks/useVehicles) and useSettings
// (../../../api/hooks/useSettings — the source of unit_of_pressure + locale that
// the web usePressureFormat/useDateFormat hooks read through useUnits/useSettings).
//
// The Recharts <LineChart> is replaced by an inline native-safe multi-series
// line plot (<TirePressureChart>): each corner series is projected onto a shared,
// data-driven Y domain and drawn as rotated <View> line segments (the same
// technique the repo's native parity <Sparkline> uses), null gaps are bridged
// (connectNulls), the two recommended-range reference lines are drawn only when
// they fall inside the data domain (Recharts ReferenceLine ifOverflow="discard"
// default), and a colour legend stands in for the hover tooltip's name→colour
// mapping. An accessibility label exposes the same numbers as a visible/audible
// data alternative.
//
// Line-by-line coverage of the source:
//   L1     `import { useMemo }` -> kept (plus useCallback/useEffect/useRef/
//          useState/ReactNode for the inlined chart layout, WidgetShell and i18n
//          fallback).
//   L2     useTranslation('dashboard') -> useNativeTranslationFallback; the
//          'dashboard' namespace is retained (TIRE_PRESSURE_HISTORY_WIDGET_I18N_NAMESPACE)
//          and every i18n key is preserved with its English fallback returned verbatim.
//   L3     lucide-react CircleDot -> repo SemanticIcon 'tirePressure' glyph
//          (TIRE_GLYPH 'TP') — the closest native glyph to lucide's tire dot;
//          rendered tone="accent" to keep the source's text-neon-cyan header hue.
//   L4-7   @/components/charts (LineChart/Line/XAxis/YAxis/Tooltip/ReferenceLine/
//          ResponsiveContainer + chartGrid/chartMargin/axisTick/axisTickSm/
//          chartAnimation/fmt) -> all Recharts/DOM-only; replaced by the inline
//          native <TirePressureChart>. `fmt` is reproduced as fmtChart (fmtNumber
//          at the resolved locale); axisTick/axisTickSm map to AXIS_FONT_WIDE/SM.
//   L8     useTirePressureHistory -> native '../../../api/hooks/useVehicleSystems'.
//   L9     useVehicles -> native '../../../api/hooks/useVehicles'.
//   L10    usePressureFormat -> inline useNativePressureFormat (derivePressure +
//          convertPressureFromSI, read off the native useSettings() — exactly the
//          chain web usePressureFormat -> useUnits -> useSettings resolves).
//   L11    useDateFormat -> inline formatDateTime + useResolvedLocale (locale from
//          native useSettings; tz preference is not wired natively so the device
//          zone is used — documented in the sidecar).
//   L12    fmtNumber from @/lib/numberFormat -> inline fmtNumber (safeNumber +
//          locale-grouped fixed precision, en-US fallback), matching the web util.
//   L13    ./shared WidgetChartSummary + ChartSummaryStat -> inline native
//          WidgetChartSummary (stat strip + chart slot, compact/empty gating) and
//          the mirrored ChartSummaryStat interface.
//   L14    ./WidgetShell -> inline native WidgetShell (loading/error/freshness
//          pill + justUpdated pulse) — same parity used across the native widgets.
//   L15    ./types WidgetProps -> inline WidgetSize/WidgetConfig/WidgetProps mirror.
//   L17-18 RECOMMENDED_RANGE_BAR { low: 2.4, high: 2.8 } -> ported verbatim.
//   L20-25 TIRE_COLORS { fl #3b82f6, fr #06b6d4, rl #22c55e, rr #a855f7 } -> verbatim.
//   L27-33 ChartDatum interface -> ported verbatim.
//   L35-50 buildChartData(data, toPressureValue): filter rows with a timestamp,
//          map each to {time, fl/fr/rl/rr: toPressureValue(corner)}, sort by
//          time.localeCompare -> ported verbatim.
//   L52-58 latestNonNull(data, key): last non-null corner value -> ported verbatim.
//   L60-65 component head: t, vehicles, vid = vehicleId ?? vehicles?.[0]?.id ?? 0,
//          { pressureUnit, toPressureValue }, formatDateTime -> ported.
//   L67    formatTime(ts) = formatDateTime(ts) -> ported (locale-bound).
//   L69-77 useTirePressureHistory(vid>0?String(vid):'') destructure (data/
//          isLoading/isFetching/isStale/isError/dataUpdatedAt/refetch) -> verbatim.
//   L79-82 chartData useMemo(buildChartData(data, toPressureValue)) -> verbatim.
//   L84-86 hasData / isCompact (cols<=1) / isWide (cols>=3) -> ported verbatim.
//   L88-91 latestFL/FR/RL/RR useMemo(latestNonNull(chartData, key)) -> verbatim.
//   L93-94 refLow/refHigh = toPressureValue(range*100_000) ?? range -> verbatim.
//   L96-97 formatPressure(val) = val!=null ? fmtNumber(val,1) : '—' -> verbatim.
//   L99-106 stats: ChartSummaryStat[] (FL/FR/RL/RR latest + pressureUnit, [] when
//          !hasData) -> ported verbatim with the same i18n keys.
//   L108   tick = isWide ? axisTick : axisTickSm -> AXIS font size selection.
//   L110-164 chart = <ResponsiveContainer><LineChart>… (grid, X/Y axes,
//          tooltip, the two reference lines, the 4 connectNulls lines) -> rebuilt
//          as <TirePressureChart> (shared-domain rotated-segment series + range
//          reference lines + legend + accessible data alternative).
//   L166-186 isCompact branch: <WidgetShell …freshness><WidgetChartSummary compact
//          isEmpty stats chart={null}> -> ported (compact => stat strip only).
//   L188-207 standard branch: <WidgetShell title icon …><WidgetChartSummary
//          isEmpty stats chart={chart}> -> ported (stat strip + native chart).
//   L208   component close -> ported.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/SVG, no Leaflet, no
// framer-motion and no web UI components are imported — only RN primitives plus
// existing apps/native components (AppText, SemanticIcon), tokens and native hooks.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
} from 'react-native';

import {useTirePressureHistory} from '../../../api/hooks/useVehicleSystems';
import type {TirePressureReading} from '../../../api/hooks/useVehicleSystems';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` usage exactly.
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

// Mirrored field-for-field from web ./types so the port stays self-contained.
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ------------------------------------------------------------------ */
/*  ./shared WidgetChartSummary mirror                                 */
/* ------------------------------------------------------------------ */

// Mirrored from web ./shared so the stat-strip contract is identical.
interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

/* ------------------------------------------------------------------ */
/*  Unit + number + date helpers (@/lib/unitConversion, numberFormat,  */
/*  dateFormat, usePressureFormat, useDateFormat)                      */
/* ------------------------------------------------------------------ */

// web unitConversion SI pressure denominators (1 psi = 6.894757 kPa, 1 bar = 100 kPa).
const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;

type PressureUnitPref = 'kPa' | 'psi' | 'bar';

// Parity for @/lib/unitConversion convertPressureFromSI(kpa, to): the web hook
// feeds this the raw SI source value exactly as the source does, so the projected
// number matches the web widget bit-for-bit regardless of source scale.
function convertPressureFromSI(kpa: number, to: PressureUnitPref): number {
  switch (to) {
    case 'kPa':
      return kpa;
    case 'psi':
      return kpa / KPA_PER_PSI;
    case 'bar':
      return kpa / KPA_PER_BAR;
  }
}

// Parity for useUnits' derivePressure(settings.unit_of_pressure): 'psi' only when
// the user prefers psi, otherwise 'bar' (the web default).
function derivePressure(unitOfPressure: string | undefined): PressureUnitPref {
  return unitOfPressure === 'psi' ? 'psi' : 'bar';
}

// Parity for useUnits' deriveLocale(settings.locale): a non-empty locale tag wins,
// else 'en-US'.
function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0 ? locale : 'en-US';
}

// web safeNumber: non-finite / non-number -> 0.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtNumber(v, decimals, locale): locale-grouped
// fixed-precision string, falling back to en-US when Intl rejects the tag.
function fmtNumber(value: unknown, decimals = 0, locale = 'en-US'): string {
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

// web @/lib/dateFormat formatDateTime: '—' for empty/invalid, else a localized
// "Apr 4, 2026, 06:30 PM"-style string. Native parity omits the user tz pref
// (not wired natively) and renders in the device zone.
function formatDateTime(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return d.toLocaleString(locale, opts);
  } catch {
    return d.toLocaleString('en-US', opts);
  }
}

// Parity for @/hooks/usePressureFormat: { pressureUnit, toPressureValue } resolved
// off the native useSettings() query (the same source useUnits reads). The
// react-query cache dedupes the settings request shared with useResolvedLocale.
function useNativePressureFormat(): {
  pressureUnit: PressureUnitPref;
  toPressureValue: (pa: number | null | undefined) => number | null;
} {
  const {data: settings} = useSettings();
  const pressureUnit = derivePressure(settings?.unit_of_pressure);

  const toPressureValue = useCallback(
    (pa: number | null | undefined): number | null => {
      if (pa == null || !Number.isFinite(pa)) return null;
      return convertPressureFromSI(pa, pressureUnit);
    },
    [pressureUnit],
  );

  return useMemo(
    () => ({pressureUnit, toPressureValue}),
    [pressureUnit, toPressureValue],
  );
}

// Parity for the locale half of @/hooks/useDateFormat / @/lib/numberFormat global
// locale — read off the same native useSettings() query.
function useResolvedLocale(): string {
  const {data: settings} = useSettings();
  return deriveLocale(settings?.locale);
}

/* ------------------------------------------------------------------ */
/*  Pure logic (ported verbatim)                                       */
/* ------------------------------------------------------------------ */

/** Recommended PSI range in bar (2.4–2.8 bar ≈ 35–41 psi) */
const RECOMMENDED_RANGE_BAR = {low: 2.4, high: 2.8} as const;

const TIRE_COLORS = {
  fl: '#3b82f6', // blue
  fr: '#06b6d4', // cyan
  rl: '#22c55e', // green
  rr: '#a855f7', // purple
} as const;

interface ChartDatum {
  time: string;
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
}

type ChartSeriesKey = keyof Omit<ChartDatum, 'time'>;

function buildChartData(
  data: TirePressureReading[] | undefined,
  toPressureValue: (bar: number | null | undefined) => number | null,
): ChartDatum[] {
  const items = data ?? [];
  return items
    .filter(d => d.timestamp)
    .map(d => ({
      time: d.timestamp,
      fl: toPressureValue(d.frontLeft),
      fr: toPressureValue(d.frontRight),
      rl: toPressureValue(d.rearLeft),
      rr: toPressureValue(d.rearRight),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

function latestNonNull(data: ChartDatum[], key: ChartSeriesKey): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i][key];
    if (v != null) return v;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  lucide CircleDot -> repo SemanticIcon glyph                        */
/* ------------------------------------------------------------------ */

// web rendered <CircleDot className="… text-neon-cyan" /> — a tire dot in the
// accent (cyan) hue. The closest native glyph is 'tirePressure' ('TP').
const TIRE_GLYPH = getSemanticIconDefinition('tirePressure').glyph;

// web axisTick fontSize 11 / axisTickSm fontSize 10 (chartUtils).
const AXIS_FONT_WIDE = 11;
const AXIS_FONT_SM = 10;

const PLOT_HEIGHT = 150;
const SERIES_STROKE = 2;
const REF_COLOR = 'rgba(34,197,94,0.45)';

const SERIES_META: {key: ChartSeriesKey; label: string; color: string}[] = [
  {key: 'fl', label: 'FL', color: TIRE_COLORS.fl},
  {key: 'fr', label: 'FR', color: TIRE_COLORS.fr},
  {key: 'rl', label: 'RL', color: TIRE_COLORS.rl},
  {key: 'rr', label: 'RR', color: TIRE_COLORS.rr},
];

/* ------------------------------------------------------------------ */
/*  Native multi-series line chart (Recharts <LineChart> replacement)  */
/* ------------------------------------------------------------------ */

interface ChartSegment {
  key: string;
  left: number;
  top: number;
  width: number;
  angle: string;
  color: string;
}

interface ChartReferenceLine {
  key: string;
  top: number;
  label: string;
}

// Shared data-driven Y domain across all four corner series. Reference lines are
// kept only when they fall inside the domain — mirroring Recharts ReferenceLine's
// default ifOverflow="discard".
function computeDomain(data: ChartDatum[]): {min: number; max: number} | null {
  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    for (const meta of SERIES_META) {
      const v = d[meta.key];
      if (v != null && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return {min, max};
}

function buildSeriesSegments(
  data: ChartDatum[],
  domain: {min: number; max: number},
  width: number,
): ChartSegment[] {
  const range = domain.max - domain.min || 1;
  const n = data.length;
  const xFor = (index: number): number =>
    n <= 1 ? width / 2 : (index / (n - 1)) * width;
  const yFor = (value: number): number =>
    PLOT_HEIGHT - ((value - domain.min) / range) * PLOT_HEIGHT;

  const segments: ChartSegment[] = [];
  for (const meta of SERIES_META) {
    // connectNulls: keep only the points that have a value, bridging gaps.
    const points = data
      .map((d, index) => {
        const v = d[meta.key];
        return v != null && Number.isFinite(v)
          ? {x: xFor(index), y: yFor(v)}
          : null;
      })
      .filter((p): p is {x: number; y: number} => p !== null);

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length <= 0) continue;
      const midX = prev.x + dx / 2;
      const midY = prev.y + dy / 2;
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      segments.push({
        key: `${meta.key}-${i}`,
        left: midX - length / 2,
        top: midY - SERIES_STROKE / 2,
        width: length,
        angle: `${angle}deg`,
        color: meta.color,
      });
    }
  }
  return segments;
}

function buildReferenceLines(
  domain: {min: number; max: number},
  refLow: number,
  refHigh: number,
  minLabel: string,
  maxLabel: string,
): ChartReferenceLine[] {
  const range = domain.max - domain.min || 1;
  const yFor = (value: number): number =>
    PLOT_HEIGHT - ((value - domain.min) / range) * PLOT_HEIGHT;
  const lines: ChartReferenceLine[] = [];
  if (refLow >= domain.min && refLow <= domain.max) {
    lines.push({key: 'ref-low', top: yFor(refLow), label: minLabel});
  }
  if (refHigh >= domain.min && refHigh <= domain.max) {
    lines.push({key: 'ref-high', top: yFor(refHigh), label: maxLabel});
  }
  return lines;
}

interface TirePressureChartProps {
  data: ChartDatum[];
  refLow: number;
  refHigh: number;
  pressureUnit: string;
  axisFontSize: number;
  formatTime: (ts: string) => string;
  formatAxisValue: (value: number) => string;
  minLabel: string;
  maxLabel: string;
}

function TirePressureChart({
  data,
  refLow,
  refHigh,
  pressureUnit,
  axisFontSize,
  formatTime,
  formatAxisValue,
  minLabel,
  maxLabel,
}: TirePressureChartProps) {
  const [plotWidth, setPlotWidth] = useState(0);

  const domain = useMemo(() => computeDomain(data), [data]);

  const segments = useMemo(
    () =>
      domain && plotWidth > 0
        ? buildSeriesSegments(data, domain, plotWidth)
        : [],
    [data, domain, plotWidth],
  );

  const referenceLines = useMemo(
    () =>
      domain
        ? buildReferenceLines(domain, refLow, refHigh, minLabel, maxLabel)
        : [],
    [domain, refLow, refHigh, minLabel, maxLabel],
  );

  const onPlotLayout = useCallback((e: LayoutChangeEvent) => {
    setPlotWidth(e.nativeEvent.layout.width);
  }, []);

  const firstTime = data.length > 0 ? formatTime(data[0].time) : '';
  const lastTime = data.length > 0 ? formatTime(data[data.length - 1].time) : '';

  const a11yLabel = domain
    ? `Tire pressure history, ${data.length} points, range ${formatAxisValue(
        domain.min,
      )} to ${formatAxisValue(domain.max)} ${pressureUnit}`
    : 'Tire pressure history';

  return (
    <View style={styles.chartRoot}>
      <View style={styles.chartArea}>
        <View style={styles.yAxis}>
          <AppText
            numberOfLines={1}
            style={[styles.axisLabel, {fontSize: axisFontSize}]}
            tone="muted"
            variant="caption">
            {domain ? formatAxisValue(domain.max) : ''}
          </AppText>
          <AppText
            numberOfLines={1}
            style={[styles.axisLabel, {fontSize: axisFontSize}]}
            tone="muted"
            variant="caption">
            {domain ? formatAxisValue(domain.min) : ''}
          </AppText>
        </View>

        <View
          accessibilityRole="image"
          accessibilityLabel={a11yLabel}
          accessible
          onLayout={onPlotLayout}
          style={styles.plot}>
          <View pointerEvents="none" style={styles.gridLayer}>
            {GRID_LINES.map(line => (
              <View
                key={`grid-${line}`}
                style={[styles.gridLine, {top: `${line}%` as DimensionValue}]}
              />
            ))}
          </View>

          {referenceLines.map(ref => (
            <View
              key={ref.key}
              pointerEvents="none"
              style={[styles.refLineWrap, {top: ref.top}]}>
              <View style={styles.refLine} />
              <AppText style={styles.refLabel} tone="muted" variant="caption">
                {ref.label}
              </AppText>
            </View>
          ))}

          {segments.map(segment => (
            <View
              key={segment.key}
              pointerEvents="none"
              style={[
                styles.segment,
                {
                  backgroundColor: segment.color,
                  left: segment.left,
                  top: segment.top,
                  width: segment.width,
                  transform: [{rotateZ: segment.angle}],
                },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.xAxis}>
        <AppText
          numberOfLines={1}
          style={[styles.axisLabel, {fontSize: axisFontSize}]}
          tone="muted"
          variant="caption">
          {firstTime}
        </AppText>
        <AppText
          numberOfLines={1}
          style={[styles.axisLabel, styles.axisLabelEnd, {fontSize: axisFontSize}]}
          tone="muted"
          variant="caption">
          {lastTime}
        </AppText>
      </View>

      <View style={styles.legend}>
        {SERIES_META.map(meta => (
          <View key={meta.key} style={styles.legendItem}>
            <View
              style={[styles.legendDot, {backgroundColor: meta.color}]}
            />
            <AppText style={styles.legendLabel} tone="secondary" variant="caption">
              {meta.label}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const GRID_LINES = [25, 50, 75];

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback <EmptyState>                          */
/* ------------------------------------------------------------------ */

// web EmptyState(icon CircleDot, message): a centred glyph above a muted message.
function EmptyState({glyph, message}: {glyph: string; message: string}) {
  return (
    <View style={styles.emptyState}>
      <AppText style={styles.emptyGlyph} tone="muted" weight="bold">
        {glyph}
      </AppText>
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./shared <WidgetChartSummary>                              */
/* ------------------------------------------------------------------ */

// web WidgetChartSummary: when isEmpty -> EmptyState; else a column with a
// per-corner stat strip (always) and, when !compact, the chart slot below.
function WidgetChartSummary({
  stats,
  chart,
  compact,
  emptyMessage,
  emptyGlyph,
  isEmpty,
}: {
  stats: ChartSummaryStat[];
  chart: ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  emptyGlyph?: string;
  isEmpty?: boolean;
}) {
  if (isEmpty) {
    return (
      <EmptyState
        glyph={emptyGlyph ?? TIRE_GLYPH}
        message={emptyMessage ?? 'No data available'}
      />
    );
  }

  return (
    <View style={styles.summaryRoot}>
      {stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.statItem}>
              <AppText
                numberOfLines={1}
                style={styles.statLabel}
                tone="muted"
                variant="caption">
                {stat.label}
              </AppText>
              <AppText numberOfLines={1} style={styles.statValue} weight="semibold">
                {stat.value}
                {stat.unit ? (
                  <AppText style={styles.statUnit} tone="muted" variant="caption">
                    {` ${stat.unit}`}
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

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

function formatFreshness(updatedAt: number, t: NativeTFunction): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('widget.justNow', 'Just now');
  if (minutes < 60) return `${minutes}m ${t('widget.ago', 'ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${t('widget.ago', 'ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact: boolean;
}) {
  const t = useNativeTranslationFallback();
  const dotStyle = isError
    ? freshnessDotStyles.error
    : isFetching
      ? freshnessDotStyles.fetching
      : isStale
        ? freshnessDotStyles.stale
        : freshnessDotStyles.fresh;

  return (
    <Pressable
      accessibilityLabel={t('widget.refresh', 'Refresh')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, dotStyle]} />
      {!compact && updatedAt ? (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {formatFreshness(updatedAt, t)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

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
      <View style={styles.shellState}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.shellState}>
        <AppText tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
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
        <View style={styles.shellHeader}>
          <View style={styles.shellHeaderLeft}>
            {icon}
            <AppText style={styles.shellTitle} variant="caption" weight="semibold">
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.shellFreshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Widget                                                             */
/* ------------------------------------------------------------------ */

export default function TirePressureHistoryWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {pressureUnit, toPressureValue} = useNativePressureFormat();
  const locale = useResolvedLocale();

  const formatTime = useCallback(
    (ts: string): string => formatDateTime(ts, locale),
    [locale],
  );

  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useTirePressureHistory(vid > 0 ? String(vid) : '');

  const chartData = useMemo(
    () => buildChartData(data, toPressureValue),
    [data, toPressureValue],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const latestFL = useMemo(() => latestNonNull(chartData, 'fl'), [chartData]);
  const latestFR = useMemo(() => latestNonNull(chartData, 'fr'), [chartData]);
  const latestRL = useMemo(() => latestNonNull(chartData, 'rl'), [chartData]);
  const latestRR = useMemo(() => latestNonNull(chartData, 'rr'), [chartData]);

  const refLow =
    toPressureValue(RECOMMENDED_RANGE_BAR.low * 100_000) ??
    RECOMMENDED_RANGE_BAR.low;
  const refHigh =
    toPressureValue(RECOMMENDED_RANGE_BAR.high * 100_000) ??
    RECOMMENDED_RANGE_BAR.high;

  const formatPressure = (val: number | null): string =>
    val != null ? fmtNumber(val, 1, locale) : '—';

  const formatAxisValue = useCallback(
    (value: number): string => fmtNumber(value, 1, locale),
    [locale],
  );

  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.tirePressureHistory.fl', 'FL'),
          value: formatPressure(latestFL),
          unit: pressureUnit,
        },
        {
          label: t('widget.tirePressureHistory.fr', 'FR'),
          value: formatPressure(latestFR),
          unit: pressureUnit,
        },
        {
          label: t('widget.tirePressureHistory.rl', 'RL'),
          value: formatPressure(latestRL),
          unit: pressureUnit,
        },
        {
          label: t('widget.tirePressureHistory.rr', 'RR'),
          value: formatPressure(latestRR),
          unit: pressureUnit,
        },
      ]
    : [];

  const axisFontSize = isWide ? AXIS_FONT_WIDE : AXIS_FONT_SM;

  const chart = (
    <TirePressureChart
      axisFontSize={axisFontSize}
      data={chartData}
      formatAxisValue={formatAxisValue}
      formatTime={formatTime}
      maxLabel={t('widget.tirePressureHistory.max', 'Max')}
      minLabel={t('widget.tirePressureHistory.min', 'Min')}
      pressureUnit={pressureUnit}
      refHigh={refHigh}
      refLow={refLow}
    />
  );

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
          emptyGlyph={TIRE_GLYPH}
          emptyMessage={t(
            'widget.tirePressureHistory.noData',
            'No tire pressure history',
          )}
          isEmpty={!hasData}
          stats={stats}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      icon={
        <AppText style={styles.headerIcon} tone="accent" weight="bold">
          {TIRE_GLYPH}
        </AppText>
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.tirePressureHistory.title', 'Tire Pressure History')}
      updatedAt={dataUpdatedAt}>
      <WidgetChartSummary
        chart={chart}
        emptyGlyph={TIRE_GLYPH}
        emptyMessage={t(
          'widget.tirePressureHistory.noData',
          'No tire pressure history',
        )}
        isEmpty={!hasData}
        stats={stats}
      />
    </WidgetShell>
  );
}

TirePressureHistoryWidget.displayName = 'TirePressureHistoryWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const TIRE_PRESSURE_HISTORY_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  headerIcon: {
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 0.4,
  },

  // --- WidgetChartSummary ---
  summaryRoot: {
    flex: 1,
    gap: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  statItem: {
    flexGrow: 1,
    minWidth: 56,
  },
  statLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  statValue: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  statUnit: {
    fontSize: 10,
    fontWeight: '400',
  },
  chartSlot: {
    flex: 1,
    minHeight: 0,
    marginTop: spacing.xs,
  },

  // --- TirePressureChart ---
  chartRoot: {
    gap: spacing.sm,
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.xs,
  },
  yAxis: {
    height: PLOT_HEIGHT,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    minWidth: 28,
    paddingVertical: 2,
  },
  axisLabel: {
    lineHeight: 14,
  },
  axisLabelEnd: {
    textAlign: 'right',
  },
  plot: {
    flex: 1,
    height: PLOT_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  gridLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.border,
    opacity: 0.5,
  },
  refLineWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  refLine: {
    flex: 1,
    height: 1,
    backgroundColor: REF_COLOR,
  },
  refLabel: {
    fontSize: 9,
    lineHeight: 12,
    color: REF_COLOR,
    paddingRight: spacing.xs,
  },
  segment: {
    position: 'absolute',
    height: SERIES_STROKE,
    borderRadius: SERIES_STROKE / 2,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 32,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: spacing.xs,
    paddingLeft: 32,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 11,
    lineHeight: 14,
  },

  // --- EmptyState ---
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  emptyGlyph: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.5,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellPulse: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  shellState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },

  // --- DataFreshness ---
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
});

const freshnessDotStyles = StyleSheet.create({
  error: {
    backgroundColor: colors.danger,
  },
  fetching: {
    backgroundColor: colors.accent,
  },
  stale: {
    backgroundColor: colors.warning,
  },
  fresh: {
    backgroundColor: colors.success,
  },
});
