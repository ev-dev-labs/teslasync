// Native parity port of
// web/src/features/analytics/components/analytics/DrivingTab.tsx.
//
// Renders the Analytics "Driving" tab: a stack of GlassPanels — the driving
// performance metric cards, then Speed / Trip-Distance / Drive-Duration
// distribution bar charts, an Hourly-Pattern composed chart, a Temp-vs-Efficiency
// scatter, a Daily-Driving-Trend composed area+line, an Efficiency-Trend area
// chart, and finally the temperature-stats cards. The web file leans on several
// browser-only dependencies that have no native counterpart in this parity tree
// (contract rules 4, 5 & 7); each is replaced with a React Native-safe
// equivalent and documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L2) -> inlined useNativeTranslation():
//     a stable (key, fallback) => fallback shim so every t('key','English') call
//     keeps its English default and the translation-key intent at the call site.
//   - `@/components/ui` GlassPanel (web L3) -> the existing native GlassPanel;
//     Tailwind `p-4` maps to a padding token.
//   - `@/components/charts` Recharts primitives + helpers (web L4-10) -> the
//     native web-parity charts barrel, which preserves the same public API
//     (BarChart/Bar/ComposedChart/Line/AreaChart/Area/ScatterChart/Scatter/
//     XAxis/YAxis/Tooltip/ResponsiveContainer/Legend/ZAxis, plus ChartTooltip,
//     ChartGradient, chartGrid, axisTick, axisTickSm, chartMarginLabeled,
//     chartAnimation, safe, CHART_COLORS, AREA_DEFAULTS) but renders Recharts as
//     native-safe "unavailable" placeholders because Recharts depends on
//     browser DOM/SVG. The web SVG `<defs>` wrappers around <ChartGradient> are
//     DOM-only and invalid in React Native, so the native ChartGradient marker
//     is rendered directly without the <defs> wrapper.
//   - `@/components/feedback` EmptyState (web L11) -> inlined message-only
//     EmptyState (the web call sites pass only `message`); the native
//     src/components/feedback EmptyState requires a title, so a muted centred
//     AppText reproduces the title-less web empty state without inventing copy.
//   - `@/components/motion` FadeIn (web L12, L39) -> an Animated.View opacity
//     0->1 mount fade; the `space-y-4 mt-4` container spacing maps to gap /
//     marginTop tokens.
//   - `@/hooks/useUnits` (web L13) -> useFormatPrefs() from the native format
//     primitives bridge; unitPrefs.distance/.temperature/.speed map to
//     prefs.distanceUnit/.tempUnit/.speedUnit.
//   - `@/lib/unitConversion` convertDistanceFromSI/convertTempFromSI (web L14)
//     plus convertSpeedFromSI (sibling) -> the SI converters re-exported by the
//     native _formatPrimitives bridge.
//   - `@/lib/numberFormat` fmtNumber (sibling) -> the locale-aware prefs.fmt.
//   - `./helpers` SectionTitle (web L16) -> inlined locally (text-sm/semibold/
//     primary -> AppText body/semibold); the native analytics helpers are not
//     yet ported.
//   - `./DrivingPerformanceCards` (web L17) and `./DrivingTemperatureStats`
//     (web L18) -> inlined local native ports (MetricCard grids with lucide-react
//     icons mapped to native SemanticIcon glyphs) so this conversion stays
//     scoped to a single output file; their own source files are converted in
//     their own iterations.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components are
// imported — only react, react-native primitives, the native web-parity charts
// barrel, and existing apps/native MetricCard / SemanticIcon / AppText /
// GlassPanel / theme tokens.

import React, {useEffect, useMemo, useRef, type ReactNode} from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {spacing} from '../../../../../theme/tokens';
import type {FleetAnalytics} from '../../../../api/types';
import {
  AREA_DEFAULTS,
  Area,
  AreaChart,
  Bar,
  BarChart,
  CHART_COLORS,
  ChartGradient,
  ChartTooltip,
  ComposedChart,
  Legend,
  Line,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  axisTick,
  axisTickSm,
  chartAnimation,
  chartGrid,
  chartMarginLabeled,
  ResponsiveContainer,
  safe,
} from '../../../../components/charts';
import {MetricCard} from '../../../../components/data-display/MetricCard';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  convertTempFromSI,
  useFormatPrefs,
} from '../../../../components/data-display/format/_formatPrimitives';

const KM_PER_MILE = 1.609344;
const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;

const FADE_DURATION_MS = 220;

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next useTranslation replacement: returns the English fallback so the
// translation-key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// @/components/motion FadeIn -> Animated.View opacity 0->1 mount fade.
function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
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

  return <Animated.View style={[{opacity}, style]}>{children}</Animated.View>;
}

// ./helpers SectionTitle -> text-sm font-semibold text-[var(--text-primary)].
function SectionTitle({children}: {children: ReactNode}) {
  return (
    <AppText variant="body" weight="semibold">
      {children}
    </AppText>
  );
}

// @/components/feedback EmptyState, message-only call surface used by this tab.
function EmptyState({message}: {message: string}) {
  return (
    <View style={styles.emptyState}>
      <AppText tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// Native port of ./DrivingPerformanceCards (web sibling, not yet ported).
function DrivingPerformanceCards({data}: {data: FleetAnalytics | undefined}) {
  const t = useNativeTranslation();
  const prefs = useFormatPrefs();
  const distanceUnit = prefs.distanceUnit;
  const speedUnit = prefs.speedUnit;
  // backend `speed_stats` is km/h; SI floor is m/s.
  const fromKmh = (kmh: number) =>
    convertSpeedFromSI((kmh * METERS_PER_KM) / SECONDS_PER_HOUR, speedUnit);
  // backend `distance_stats` is km; SI floor is meters.
  const fromKm = (km: number) =>
    convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);

  const da = data?.drive_analytics;
  const ss = da?.speed_stats;
  const ps = da?.power_stats;
  const rs = da?.regen_stats;
  const ds = da?.distance_stats;

  return (
    <View style={styles.grid}>
      <View style={styles.gridItem}>
        <MetricCard
          color="cyan"
          icon={<SemanticIcon decorative name="speed" size="sm" />}
          label={t('analytics.driving.topSpeed', 'Top Speed')}
          subtitle={speedUnit}
          value={ss ? prefs.fmt(fromKmh(safe(ss.max)), 0) : '—'}
        />
      </View>
      <View style={styles.gridItem}>
        <MetricCard
          color="purple"
          icon={<SemanticIcon decorative name="trendUp" size="sm" />}
          label={t('analytics.driving.avgSpeed', 'Avg Speed')}
          subtitle={speedUnit}
          value={ss ? prefs.fmt(fromKmh(safe(ss.avg)), 0) : '—'}
        />
      </View>
      <View style={styles.gridItem}>
        <MetricCard
          color="amber"
          icon={<SemanticIcon decorative name="bolt" size="sm" />}
          label={t('analytics.driving.peakPower', 'Peak Power')}
          subtitle="kW"
          value={ps ? prefs.fmt(safe(ps.max), 0) : '—'}
        />
      </View>
      <View style={styles.gridItem}>
        <MetricCard
          color="green"
          icon={<SemanticIcon decorative name="batteryCharging" size="sm" />}
          label={t('analytics.driving.peakRegen', 'Peak Regen')}
          subtitle="kW"
          value={rs ? prefs.fmt(safe(rs.max), 0) : '—'}
        />
      </View>
      <View style={styles.gridItem}>
        <MetricCard
          color="cyan"
          icon={<SemanticIcon decorative name="mapPinned" size="sm" />}
          label={t('analytics.driving.avgDriveDist', 'Avg Drive Distance')}
          subtitle={distanceUnit}
          value={ds ? prefs.fmt(fromKm(safe(ds.avg)), 1) : '—'}
        />
      </View>
      <View style={styles.gridItem}>
        <MetricCard
          color="purple"
          icon={<SemanticIcon decorative name="vehicle" size="sm" />}
          label={t('analytics.driving.longestDrive', 'Longest Drive')}
          subtitle={distanceUnit}
          value={ds ? prefs.fmt(fromKm(safe(ds.max)), 1) : '—'}
        />
      </View>
    </View>
  );
}

// Native port of ./DrivingTemperatureStats (web sibling, not yet ported).
function DrivingTemperatureStats({data}: {data: FleetAnalytics | undefined}) {
  const t = useNativeTranslation();
  const prefs = useFormatPrefs();
  const tempUnit = prefs.tempUnit;
  // backend `temperature.{inside,outside}` is °C; convertTempFromSI expects °C.
  const fromC = (c: number) => convertTempFromSI(c, tempUnit);

  const da = data?.drive_analytics;
  const insideTemp = da?.temperature?.inside;
  const outsideTemp = da?.temperature?.outside;

  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle>
        {t('analytics.driving.tempStats', 'Temperature Stats')}
      </SectionTitle>
      {insideTemp || outsideTemp ? (
        <View style={[styles.grid, styles.gridSpaced]}>
          <View style={styles.gridItem}>
            <MetricCard
              color="cyan"
              icon={<SemanticIcon decorative name="climate" size="sm" />}
              label={t('analytics.driving.insideMin', 'Inside Min')}
              subtitle={tempUnit}
              value={insideTemp ? prefs.fmt(fromC(safe(insideTemp.min)), 1) : '—'}
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color="green"
              icon={<SemanticIcon decorative name="climate" size="sm" />}
              label={t('analytics.driving.insideAvg', 'Inside Avg')}
              subtitle={tempUnit}
              value={insideTemp ? prefs.fmt(fromC(safe(insideTemp.avg)), 1) : '—'}
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color="amber"
              icon={<SemanticIcon decorative name="climate" size="sm" />}
              label={t('analytics.driving.insideMax', 'Inside Max')}
              subtitle={tempUnit}
              value={insideTemp ? prefs.fmt(fromC(safe(insideTemp.max)), 1) : '—'}
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color="cyan"
              icon={<SemanticIcon decorative name="climate" size="sm" />}
              label={t('analytics.driving.outsideMin', 'Outside Min')}
              subtitle={tempUnit}
              value={
                outsideTemp ? prefs.fmt(fromC(safe(outsideTemp.min)), 1) : '—'
              }
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color="green"
              icon={<SemanticIcon decorative name="climate" size="sm" />}
              label={t('analytics.driving.outsideAvg', 'Outside Avg')}
              subtitle={tempUnit}
              value={
                outsideTemp ? prefs.fmt(fromC(safe(outsideTemp.avg)), 1) : '—'
              }
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color="amber"
              icon={<SemanticIcon decorative name="climate" size="sm" />}
              label={t('analytics.driving.outsideMax', 'Outside Max')}
              subtitle={tempUnit}
              value={
                outsideTemp ? prefs.fmt(fromC(safe(outsideTemp.max)), 1) : '—'
              }
            />
          </View>
        </View>
      ) : (
        <EmptyState message={t('analytics.driving.noTempStats', 'No temperature stats')} />
      )}
    </GlassPanel>
  );
}

export function DrivingTab({data}: {data: FleetAnalytics | undefined}) {
  const t = useNativeTranslation();
  const prefs = useFormatPrefs();
  const distanceUnit = prefs.distanceUnit;
  const tempUnit = prefs.tempUnit;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const da = data?.drive_analytics;
  const speedDist = da?.speed_distribution ?? [];
  const distDist = da?.distance_distribution ?? [];
  const hourly = da?.hourly_pattern ?? [];
  const tempEff = da?.temp_vs_efficiency ?? [];
  const dailyTrend = useMemo(() => da?.daily_trend ?? [], [da]);
  const durationDist = da?.duration_distribution ?? [];
  const effTrend = useMemo(
    () => dailyTrend.filter(d => safe(d.efficiency) > 0),
    [dailyTrend],
  );

  return (
    <FadeIn style={styles.stack}>
      <DrivingPerformanceCards data={data} />

      {/* Speed Distribution */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.driving.speedDist', 'Speed Distribution')}
        </SectionTitle>
        {speedDist.length > 0 ? (
          <ResponsiveContainer height={260} width="100%">
            <BarChart data={speedDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="count"
                fill={CHART_COLORS[0]}
                name={t('analytics.driving.trips', 'Trips')}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noSpeed', 'No speed data')} />
        )}
      </GlassPanel>

      {/* Trip Distance Distribution */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.driving.distDist', 'Trip Distance Distribution')}
        </SectionTitle>
        {distDist.length > 0 ? (
          <ResponsiveContainer height={260} width="100%">
            <BarChart data={distDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="count"
                fill={CHART_COLORS[2]}
                name={t('analytics.driving.trips', 'Trips')}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState
            message={t(
              'analytics.driving.noDistDist',
              'No distance distribution data',
            )}
          />
        )}
      </GlassPanel>

      {/* Hourly Driving Pattern */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.driving.hourlyPattern', 'Hourly Driving Pattern')}
        </SectionTitle>
        {hourly.length > 0 ? (
          <ResponsiveContainer height={280} width="100%">
            <ComposedChart data={hourly} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="hour"
                tick={axisTickSm}
                tickFormatter={(h: number) => `${h}:00`}
              />
              <YAxis tick={axisTick} yAxisId="left" />
              <YAxis orientation="right" tick={axisTick} yAxisId="right" />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar
                dataKey="drives"
                fill={CHART_COLORS[0]}
                name={t('analytics.driving.drives', 'Drives')}
                radius={[3, 3, 0, 0]}
                yAxisId="left"
              />
              <Line
                {...AREA_DEFAULTS}
                dataKey="distance"
                name={t('analytics.driving.distance', 'Distance')}
                stroke={CHART_COLORS[3]}
                yAxisId="right"
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noHourly', 'No hourly data')} />
        )}
      </GlassPanel>

      {/* Temp vs Efficiency */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.driving.tempVsEff', 'Temperature vs Efficiency')}
        </SectionTitle>
        {tempEff.length > 0 ? (
          <ResponsiveContainer height={280} width="100%">
            <ScatterChart margin={chartMarginLabeled}>
              {chartGrid}
              <XAxis
                dataKey="temp"
                name={t('analytics.driving.temp', 'Temp')}
                tick={axisTick}
                type="number"
                unit={tempUnit}
              />
              <YAxis
                dataKey="efficiency"
                name={t('analytics.driving.efficiency', 'Efficiency')}
                tick={axisTick}
                type="number"
                unit={` ${efficiencyUnit}`}
              />
              <ZAxis dataKey="distance" name={distanceUnit} range={[30, 300]} />
              <Tooltip content={<ChartTooltip />} />
              <Scatter
                data={tempEff.map(d => ({
                  // backend `temp_vs_efficiency` is { °C, Wh/km, km } — convert at boundary.
                  distance: convertDistanceFromSI(safe(d.distance) * 1000, distanceUnit),
                  efficiency:
                    distanceUnit === 'mi'
                      ? safe(d.efficiency) * KM_PER_MILE
                      : safe(d.efficiency),
                  temp: convertTempFromSI(safe(d.temp), tempUnit),
                }))}
                fill={CHART_COLORS[1]}
              />
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState
            message={t('analytics.driving.noTempEff', 'No temperature data')}
          />
        )}
      </GlassPanel>

      {/* Daily Driving Trend */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.driving.dailyTrend', 'Daily Driving Trend')}
        </SectionTitle>
        {dailyTrend.length > 0 ? (
          <ResponsiveContainer height={280} width="100%">
            <ComposedChart data={dailyTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="date"
                tick={axisTickSm}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis tick={axisTick} yAxisId="left" />
              <YAxis orientation="right" tick={axisTick} yAxisId="right" />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <ChartGradient color={CHART_COLORS[0]} id="dailyDistGrad" />
              <Area
                {...AREA_DEFAULTS}
                dataKey="distance"
                fill="url(#dailyDistGrad)"
                name={distanceUnit}
                stroke={CHART_COLORS[0]}
                yAxisId="left"
              />
              <Line
                {...AREA_DEFAULTS}
                dataKey="drives"
                name={t('analytics.driving.drives', 'Drives')}
                stroke={CHART_COLORS[3]}
                yAxisId="right"
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState
            message={t('analytics.driving.noDailyTrend', 'No daily trend data')}
          />
        )}
      </GlassPanel>

      {/* Drive Duration Distribution */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.driving.durationDist', 'Drive Duration Distribution')}
        </SectionTitle>
        {durationDist.length > 0 ? (
          <ResponsiveContainer height={260} width="100%">
            <BarChart data={durationDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="count"
                fill={CHART_COLORS[4]}
                name={t('analytics.driving.drives', 'Drives')}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState
            message={t(
              'analytics.driving.noDurationData',
              'Not enough drive data for distribution chart',
            )}
          />
        )}
      </GlassPanel>

      {/* Efficiency Trend */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.driving.effTrend', 'Efficiency Trend')}
        </SectionTitle>
        {effTrend.length > 0 ? (
          <ResponsiveContainer height={260} width="100%">
            <AreaChart data={effTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="date"
                tick={axisTickSm}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <ChartGradient color={CHART_COLORS[1]} id="effTrendGrad" />
              <Area
                {...AREA_DEFAULTS}
                dataKey="efficiency"
                fill="url(#effTrendGrad)"
                name={efficiencyUnit}
                stroke={CHART_COLORS[1]}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState
            message={t('analytics.driving.noEffTrend', 'No efficiency trend data')}
          />
        )}
      </GlassPanel>

      <DrivingTemperatureStats data={data} />
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gridItem: {
    flexBasis: 150,
    flexGrow: 1,
    minWidth: 150,
  },
  gridSpaced: {
    marginTop: spacing.md,
  },
  panel: {
    padding: spacing.lg,
  },
  stack: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
});
