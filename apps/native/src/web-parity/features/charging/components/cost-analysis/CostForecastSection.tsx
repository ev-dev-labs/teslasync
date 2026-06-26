// Native parity port of
// web/src/features/charging/components/cost-analysis/CostForecastSection.tsx.
//
// Renders the charging cost-analysis "Cost Forecast" stack: a forecast chart
// panel (historical actual cost + projected forecast cost + 95% confidence
// band), the ForecastDetails group (charging breakdown, gas-vs-EV savings,
// insights), and a "Cost per kWh Trend" line panel. Each panel falls back to an
// EmptyState when its data threshold is unmet, exactly like the web file.
//
// Two web modules referenced here are NOT separate native conversion targets in
// the parity manifest (only CostForecastSection + LoadingSkeleton are), and the
// loop commits exactly one .tsx + one .parity.json per file. So, following the
// established precedent (SessionComparisonChart inlined its `./helpers`), the
// `./ForecastDetails` sibling component and the `@/types/charging`
// CostForecastData type tree are ported INLINE here rather than as extra files.
//
// The web file leans on browser-only dependencies absent from the native parity
// manifest (contract rules 4, 5 & 7); each is replaced with a React Native-safe
// equivalent and documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L1, L20 + ForecastDetails L1, L20) ->
//     inlined useNativeTranslation(): a stable (key, fallback?) => fallback ?? key
//     shim so every t('key', 'English') call keeps its English default and
//     translation-key intent (costAnalysis.forecast.* / 'Home' / 'Supercharger').
//   - lucide-react TrendingUp/Fuel/Lightbulb/Zap (web L2 + ForecastDetails L2)
//     -> the shared native SemanticIcon (trendUp / fuel / lightbulb / bolt),
//     decorative, since lucide SVG glyphs have no native renderer. The fixed
//     SemanticIcon tone map can't reproduce every neon hue (e.g. web's
//     text-neon-purple TrendingUp -> trendUp's success tone), but the decorative
//     icon-beside-title intent is preserved.
//   - `@/components/ui` GlassPanel (web L3, L31/L79 + ForecastDetails L3) -> the
//     shared native GlassPanel; the className 'p-6' -> a base padding of 24.
//   - `@/components/motion` FadeIn (web L4, L30/L78 + ForecastDetails L4) -> an
//     internal Animated.View opacity 0->1 mount fade (no delay, matching the web
//     defaults at these call sites).
//   - `@/components/feedback` EmptyState (web L5, L70/L94 + ForecastDetails L6)
//     -> the shared native EmptyState. The web calls pass only `message`; the
//     native EmptyState requires a `title`, so a concise title key is synthesized
//     alongside each verbatim message (ChartContainer/HeroGauges convention).
//   - `@/components/charts` Recharts ComposedChart/Area/Line/XAxis/YAxis/
//     CartesianGrid/Tooltip/Legend/ResponsiveContainer + ChartTooltip/chartGrid/
//     axisTickSm/AREA_DEFAULTS/areaGradient (web L6-10, L37-92) and the
//     ForecastDetails PieChart/Pie/Cell donut -> native View-primitive plots.
//     Recharts/SVG are unavailable on native, so: line series are projected into
//     a measured (onLayout) plot and drawn as rounded rotated absolute segments
//     (the shared MiniChart technique); the projected forecast line keeps its
//     strokeDasharray "8 4" via real dash rects; the stacked ci_low/ci_band
//     confidence area becomes per-forecast-month translucent range bars spanning
//     cost_low..cost_high; connectNulls={false} is honored (segments never bridge
//     undefined gaps, so actual covers the historical span and forecast the
//     projection span); the cost_per_kwh Line dots (r=3) become small circles;
//     faint horizontal gridlines stand in for CartesianGrid; min/0 + max y-axis
//     ticks carry the currency symbol (web YAxis unit="$"); month x-axis labels
//     and a series legend are rendered explicitly. The donut becomes a home-vs-
//     supercharger proportion split bar plus the two avg-$/kWh legend rows.
//     Recharts hover Tooltip needs a DOM pointer and is unavailable on native --
//     values are conveyed by ticks, labels, the legend and accessibility labels.
//   - `@/hooks/useChartPalette` (web L11, L21) -> inlined useChartPalette()
//     reading chart_palette from the ported useSettings and resolving to the
//     shared native CHART_COLORS (cb-safe default) / NEON_COLORS, matching the
//     web resolver. palette[0] feeds the "Actual Cost" series colour.
//   - `@/types/charging` CostForecastData + CostHistoricalMonth/CostForecastMonth/
//     CostBreakdownData/ChargerCategoryData/GasComparisonData (web L12) -> ported
//     inline (unchanged snake_case shape).
//   - ForecastDetails `@/components/data-display` AnimatedNumber + Currency and
//     `@/lib/numberFormat` fmtNumber + `@/hooks/useFormatting` currencySymbol ->
//     the ported native AnimatedNumber / Currency and useFormatPrefs (fmt +
//     currencySymbol), so the rendered strings match the web renderers.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components are
// imported -- only react, react-native primitives, the shared native AppText /
// GlassPanel / EmptyState / SemanticIcon / theme tokens, and the ported parity
// AnimatedNumber / Currency / format primitives / chart palette.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import {CHART_COLORS, NEON_COLORS} from '../../../../components/charts/chartUtils';
import {AnimatedNumber} from '../../../../components/data-display/AnimatedNumber';
import {Currency} from '../../../../components/data-display/format/Currency';
import {useFormatPrefs} from '../../../../components/data-display/format/_formatPrimitives';

// ── @/types/charging (ported inline; not a separate native target) ──

interface CostHistoricalMonth {
  month: string;
  cost: number;
  kwh: number;
  sessions: number;
  cost_per_kwh: number;
}

interface CostForecastMonth {
  month: string;
  cost: number;
  cost_low: number;
  cost_high: number;
  kwh: number;
}

interface ChargerCategoryData {
  pct: number;
  avg_cost_per_kwh: number;
  monthly_avg: number;
}

interface CostBreakdownData {
  home: ChargerCategoryData;
  supercharger: ChargerCategoryData;
}

interface GasComparisonData {
  avg_km_per_month: number;
  gas_cost_per_month: number;
  ev_cost_per_month: number;
  monthly_savings: number;
  annual_savings: number;
  lifetime_savings: number;
}

interface CostForecastData {
  historical: CostHistoricalMonth[];
  forecast: CostForecastMonth[];
  breakdown: CostBreakdownData;
  gas_comparison: GasComparisonData;
  insights: string[];
}

interface CostForecastSectionProps {
  forecastData: CostForecastData | undefined;
}

type NativeTFunction = (key: string, fallback?: string) => string;

// Tailwind / neon palette hexes used by the web classes, kept verbatim.
const FORECAST_PURPLE = '#a855f7'; // text-neon-purple / forecast line + band
const FORECAST_BAND_FILL = 'rgba(168, 85, 247, 0.18)'; // areaGradient forecastBand
const FORECAST_BAND_SWATCH = 'rgba(168, 85, 247, 0.4)'; // legend chip for the band
const COST_PER_KWH_CYAN = '#06b6d4'; // cost_per_kwh line + dots
const HOME_GREEN = '#22c55e'; // donut Home cell (bg-green-500)
const SUPERCHARGER_AMBER = '#f59e0b'; // donut Supercharger cell (bg-amber-500)
const EMERALD_300 = '#6ee7b7'; // text-emerald-300 monthly savings
const RED_400 = '#f87171'; // text-red-400 gas cost
const GREEN_400 = '#4ade80'; // text-green-400 ev cost
const GREEN_SURFACE = 'rgba(16, 185, 129, 0.06)'; // bg-neon-green/[0.06]
const GREEN_BORDER = 'rgba(16, 185, 129, 0.16)'; // border-neon-green/10
const WHITE_SURFACE_04 = 'rgba(255, 255, 255, 0.04)'; // bg-white/[0.04]
const WHITE_SURFACE_03 = 'rgba(255, 255, 255, 0.03)'; // bg-white/[0.03]
const WHITE_BORDER_06 = 'rgba(255, 255, 255, 0.06)'; // border-white/[0.06]

// Plot geometry (native View-segment charts).
const Y_AXIS_WIDTH = 46;
const PLOT_PAD = 6;
const STROKE = 2;
const DOT_SIZE = 6;
const BAND_WIDTH = 14;
const FORECAST_PLOT_HEIGHT = 250; // web ResponsiveContainer height={300}
const TREND_PLOT_HEIGHT = 150; // web ResponsiveContainer height={200}
const FADE_DURATION_MS = 300;
const DASH_LEN = 8; // strokeDasharray "8 4"
const DASH_GAP = 4;

interface PlotPoint {
  x: number;
  y: number;
}

interface LineRect {
  angle: string;
  key: string;
  left: number;
  top: number;
  width: number;
}

interface PlotSeries {
  color: string;
  dashed?: boolean;
  dots?: boolean;
  key: string;
  values: Array<number | undefined>;
}

interface PlotBand {
  color: string;
  high: number;
  index: number;
  low: number;
}

interface MergedPoint {
  month: string;
  actual?: number;
  forecast?: number;
  ciLow?: number;
  ciHigh?: number;
}

// react-i18next useTranslation replacement: returns the English fallback (or the
// key when no fallback is supplied, mirroring web t('Home')) so the translation
// key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (key, fallback) => fallback ?? key;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// @/hooks/useChartPalette: resolve chart_palette to the matching palette,
// reusing the shared native cb-safe / neon palettes (cb-safe default).
function resolveChartPalette(pref: string | null | undefined): readonly string[] {
  return pref === 'neon' ? NEON_COLORS : CHART_COLORS;
}

function useChartPalette(): readonly string[] {
  const {data} = useSettings();
  return resolveChartPalette(data?.chart_palette);
}

// @/components/motion FadeIn: opacity 0->1 mount fade (no delay at these sites).
function FadeIn({children}: {children: ReactNode}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      duration: FADE_DURATION_MS,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={{opacity}}>{children}</Animated.View>;
}

// Project a series of optional values into the measured plot rectangle.
function projectPoints(
  values: Array<number | undefined>,
  pointCount: number,
  yMax: number,
  plotWidth: number,
  plotHeight: number,
): Array<PlotPoint | null> {
  const denomX = pointCount > 1 ? pointCount - 1 : 1;
  const range = yMax > 0 ? yMax : 1;
  const usableW = plotWidth - PLOT_PAD * 2;
  const usableH = plotHeight - PLOT_PAD * 2;
  return values.map((value, index) => {
    if (value == null || !Number.isFinite(value)) {
      return null;
    }
    const x =
      pointCount > 1 ? (index / denomX) * usableW + PLOT_PAD : plotWidth / 2;
    const y = plotHeight - PLOT_PAD - (value / range) * usableH;
    return {x, y};
  });
}

// Build absolute rounded line segments between consecutive non-null points.
// connectNulls={false}: a null breaks the line. `dashed` emits "8 4" dash rects.
function buildLineRects(
  points: Array<PlotPoint | null>,
  keyPrefix: string,
  dashed: boolean,
): LineRect[] {
  const rects: LineRect[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (!previous || !current) {
      continue;
    }
    const deltaX = current.x - previous.x;
    const deltaY = current.y - previous.y;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const angle = `${Math.atan2(deltaY, deltaX) * (180 / Math.PI)}deg`;
    if (!dashed) {
      rects.push({
        angle,
        key: `${keyPrefix}-${i}`,
        left: previous.x + deltaX / 2 - length / 2,
        top: previous.y + deltaY / 2 - STROKE / 2,
        width: length,
      });
      continue;
    }
    const unitX = length ? deltaX / length : 0;
    const unitY = length ? deltaY / length : 0;
    const step = DASH_LEN + DASH_GAP;
    let position = 0;
    let dashIndex = 0;
    while (position < length) {
      const dashLen = Math.min(DASH_LEN, length - position);
      const centerX = previous.x + unitX * (position + dashLen / 2);
      const centerY = previous.y + unitY * (position + dashLen / 2);
      rects.push({
        angle,
        key: `${keyPrefix}-${i}-${dashIndex}`,
        left: centerX - dashLen / 2,
        top: centerY - STROKE / 2,
        width: dashLen,
      });
      position += step;
      dashIndex += 1;
    }
  }
  return rects;
}

// A confidence range bar spanning cost_low..cost_high at a forecast month.
function buildBandRect(
  band: PlotBand,
  pointCount: number,
  yMax: number,
  plotWidth: number,
  plotHeight: number,
): {height: number; left: number; top: number; width: number} {
  const denomX = pointCount > 1 ? pointCount - 1 : 1;
  const range = yMax > 0 ? yMax : 1;
  const usableW = plotWidth - PLOT_PAD * 2;
  const usableH = plotHeight - PLOT_PAD * 2;
  const x =
    pointCount > 1 ? (band.index / denomX) * usableW + PLOT_PAD : plotWidth / 2;
  const yHigh = plotHeight - PLOT_PAD - (band.high / range) * usableH;
  const yLow = plotHeight - PLOT_PAD - (band.low / range) * usableH;
  return {
    height: Math.max(Math.abs(yLow - yHigh), 1),
    left: x - BAND_WIDTH / 2,
    top: Math.min(yHigh, yLow),
    width: BAND_WIDTH,
  };
}

interface LinePlotProps {
  accessibilityLabel: string;
  bands?: PlotBand[];
  currencySymbol: string;
  fmtTick: (value: number) => string;
  plotHeight: number;
  pointCount: number;
  series: PlotSeries[];
  xLabels: string[];
  yMax: number;
}

// Recharts ResponsiveContainer line/area chart replacement, built from measured
// View segments (no SVG/DOM). Hover tooltips are unavailable; the axis ticks,
// x-labels, legend and accessibility label convey the values instead.
function LinePlot({
  accessibilityLabel,
  bands,
  currencySymbol,
  fmtTick,
  plotHeight,
  pointCount,
  series,
  xLabels,
  yMax,
}: LinePlotProps) {
  const [plotWidth, setPlotWidth] = useState(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setPlotWidth(previous => (Math.abs(previous - width) > 1 ? width : previous));
  };

  const seriesRects = useMemo(() => {
    if (plotWidth <= 0) {
      return [] as Array<{
        color: string;
        dots: PlotPoint[];
        key: string;
        rects: LineRect[];
      }>;
    }
    return series.map(item => {
      const points = projectPoints(
        item.values,
        pointCount,
        yMax,
        plotWidth,
        plotHeight,
      );
      return {
        color: item.color,
        dots: item.dots
          ? points.filter((point): point is PlotPoint => point !== null)
          : [],
        key: item.key,
        rects: buildLineRects(points, item.key, !!item.dashed),
      };
    });
  }, [series, pointCount, yMax, plotWidth, plotHeight]);

  const bandRects = useMemo(() => {
    if (plotWidth <= 0 || !bands) {
      return [] as Array<{
        color: string;
        height: number;
        key: string;
        left: number;
        top: number;
        width: number;
      }>;
    }
    return bands.map((band, index) => ({
      color: band.color,
      key: `band-${index}`,
      ...buildBandRect(band, pointCount, yMax, plotWidth, plotHeight),
    }));
  }, [bands, pointCount, yMax, plotWidth, plotHeight]);

  return (
    <View>
      <View style={styles.plotRow}>
        <View style={[styles.yAxis, {height: plotHeight}]}>
          <AppText style={styles.axisTick} variant="caption">
            {`${currencySymbol}${fmtTick(yMax)}`}
          </AppText>
          <AppText style={styles.axisTick} variant="caption">
            {`${currencySymbol}${fmtTick(0)}`}
          </AppText>
        </View>
        <View
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="image"
          accessible
          onLayout={handleLayout}
          style={[styles.plot, {height: plotHeight}]}>
          <View pointerEvents="none" style={[styles.gridLine, styles.gridLineTop]} />
          <View
            pointerEvents="none"
            style={[styles.gridLine, {top: plotHeight / 2}]}
          />
          <View
            pointerEvents="none"
            style={[styles.gridLine, styles.gridLineBottom]}
          />
          {bandRects.map(band => (
            <View
              key={band.key}
              pointerEvents="none"
              style={[
                styles.band,
                {
                  backgroundColor: band.color,
                  height: band.height,
                  left: band.left,
                  top: band.top,
                  width: band.width,
                },
              ]}
            />
          ))}
          {seriesRects.map(item => (
            <React.Fragment key={item.key}>
              {item.rects.map(rect => (
                <View
                  key={rect.key}
                  pointerEvents="none"
                  style={[
                    styles.segment,
                    {
                      backgroundColor: item.color,
                      left: rect.left,
                      top: rect.top,
                      transform: [{rotateZ: rect.angle}],
                      width: rect.width,
                    },
                  ]}
                />
              ))}
              {item.dots.map((dot, index) => (
                <View
                  key={`${item.key}-dot-${index}`}
                  pointerEvents="none"
                  style={[
                    styles.dot,
                    {
                      backgroundColor: item.color,
                      left: dot.x - DOT_SIZE / 2,
                      top: dot.y - DOT_SIZE / 2,
                    },
                  ]}
                />
              ))}
            </React.Fragment>
          ))}
        </View>
      </View>
      <View style={styles.xRow}>
        {xLabels.map((label, index) => (
          <AppText
            key={`${label}-${index}`}
            numberOfLines={1}
            style={styles.xLabel}
            tone="muted"
            variant="caption">
            {label}
          </AppText>
        ))}
      </View>
    </View>
  );
}

function LegendChip({color, label}: {color: string; label: string}) {
  return (
    <View accessible accessibilityLabel={label} style={styles.legendItem}>
      <View style={[styles.legendSwatch, {backgroundColor: color}]} />
      <AppText tone="secondary" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

// Recharts ComposedChart: historical actual cost (area->line), projected forecast
// (dashed line) and the 95% confidence band (stacked area->range bars), plus an
// explicit legend.
function ForecastChart({
  forecast,
  historicalData,
  palette,
}: {
  forecast: CostForecastMonth[];
  historicalData: CostHistoricalMonth[];
  palette: readonly string[];
}) {
  const t = useNativeTranslation();
  const {currencySymbol, fmt} = useFormatPrefs();
  const actualColor = palette[0] ?? colors.accent;

  const merged = useMemo<MergedPoint[]>(
    () => [
      ...historicalData.map(h => ({
        actual: h.cost,
        month: h.month,
      })),
      ...forecast.map(f => ({
        ciHigh: f.cost_high,
        ciLow: f.cost_low,
        forecast: f.cost,
        month: f.month,
      })),
    ],
    [historicalData, forecast],
  );

  const yMax = useMemo(() => {
    let max = 0;
    for (const point of merged) {
      max = Math.max(
        max,
        point.actual ?? 0,
        point.forecast ?? 0,
        point.ciHigh ?? 0,
      );
    }
    return max;
  }, [merged]);

  const series: PlotSeries[] = [
    {color: actualColor, key: 'actual', values: merged.map(p => p.actual)},
    {
      color: FORECAST_PURPLE,
      dashed: true,
      key: 'forecast',
      values: merged.map(p => p.forecast),
    },
  ];

  const bands: PlotBand[] = merged.flatMap((point, index) =>
    point.ciHigh != null && point.ciLow != null
      ? [
          {
            color: FORECAST_BAND_FILL,
            high: point.ciHigh,
            index,
            low: point.ciLow,
          },
        ]
      : [],
  );

  return (
    <View>
      <LinePlot
        accessibilityLabel={`${t(
          'costAnalysis.forecast.actual',
          'Actual Cost',
        )} / ${t('costAnalysis.forecast.projected', 'Projected Cost')}`}
        bands={bands}
        currencySymbol={currencySymbol}
        fmtTick={value => fmt(value, 0)}
        plotHeight={FORECAST_PLOT_HEIGHT}
        pointCount={merged.length}
        series={series}
        xLabels={merged.map(p => p.month)}
        yMax={yMax}
      />
      <View style={styles.legend}>
        <LegendChip
          color={actualColor}
          label={t('costAnalysis.forecast.actual', 'Actual Cost')}
        />
        <LegendChip
          color={FORECAST_PURPLE}
          label={t('costAnalysis.forecast.projected', 'Projected Cost')}
        />
        <LegendChip
          color={FORECAST_BAND_SWATCH}
          label={t('costAnalysis.forecast.confidence', '95% Confidence')}
        />
      </View>
    </View>
  );
}

// Recharts LineChart: the cost-per-kWh trend with dotted markers.
function CostPerKwhChart({
  historicalData,
}: {
  historicalData: CostHistoricalMonth[];
}) {
  const t = useNativeTranslation();
  const {currencySymbol, fmt} = useFormatPrefs();
  const values = historicalData.map(h => h.cost_per_kwh);
  const yMax = values.reduce((max, value) => Math.max(max, value ?? 0), 0);

  return (
    <LinePlot
      accessibilityLabel={t('costAnalysis.forecast.costPerKwh', '$/kWh')}
      currencySymbol={currencySymbol}
      fmtTick={value => fmt(value, 2)}
      plotHeight={TREND_PLOT_HEIGHT}
      pointCount={values.length}
      series={[
        {
          color: COST_PER_KWH_CYAN,
          dots: true,
          key: 'cost_per_kwh',
          values,
        },
      ]}
      xLabels={historicalData.map(h => h.month)}
      yMax={yMax}
    />
  );
}

function BreakdownRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <View style={styles.breakdownRow}>
      <View style={styles.breakdownLabel}>
        <View style={[styles.dotSmall, {backgroundColor: color}]} />
        <AppText style={styles.textSecondary} variant="caption">
          {label}
        </AppText>
      </View>
      <View style={styles.breakdownValue}>
        <Currency precision={3} style={styles.textPrimary} value={value} />
        <AppText style={styles.textPrimary} variant="caption">
          /kWh
        </AppText>
      </View>
    </View>
  );
}

// Inlined `./ForecastDetails`: breakdown donut (-> split bar), gas-vs-EV savings,
// and insights. Each sub-panel falls back to an EmptyState like the web file.
function ForecastDetails({
  forecastData,
}: {
  forecastData: CostForecastData | undefined;
}) {
  const t = useNativeTranslation();
  const {currencySymbol, fmt} = useFormatPrefs();
  const insights = forecastData?.insights ?? [];

  return (
    <View style={styles.detailsGrid}>
      {/* Breakdown donut */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <AppText style={[styles.panelTitle, styles.titleSpacing]}>
            {t('costAnalysis.forecast.breakdown', 'Charging Breakdown')}
          </AppText>
          {forecastData ? (
            <View style={styles.breakdownBody}>
              <View style={styles.splitBar}>
                {(forecastData.breakdown.home.pct ?? 0) > 0 ? (
                  <View
                    style={[
                      styles.splitSegment,
                      {
                        backgroundColor: HOME_GREEN,
                        flex: forecastData.breakdown.home.pct ?? 0,
                      },
                    ]}
                  />
                ) : null}
                {(forecastData.breakdown.supercharger.pct ?? 0) > 0 ? (
                  <View
                    style={[
                      styles.splitSegment,
                      {
                        backgroundColor: SUPERCHARGER_AMBER,
                        flex: forecastData.breakdown.supercharger.pct ?? 0,
                      },
                    ]}
                  />
                ) : null}
              </View>
              <View style={styles.breakdownLegend}>
                <BreakdownRow
                  color={HOME_GREEN}
                  label={t('Home')}
                  value={forecastData.breakdown.home.avg_cost_per_kwh ?? 0}
                />
                <BreakdownRow
                  color={SUPERCHARGER_AMBER}
                  label={t('Supercharger')}
                  value={
                    forecastData.breakdown.supercharger.avg_cost_per_kwh ?? 0
                  }
                />
              </View>
            </View>
          ) : (
            <EmptyState
              message={t(
                'costAnalysis.forecast.noBreakdown',
                'Breakdown will appear once charging data is available.',
              )}
              title={t('costAnalysis.forecast.noBreakdownTitle', 'No breakdown yet')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Savings */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.titleRow}>
            <SemanticIcon decorative name="fuel" size="sm" />
            <AppText style={styles.panelTitle}>
              {t('costAnalysis.forecast.savings', 'Gas vs EV Savings')}
            </AppText>
          </View>
          {forecastData ? (
            <View style={styles.savingsBody}>
              <View style={styles.savingsHighlight}>
                <AppText style={styles.savingsCaption}>
                  {t('costAnalysis.forecast.monthlySavings', 'Monthly Savings')}
                </AppText>
                <AnimatedNumber
                  decimals={0}
                  prefix={currencySymbol}
                  style={styles.savingsBig}
                  value={forecastData.gas_comparison.monthly_savings ?? 0}
                />
              </View>
              <View style={styles.savingsGrid}>
                <View style={styles.savingsCell}>
                  <AppText style={styles.savingsSmallCaption}>
                    {t('costAnalysis.forecast.annual', 'Annual')}
                  </AppText>
                  <Currency
                    precision={0}
                    style={styles.savingsCellValue}
                    value={forecastData.gas_comparison.annual_savings ?? 0}
                  />
                </View>
                <View style={styles.savingsCell}>
                  <AppText style={styles.savingsSmallCaption}>
                    {t('costAnalysis.forecast.lifetime', 'Lifetime')}
                  </AppText>
                  <Currency
                    precision={0}
                    style={styles.savingsCellValue}
                    value={forecastData.gas_comparison.lifetime_savings ?? 0}
                  />
                </View>
              </View>
              <View style={styles.savingsRows}>
                <View style={styles.savingsLine}>
                  <AppText style={styles.textMuted} variant="caption">
                    {t('costAnalysis.forecast.gasCost', 'Gas cost/mo')}
                  </AppText>
                  <Currency
                    style={styles.redText}
                    value={forecastData.gas_comparison.gas_cost_per_month ?? 0}
                  />
                </View>
                <View style={styles.savingsLine}>
                  <AppText style={styles.textMuted} variant="caption">
                    {t('costAnalysis.forecast.evCost', 'EV cost/mo')}
                  </AppText>
                  <Currency
                    style={styles.greenText}
                    value={forecastData.gas_comparison.ev_cost_per_month ?? 0}
                  />
                </View>
                <View style={styles.savingsLine}>
                  <AppText style={styles.textMuted} variant="caption">
                    {t('costAnalysis.forecast.avgKm', 'Avg km/mo')}
                  </AppText>
                  <AppText style={styles.textMuted} variant="caption">
                    {fmt(forecastData.gas_comparison.avg_km_per_month ?? 0, 0)}
                  </AppText>
                </View>
              </View>
            </View>
          ) : (
            <EmptyState
              message={t(
                'costAnalysis.forecast.noSavings',
                'Savings data will appear once driving history is available.',
              )}
              title={t('costAnalysis.forecast.noSavingsTitle', 'No savings yet')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Insights */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.titleRow}>
            <SemanticIcon decorative name="lightbulb" size="sm" />
            <AppText style={styles.panelTitle}>
              {t('costAnalysis.forecast.insights', 'Insights')}
            </AppText>
          </View>
          {insights.length > 0 ? (
            <View style={styles.insightsList}>
              {insights.map((insight, index) => (
                <View key={index} style={styles.insightItem}>
                  <SemanticIcon decorative name="bolt" size="sm" />
                  <AppText style={styles.insightText}>{insight}</AppText>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              message={t(
                'costAnalysis.forecast.noInsights',
                'Insights will appear as more data is collected.',
              )}
              title={t('costAnalysis.forecast.noInsightsTitle', 'No insights yet')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </View>
  );
}

export function CostForecastSection({forecastData}: CostForecastSectionProps) {
  const t = useNativeTranslation();
  const palette = useChartPalette();
  const historicalData = forecastData?.historical ?? [];
  const forecast = forecastData?.forecast ?? [];
  const hasForecast = historicalData.length >= 3 && forecast.length > 0;
  const hasCostPerKwhTrend = historicalData.length > 1;

  return (
    <View style={styles.root}>
      {/* Main forecast chart */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.titleRow}>
            <SemanticIcon decorative name="trendUp" size="sm" />
            <AppText style={styles.panelTitle}>
              {t('costAnalysis.forecast.title', 'Cost Forecast')}
            </AppText>
          </View>
          {hasForecast ? (
            <ForecastChart
              forecast={forecast}
              historicalData={historicalData}
              palette={palette}
            />
          ) : (
            <EmptyState
              message={t(
                'costAnalysis.forecast.needData',
                'Need at least 3 months of charging data for cost forecasting.',
              )}
              title={t('costAnalysis.forecast.needDataTitle', 'Not enough data')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      <ForecastDetails forecastData={forecastData} />

      {/* Cost per kWh trend from forecast historical data */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <AppText style={[styles.panelTitle, styles.titleSpacing]}>
            {t('costAnalysis.forecast.costPerKwhTrend', 'Cost per kWh Trend')}
          </AppText>
          {hasCostPerKwhTrend ? (
            <CostPerKwhChart historicalData={historicalData} />
          ) : (
            <EmptyState
              message={t(
                'costAnalysis.forecast.needTrendData',
                'Need at least 2 months of charging data to show the cost per kWh trend.',
              )}
              title={t(
                'costAnalysis.forecast.needTrendDataTitle',
                'Not enough data',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  axisTick: {
    color: colors.textMuted,
    fontSize: 10,
  },
  band: {
    borderRadius: 2,
    position: 'absolute',
  },
  breakdownBody: {
    alignItems: 'center',
  },
  breakdownLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  breakdownLegend: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    width: '100%',
  },
  breakdownRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownValue: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  detailsGrid: {
    gap: 16,
  },
  dot: {
    borderRadius: DOT_SIZE / 2,
    height: DOT_SIZE,
    position: 'absolute',
    width: DOT_SIZE,
  },
  dotSmall: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  gridLine: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  gridLineBottom: {
    bottom: PLOT_PAD,
  },
  gridLineTop: {
    top: PLOT_PAD,
  },
  greenText: {
    color: GREEN_400,
  },
  insightItem: {
    alignItems: 'flex-start',
    backgroundColor: WHITE_SURFACE_03,
    borderColor: WHITE_BORDER_06,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: 12,
  },
  insightText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  insightsList: {
    gap: spacing.md,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendSwatch: {
    borderRadius: 2,
    height: 8,
    width: 14,
  },
  panel: {
    padding: 24,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  plot: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  plotRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  redText: {
    color: RED_400,
  },
  root: {
    gap: spacing.lg,
  },
  savingsBig: {
    color: EMERALD_300,
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
    textAlign: 'center',
  },
  savingsBody: {
    gap: 16,
  },
  savingsCaption: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  savingsCell: {
    alignItems: 'center',
    backgroundColor: WHITE_SURFACE_04,
    borderRadius: 8,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  savingsCellValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
  savingsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  savingsHighlight: {
    alignItems: 'center',
    backgroundColor: GREEN_SURFACE,
    borderColor: GREEN_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  savingsLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  savingsRows: {
    gap: spacing.xs,
  },
  savingsSmallCaption: {
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: 2,
  },
  segment: {
    borderRadius: STROKE / 2,
    height: STROKE,
    position: 'absolute',
  },
  splitBar: {
    borderRadius: 8,
    flexDirection: 'row',
    height: 16,
    overflow: 'hidden',
    width: '100%',
  },
  splitSegment: {
    height: '100%',
  },
  textMuted: {
    color: colors.textMuted,
  },
  textPrimary: {
    color: colors.textPrimary,
    fontWeight: '500',
  },
  textSecondary: {
    color: colors.textSecondary,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: 16,
  },
  titleSpacing: {
    marginBottom: 16,
  },
  xLabel: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 9,
    textAlign: 'center',
  },
  xRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
    paddingLeft: Y_AXIS_WIDTH + spacing.sm,
  },
  yAxis: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: Y_AXIS_WIDTH,
  },
});
