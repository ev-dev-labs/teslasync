import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, Battery, TrendingUp, MapPin } from 'lucide-react';
import type { StatMetric } from '@/components/data-display';
import {
  ChartTooltip, ChartGradient,
  ChartLegend,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  LineChart, Line, AreaChart, Area, ComposedChart,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertEnergyFromSI } from '@/lib/unitConversion';

import { AnalyticsChartPanel } from './AnalyticsChartPanel';
import { FleetSectionBrief } from '../operationalbrief-a-m/FleetSectionBrief';
import type { FleetAnalyticsQuery } from './constants';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function BatteryTab({ query }: { query: FleetAnalyticsQuery }) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const distanceUnit = unitPrefs.distance;
  // backend `range_km` is SI km; convert via meter-floored helper. Stable per
  // distance unit so the memoised chart data below only recomputes on unit change.
  const fromKm = useCallback(
    (km: number) => convertDistanceFromSI(km * 1000, distanceUnit),
    [distanceUnit],
  );

  const { data, isLoading, isError, error, refetch } = query;
  const err = isError ? error : undefined;

  const trend = data?.battery_trend ?? [];
  const latest = trend.length > 0 ? trend[trend.length - 1] : null;
  const isEmpty = trend.length === 0;
  const metrics: StatMetric[] = [
    { metricId: 'percent', occurrenceId: 'battery-health', rawValue: latest?.health_score,
      label: t('analytics.battery.healthScore', 'Health score'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) } },
    { metricId: 'energy', occurrenceId: 'battery-capacity', rawValue: latest?.capacity_wh,
      label: t('analytics.battery.capacity', 'Capacity'),
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'battery-degradation', rawValue: latest?.degradation_pct,
      label: t('analytics.battery.degradation', 'Degradation'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) } },
    { metricId: 'distance', occurrenceId: 'battery-range', rawValue: latest?.range_km != null ? latest.range_km * 1000 : null,
      label: t('analytics.battery.estRange', 'Est. range'),
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) } },
    { metricId: 'count', occurrenceId: 'battery-cycles', rawValue: latest?.cycle_count,
      label: t('analytics.battery.cycles', 'Cycles'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
  ];

  // Range trend is plotted in the user's distance unit; derive once instead of
  // building a fresh array literal inline on every render.
  const displayTrend = useMemo(
    () =>
      trend.map((d) => ({
        ...d,
        capacity: convertEnergyFromSI(safe(d.capacity_wh), unitPrefs.energy),
        range: fromKm(safe(d.range_km)),
      })),
    [trend, fromKm, unitPrefs.energy],
  );

  return (
    <FadeIn className="mt-4 space-y-4 xl:space-y-5">
      {/* Battery Health Cards band */}
      <FleetSectionBrief query={query} metrics={metrics}
        title={t('analytics.brief.batteryTitle', 'Latest returned battery measurements')}
        description={t('analytics.brief.batteryDescription', 'Measurements describe the last returned battery-trend row, not an inferred current vehicle state.')}
        scope={latest ? t('analytics.brief.batteryScope', 'Returned battery-trend date: {{date}}. Continuous recording coverage is unknown.', { date: latest.date })
          : t('analytics.brief.batteryNoRow', 'No battery-trend row was returned for the selected range.')} />

      <section
        aria-label={t('analytics.tabs.battery', 'Battery')}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5 2xl:grid-cols-3"
      >
        {/* Health Score Timeline — hero band */}
        <AnalyticsChartPanel
          className="md:col-span-2 2xl:col-span-3"
          title={t('analytics.battery.healthTimeline', 'Health score timeline')}
          icon={<Heart className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={isEmpty}
          emptyMessage={t('analytics.battery.noData', 'No battery trend data available')}
          ariaLabel={t('analytics.battery.healthChartAria', 'Battery health score trend over time')}
          size="detail"
          data={displayTrend}
          dataColumns={[
            { key: 'date', label: t('chart.col.date', 'Date') },
            { key: 'health_score', label: t('analytics.battery.health', 'Health %') },
          ]}
          exportFilename="fleet-battery-health"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={displayTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={axisTick} domain={[80, 100]} />
              <Tooltip content={<ChartTooltip />} />
              <defs>
                <ChartGradient id="healthGrad" color={CHART_COLORS[1]} />
              </defs>
              <Area {...AREA_DEFAULTS} dataKey="health_score" name={t('analytics.battery.health', 'Health %')} stroke={CHART_COLORS[1]} fill="url(#healthGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>

        {/* Capacity Trend */}
        <AnalyticsChartPanel
          title={t('analytics.battery.capacityTrend', 'Capacity trend')}
          icon={<Battery className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={isEmpty}
          emptyMessage={t('analytics.battery.noData', 'No battery trend data available')}
          ariaLabel={t('analytics.battery.capacityChartAria', 'Battery capacity trend over time')}
          size="standard"
          data={displayTrend}
          dataColumns={[
            { key: 'date', label: t('chart.col.date', 'Date') },
            {
              key: 'capacity',
              label: `${t('analytics.battery.capacity', 'Capacity')} (${unitPrefs.energy})`,
            },
          ]}
          exportFilename="fleet-battery-capacity"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={displayTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={axisTick} unit={` ${unitPrefs.energy}`} />
              <Tooltip content={<ChartTooltip />} />
              <Line {...AREA_DEFAULTS} dataKey="capacity" name={`${t('analytics.battery.capacity', 'Capacity')} (${unitPrefs.energy})`} stroke={CHART_COLORS[0]} />
            </LineChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>

        {/* Range Trend */}
        <AnalyticsChartPanel
          title={t('analytics.battery.rangeTrend', 'Range trend')}
          icon={<MapPin className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={isEmpty}
          emptyMessage={t('analytics.battery.noData', 'No battery trend data available')}
          ariaLabel={`${t('analytics.battery.rangeChartAria', 'Battery range trend over time')} (${distanceUnit})`}
          size="standard"
          data={displayTrend}
          dataColumns={[
            { key: 'date', label: t('chart.col.date', 'Date') },
            {
              key: 'range',
              label: `${t('analytics.battery.range', 'Range')} (${distanceUnit})`,
            },
          ]}
          exportFilename="fleet-battery-range"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={displayTrend}
              margin={chartMarginLabeled}
              {...chartAnimation}
            >
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={axisTick} unit={` ${distanceUnit}`} />
              <Tooltip content={<ChartTooltip />} />
              <Line {...AREA_DEFAULTS} dataKey="range" name={`${t('analytics.battery.range', 'Range')} (${distanceUnit})`} stroke={CHART_COLORS[2]} />
            </LineChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>

        {/* Degradation & Cycles */}
        <AnalyticsChartPanel
          className="md:col-span-2 2xl:col-span-1"
          title={t('analytics.battery.degradationCycles', 'Degradation & cycles')}
          icon={<TrendingUp className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={isEmpty}
          emptyMessage={t('analytics.battery.noData', 'No battery trend data available')}
          ariaLabel={t('analytics.battery.degradationChartAria', 'Battery degradation and charge cycle count over time')}
          size="standard"
          data={displayTrend}
          dataColumns={[
            { key: 'date', label: t('chart.col.date', 'Date') },
            {
              key: 'degradation_pct',
              label: t('analytics.battery.degradPct', 'Degradation %'),
            },
            { key: 'cycle_count', label: t('analytics.battery.cycleCount', 'Cycle count') },
          ]}
          exportFilename="fleet-battery-degradation-cycles"
          chartKey="analytics-battery-degradation-cycles"
        >
          {({ hiddenSeries }) => (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={displayTrend} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis yAxisId="left" tick={axisTick} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                <defs>
                  <ChartGradient id="degradGrad" color={CHART_COLORS[5]} />
                </defs>
                <Area {...AREA_DEFAULTS} yAxisId="left" dataKey="degradation_pct" name={t('analytics.battery.degradPct', 'Degradation %')} stroke={CHART_COLORS[5]} fill="url(#degradGrad)" hide={hiddenSeries?.isHidden('degradation_pct')} />
                <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="cycle_count" name={t('analytics.battery.cycleCount', 'Cycle count')} stroke={CHART_COLORS[4]} hide={hiddenSeries?.isHidden('cycle_count')} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartPanel>
      </section>
    </FadeIn>
  );
}
