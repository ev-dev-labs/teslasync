import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, Battery, TrendingUp, MapPin, Activity } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import {
  ChartTooltip, ChartGradient,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  LineChart, Line, AreaChart, Area, ComposedChart,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { AnalyticsPanel } from './AnalyticsPanel';
import { MetricBandSkeleton } from './helpers';
import type { FleetAnalyticsQuery } from './constants';

export function BatteryTab({ query }: { query: FleetAnalyticsQuery }) {
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

  // Range trend is plotted in the user's distance unit; derive once instead of
  // building a fresh array literal inline on every render.
  const rangeData = useMemo(
    () => trend.map((d) => ({ ...d, range: fromKm(safe(d.range_km)) })),
    [trend, fromKm],
  );

  return (
    <FadeIn className="mt-4 space-y-4 xl:space-y-5">
      {/* Battery Health Cards band */}
      {isLoading ? (
        <MetricBandSkeleton count={5} className="lg:grid-cols-5" />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <MetricCard
            label={t('analytics.battery.healthScore', 'Health Score')}
            value={latest ? fmtNumber(safe(latest.health_score), 1) : '—'}
            subtitle="%"
            icon={<Heart className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('analytics.battery.capacity', 'Capacity')}
            value={latest ? formatEnergy(safe(latest.capacity_wh), { precision: 1 }) : '—'}
            icon={<Battery className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('analytics.battery.degradation', 'Degradation')}
            value={latest ? fmtNumber(safe(latest.degradation_pct), 2) : '—'}
            subtitle="%"
            icon={<TrendingUp className="h-4 w-4" />}
            color="amber"
          />
          <MetricCard
            label={t('analytics.battery.estRange', 'Est. Range')}
            value={latest ? fmtNumber(fromKm(safe(latest.range_km)), 0) : '—'}
            subtitle={distanceUnit}
            icon={<MapPin className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('analytics.battery.cycles', 'Cycles')}
            value={latest ? fmtInt(safe(latest.cycle_count)) : '—'}
            icon={<Activity className="h-4 w-4" />}
            color="cyan"
          />
        </div>
      )}

      <section
        aria-label={t('analytics.tabs.battery', 'Battery')}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5 2xl:grid-cols-3"
      >
        {/* Health Score Timeline — hero band */}
        <AnalyticsPanel
          className="md:col-span-2 2xl:col-span-3"
          title={t('analytics.battery.healthTimeline', 'Health Score Timeline')}
          icon={<Heart className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={isEmpty}
          emptyMessage={t('analytics.battery.noData', 'No battery trend data available')}
          emptyIcon={<Battery className="h-10 w-10" />}
        >
          <div
            className="h-72 sm:h-80"
            role="img"
            aria-label={t('analytics.battery.healthChartAria', 'Battery health score trend over time')}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={chartMarginLabeled} {...chartAnimation}>
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
          </div>
        </AnalyticsPanel>

        {/* Capacity Trend */}
        <AnalyticsPanel
          title={t('analytics.battery.capacityTrend', 'Capacity Trend')}
          icon={<Battery className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={isEmpty}
          emptyMessage={t('analytics.battery.noData', 'No battery trend data available')}
        >
          <div
            className="h-64 sm:h-72"
            role="img"
            aria-label={t('analytics.battery.capacityChartAria', 'Battery capacity trend over time')}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Line {...AREA_DEFAULTS} dataKey="capacity_wh" name={t('analytics.battery.capacity', 'Capacity')} stroke={CHART_COLORS[0]} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>

        {/* Range Trend */}
        <AnalyticsPanel
          title={t('analytics.battery.rangeTrend', 'Range Trend')}
          icon={<MapPin className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={isEmpty}
          emptyMessage={t('analytics.battery.noData', 'No battery trend data available')}
        >
          <div
            className="h-64 sm:h-72"
            role="img"
            aria-label={`${t('analytics.battery.rangeChartAria', 'Battery range trend over time')} (${distanceUnit})`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={rangeData}
                margin={chartMarginLabeled}
                {...chartAnimation}
              >
                {chartGrid}
                <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Line {...AREA_DEFAULTS} dataKey="range" name={`${t('analytics.battery.range', 'Range')} (${distanceUnit})`} stroke={CHART_COLORS[2]} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>

        {/* Degradation & Cycles */}
        <AnalyticsPanel
          className="md:col-span-2 2xl:col-span-1"
          title={t('analytics.battery.degradationCycles', 'Degradation & Cycles')}
          icon={<TrendingUp className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={isEmpty}
          emptyMessage={t('analytics.battery.noData', 'No battery trend data available')}
        >
          <div
            className="h-64 sm:h-72"
            role="img"
            aria-label={t('analytics.battery.degradationChartAria', 'Battery degradation and charge cycle count over time')}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis yAxisId="left" tick={axisTick} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <defs>
                  <ChartGradient id="degradGrad" color={CHART_COLORS[5]} />
                </defs>
                <Area {...AREA_DEFAULTS} yAxisId="left" dataKey="degradation_pct" name={t('analytics.battery.degradPct', 'Degradation %')} stroke={CHART_COLORS[5]} fill="url(#degradGrad)" />
                <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="cycle_count" name={t('analytics.battery.cycleCount', 'Cycle Count')} stroke={CHART_COLORS[4]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>
      </section>
    </FadeIn>
  );
}
