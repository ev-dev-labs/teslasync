import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, MapPin, Clock, Thermometer, TrendingUp, Timer, Activity } from 'lucide-react';
import {
  ChartTooltip, ChartGradient,
  ChartLegend,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  BarChart, Bar, ComposedChart, Line, AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ZAxis,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';
import { AnalyticsChartPanel } from './AnalyticsChartPanel';
import { DrivingPerformanceCards } from './DrivingPerformanceCards';
import { DrivingTemperatureStats } from './DrivingTemperatureStats';
import type { FleetAnalyticsQuery } from './constants';

const KM_PER_MILE = 1.609344;

export function DrivingTab({ query }: { query: FleetAnalyticsQuery }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const tempUnit = unitPrefs.temperature;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const { data, isLoading, isError, error, refetch } = query;
  const err = isError ? error : undefined;

  const da = data?.drive_analytics;
  const speedDist = da?.speed_distribution ?? [];
  const distDist = da?.distance_distribution ?? [];
  const hourly = da?.hourly_pattern ?? [];
  const tempEff = da?.temp_vs_efficiency ?? [];
  const dailyTrend = da?.daily_trend ?? [];
  const durationDist = da?.duration_distribution ?? [];

  // Display-unit projectors. Backend distance fields are SI-floor km and
  // efficiency is Wh/km; both must be projected into the active user unit
  // before they are plotted under a user-unit axis label — otherwise raw km /
  // Wh/km leaks under an "mi" / "Wh/mi" label. Stable per active unit so the
  // memoised chart data below only recomputes when the preference changes.
  const fromKm = useCallback(
    (km: number) => convertDistanceFromSI(km * 1000, distanceUnit),
    [distanceUnit],
  );
  const fromWhPerKm = useCallback(
    (whPerKm: number) => (distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm),
    [distanceUnit],
  );

  // Project the hourly + daily distance series into the user's distance unit so
  // the plotted magnitude matches the axis label. Derived once per data/unit
  // change instead of building a fresh array literal inline on every render.
  const hourlyData = useMemo(
    () => hourly.map((d) => ({ ...d, distance: fromKm(safe(d.distance)) })),
    [hourly, fromKm],
  );
  const dailyTrendData = useMemo(
    () => dailyTrend.map((d) => ({ ...d, distance: fromKm(safe(d.distance)) })),
    [dailyTrend, fromKm],
  );
  // Scatter points carry SI °C / Wh/km / km — convert each axis at the boundary.
  const tempEffData = useMemo(
    () =>
      tempEff.map((d) => ({
        temp: convertTempFromSI(safe(d.temp), tempUnit),
        efficiency: fromWhPerKm(safe(d.efficiency)),
        distance: fromKm(safe(d.distance)),
      })),
    [tempEff, tempUnit, fromWhPerKm, fromKm],
  );
  // Keep only points with a positive efficiency, then project the survivors into
  // the user's efficiency unit (Wh/mi vs Wh/km) to match the axis label.
  const effTrend = useMemo(
    () =>
      dailyTrend
        .filter((d) => safe(d.efficiency) > 0)
        .map((d) => ({ ...d, efficiency: fromWhPerKm(safe(d.efficiency)) })),
    [dailyTrend, fromWhPerKm],
  );

  return (
    <FadeIn className="mt-4 space-y-4 xl:space-y-5">
      <DrivingPerformanceCards query={query} />

      <section
        aria-label={t('analytics.tabs.driving', 'Driving')}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5 2xl:grid-cols-3"
      >
        {/* Speed Distribution */}
        <AnalyticsChartPanel
          title={t('analytics.driving.speedDist', 'Speed Distribution')}
          icon={<Gauge className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={speedDist.length === 0}
          emptyMessage={t('analytics.driving.noSpeed', 'No speed data')}
          ariaLabel={t('analytics.driving.speedDistAria', 'Trip count by speed range')}
          data={speedDist}
          dataColumns={[
            { key: 'range', label: t('analytics.driving.speedRange', 'Speed range') },
            { key: 'count', label: t('analytics.driving.trips', 'Trips') },
          ]}
          exportFilename="fleet-speed-distribution"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={speedDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('analytics.driving.trips', 'Trips')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>

        {/* Trip Distance Distribution */}
        <AnalyticsChartPanel
          title={t('analytics.driving.distDist', 'Trip Distance Distribution')}
          icon={<MapPin className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={distDist.length === 0}
          emptyMessage={t('analytics.driving.noDistDist', 'No distance distribution data')}
          ariaLabel={t('analytics.driving.distDistAria', 'Trip count by distance range')}
          data={distDist}
          dataColumns={[
            { key: 'range', label: t('analytics.driving.distanceRange', 'Distance range') },
            { key: 'count', label: t('analytics.driving.trips', 'Trips') },
          ]}
          exportFilename="fleet-distance-distribution"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('analytics.driving.trips', 'Trips')} fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>

        {/* Hourly Driving Pattern */}
        <AnalyticsChartPanel
          title={t('analytics.driving.hourlyPattern', 'Hourly Driving Pattern')}
          icon={<Clock className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={hourly.length === 0}
          emptyMessage={t('analytics.driving.noHourly', 'No hourly data')}
          ariaLabel={t('analytics.driving.hourlyPatternAria', 'Drives and distance by hour of day')}
          data={hourlyData}
          dataColumns={[
            { key: 'hour', label: t('analytics.driving.hour', 'Hour') },
            { key: 'drives', label: t('analytics.driving.drives', 'Drives') },
            {
              key: 'distance',
              label: `${t('analytics.driving.distance', 'Distance')} (${distanceUnit})`,
            },
          ]}
          exportFilename="fleet-hourly-driving"
          chartKey="analytics-hourly-driving"
        >
          {({ hiddenSeries }) => (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hourlyData} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="hour" tick={axisTickSm} tickFormatter={(h: number) => `${h}:00`} />
                <YAxis yAxisId="left" tick={axisTick} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                <Bar yAxisId="left" dataKey="drives" name={t('analytics.driving.drives', 'Drives')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} hide={hiddenSeries?.isHidden('drives')} />
                <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="distance" name={`${t('analytics.driving.distance', 'Distance')} (${distanceUnit})`} stroke={CHART_COLORS[3]} hide={hiddenSeries?.isHidden('distance')} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartPanel>

        {/* Temp vs Efficiency */}
        <AnalyticsChartPanel
          title={t('analytics.driving.tempVsEff', 'Temperature vs Efficiency')}
          icon={<Thermometer className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={tempEff.length === 0}
          emptyMessage={t('analytics.driving.noTempEff', 'No temperature data')}
          ariaLabel={`${t('analytics.driving.tempVsEffAria', 'Efficiency versus outside temperature')} (${efficiencyUnit})`}
          data={tempEffData}
          dataColumns={[
            { key: 'temp', label: `${t('analytics.driving.temp', 'Temp')} (${tempUnit})` },
            {
              key: 'efficiency',
              label: `${t('analytics.driving.efficiency', 'Efficiency')} (${efficiencyUnit})`,
            },
            { key: 'distance', label: `${t('analytics.driving.distance', 'Distance')} (${distanceUnit})` },
          ]}
          exportFilename="fleet-temperature-efficiency"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={chartMarginLabeled}>
              {chartGrid}
              <XAxis dataKey="temp" name={t('analytics.driving.temp', 'Temp')} tick={axisTick} unit={tempUnit} type="number" />
              <YAxis dataKey="efficiency" name={t('analytics.driving.efficiency', 'Efficiency')} tick={axisTick} unit={` ${efficiencyUnit}`} type="number" />
              <ZAxis dataKey="distance" range={[30, 300]} name={distanceUnit} />
              <Tooltip content={<ChartTooltip />} />
              <Scatter data={tempEffData} fill={CHART_COLORS[1]} />
            </ScatterChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>

        {/* Daily Driving Trend */}
        <AnalyticsChartPanel
          title={t('analytics.driving.dailyTrend', 'Daily Driving Trend')}
          icon={<TrendingUp className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={dailyTrend.length === 0}
          emptyMessage={t('analytics.driving.noDailyTrend', 'No daily trend data')}
          ariaLabel={`${t('analytics.driving.dailyTrendAria', 'Daily driving distance and drive count')} (${distanceUnit})`}
          data={dailyTrendData}
          dataColumns={[
            { key: 'date', label: t('chart.col.date', 'Date') },
            { key: 'distance', label: `${t('analytics.driving.distance', 'Distance')} (${distanceUnit})` },
            { key: 'drives', label: t('analytics.driving.drives', 'Drives') },
          ]}
          exportFilename="fleet-daily-driving"
          chartKey="analytics-daily-driving"
        >
          {({ hiddenSeries }) => (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyTrendData} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis yAxisId="left" tick={axisTick} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                <defs>
                  <ChartGradient id="dailyDistGrad" color={CHART_COLORS[0]} />
                </defs>
                <Area {...AREA_DEFAULTS} yAxisId="left" dataKey="distance" name={`${t('analytics.driving.distance', 'Distance')} (${distanceUnit})`} stroke={CHART_COLORS[0]} fill="url(#dailyDistGrad)" hide={hiddenSeries?.isHidden('distance')} />
                <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="drives" name={t('analytics.driving.drives', 'Drives')} stroke={CHART_COLORS[3]} hide={hiddenSeries?.isHidden('drives')} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartPanel>

        {/* Drive Duration Distribution */}
        <AnalyticsChartPanel
          title={t('analytics.driving.durationDist', 'Drive Duration Distribution')}
          icon={<Timer className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={durationDist.length === 0}
          emptyMessage={t('analytics.driving.noDurationData', 'Not enough drive data for distribution chart')}
          ariaLabel={t('analytics.driving.durationDistAria', 'Drive count by duration range')}
          data={durationDist}
          dataColumns={[
            { key: 'range', label: t('analytics.driving.durationRange', 'Duration range') },
            { key: 'count', label: t('analytics.driving.drives', 'Drives') },
          ]}
          exportFilename="fleet-drive-duration-distribution"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={durationDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('analytics.driving.drives', 'Drives')} fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>

        {/* Efficiency Trend — hero band */}
        <AnalyticsChartPanel
          className="md:col-span-2 2xl:col-span-3"
          title={t('analytics.driving.effTrend', 'Efficiency Trend')}
          icon={<Activity className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={effTrend.length === 0}
          emptyMessage={t('analytics.driving.noEffTrend', 'No efficiency trend data')}
          ariaLabel={`${t('analytics.driving.effTrendAria', 'Daily efficiency trend')} (${efficiencyUnit})`}
          size="detail"
          data={effTrend}
          dataColumns={[
            { key: 'date', label: t('chart.col.date', 'Date') },
            { key: 'efficiency', label: `${t('analytics.driving.efficiency', 'Efficiency')} (${efficiencyUnit})` },
          ]}
          exportFilename="fleet-efficiency-trend"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={effTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={axisTick} unit={` ${efficiencyUnit}`} />
              <Tooltip content={<ChartTooltip />} />
              <defs>
                <ChartGradient id="effTrendGrad" color={CHART_COLORS[1]} />
              </defs>
              <Area {...AREA_DEFAULTS} dataKey="efficiency" name={efficiencyUnit} stroke={CHART_COLORS[1]} fill="url(#effTrendGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>
      </section>

      <DrivingTemperatureStats query={query} />
    </FadeIn>
  );
}
