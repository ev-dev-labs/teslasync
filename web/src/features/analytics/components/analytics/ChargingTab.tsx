import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Plug, Zap, DollarSign, Gauge, Timer, TrendingUp, PieChart as PieChartIcon, Battery, Clock } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import {
  ChartTooltip,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  BarChart, Bar, ComposedChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { AnalyticsPanel } from './AnalyticsPanel';
import { MetricBandSkeleton } from './helpers';
import { PIE_COLORS } from './constants';
import { ChargingDetailSection } from './ChargingDetailSection';
import type { FleetAnalyticsQuery } from './constants';

export function ChargingTab({ query }: { query: FleetAnalyticsQuery }) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  const { data, isLoading, isError, error, refetch } = query;
  const err = isError ? error : undefined;

  const ca = data?.charging_analytics;
  const chargerTypes = ca?.charger_types ?? [];
  const batteryDist = ca?.start_battery_dist ?? [];
  const hourly = ca?.hourly_pattern ?? [];
  const powerStats = ca?.power_stats;
  const durStats = ca?.duration_stats;
  const effStats = ca?.efficiency_stats;

  return (
    <FadeIn className="mt-4 space-y-4 xl:space-y-5">
      {/* Summary Cards band */}
      <section aria-label={t('analytics.charging.summary', 'Charging summary metrics')}>
        {isLoading ? (
          <MetricBandSkeleton count={6} />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              label={t('analytics.charging.sessions', 'Sessions')}
              value={data ? fmtInt(data.total_charging_sessions ?? 0) : '—'}
              icon={<Plug className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('analytics.charging.totalEnergy', 'Total Energy')}
              value={data ? fmtNumber(data.total_energy_kwh ?? 0, 1) : '—'}
              subtitle="kWh"
              icon={<Zap className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('analytics.charging.totalCost', 'Total Cost')}
              value={data ? formatCurrency(data.total_cost ?? 0, 2) : '—'}
              icon={<DollarSign className="h-4 w-4" />}
              color="amber"
            />
            <MetricCard
              label={t('analytics.charging.avgPower', 'Avg Power')}
              value={powerStats ? fmtNumber(safe(powerStats.avg), 1) : '—'}
              subtitle="kW"
              icon={<Gauge className="h-4 w-4" />}
              color="purple"
            />
            <MetricCard
              label={t('analytics.charging.avgDuration', 'Avg Duration')}
              value={durStats ? fmtNumber(safe(durStats.avg), 0) : '—'}
              subtitle={t('analytics.charging.min', 'min')}
              icon={<Timer className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('analytics.charging.chargeEff', 'Charge Efficiency')}
              value={effStats ? fmtNumber(safe(effStats.avg), 1) : '—'}
              subtitle="%"
              icon={<TrendingUp className="h-4 w-4" />}
              color="green"
            />
          </div>
        )}
      </section>

      <section
        aria-label={t('analytics.tabs.charging', 'Charging')}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5 2xl:grid-cols-3"
      >
        {/* Charger Types Donut */}
        <AnalyticsPanel
          title={t('analytics.charging.chargerTypes', 'Charger Types')}
          icon={<PieChartIcon className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={chargerTypes.length === 0}
          emptyMessage={t('analytics.charging.noTypes', 'No charger type data')}
        >
          <div className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chargerTypes}
                  dataKey="count"
                  nameKey="type"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={3}
                >
                  {chargerTypes.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>

        {/* Start Battery Distribution */}
        <AnalyticsPanel
          title={t('analytics.charging.startBattery', 'Start Battery Distribution')}
          icon={<Battery className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={batteryDist.length === 0}
          emptyMessage={t('analytics.charging.noBatDist', 'No battery distribution data')}
        >
          <div className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={batteryDist} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="range" tick={axisTickSm} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name={t('analytics.charging.sessions', 'Sessions')} fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>

        {/* Hourly Charging Pattern */}
        <AnalyticsPanel
          title={t('analytics.charging.hourlyPattern', 'Hourly Charging Pattern')}
          icon={<Clock className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={hourly.length === 0}
          emptyMessage={t('analytics.charging.noHourly', 'No hourly data')}
        >
          <div className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hourly} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="hour" tick={axisTickSm} tickFormatter={(h: number) => `${h}:00`} />
                <YAxis yAxisId="left" tick={axisTick} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Bar yAxisId="left" dataKey="charges" name={t('analytics.charging.charges', 'Charges')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
                <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="energy" name={t('analytics.charging.energykWh', 'Energy (kWh)')} stroke={CHART_COLORS[3]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>

        {/* Charger Brands · Cost by Type · Cost Analysis · Monthly Trend (band) */}
        <ChargingDetailSection query={query} />
      </section>
    </FadeIn>
  );
}
