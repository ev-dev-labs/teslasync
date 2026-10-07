import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { PieChart as PieChartIcon, Battery, Clock } from 'lucide-react';
import type { StatMetric } from '@/components/data-display';
import {
  ChartTooltip,
  ChartLegend,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, CHART_COLORS,
  BarChart, Bar, ComposedChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';

import { AnalyticsChartPanel } from './AnalyticsChartPanel';
import { FleetSectionBrief } from '../operationalbrief-a-m/FleetSectionBrief';
import { PIE_COLORS } from './constants';
import { ChargingDetailSection } from './ChargingDetailSection';
import type { FleetAnalyticsQuery } from './constants';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ChargingTab({ query }: { query: FleetAnalyticsQuery }) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
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
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'charging-sessions', rawValue: data?.total_charging_sessions,
      label: t('analytics.charging.sessions', 'Sessions'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'charging-total-energy', rawValue: data?.total_energy_kwh != null ? data.total_energy_kwh * 1000 : null,
      label: t('analytics.charging.totalEnergy', 'Total energy'),
      display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kWh' }) } },
    { metricId: 'currency', occurrenceId: 'charging-total-cost', rawValue: data?.total_cost,
      label: t('analytics.charging.totalCost', 'Total cost'),
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) } },
    { metricId: 'power', occurrenceId: 'charging-average-power', rawValue: powerStats?.avg != null ? powerStats.avg * 1000 : null,
      label: t('analytics.charging.avgPower', 'Avg power'),
      display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kW' }) } },
    { metricId: 'duration', occurrenceId: 'charging-average-duration', rawValue: durStats?.avg != null ? durStats.avg * 60 : null,
      label: t('analytics.charging.avgDuration', 'Avg duration'),
      display: { formatter: raw => ({ value: fmtNumber(raw / 60), unit: t('analytics.charging.min', 'min') }) } },
    { metricId: 'percent', occurrenceId: 'charging-efficiency', rawValue: effStats?.avg,
      label: t('analytics.charging.chargeEff', 'Charge efficiency'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) } },
  ];

  return (
    <FadeIn className="mt-4 space-y-4 xl:space-y-5">
      {/* Summary Cards band */}
      <section aria-label={t('analytics.charging.summary', 'Charging summary metrics')}>
        <FleetSectionBrief query={query} metrics={metrics}
          title={t('analytics.brief.chargingTitle', 'Returned charging measurements')}
          description={t('analytics.brief.chargingDescription', 'Returned fleet totals and charging statistics retain their source denominations and selected-range coverage.')} />
      </section>

      <section
        aria-label={t('analytics.tabs.charging', 'Charging')}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5 2xl:grid-cols-3"
      >
        {/* Charger Types Donut */}
        <AnalyticsChartPanel
          title={t('analytics.charging.chargerTypes', 'Charger types')}
          icon={<PieChartIcon className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={chargerTypes.length === 0}
          emptyMessage={t('analytics.charging.noTypes', 'No charger type data')}
          ariaLabel={t('analytics.charging.chargerTypesAria', 'Charging sessions by charger type')}
          data={chargerTypes}
          dataColumns={[
            { key: 'type', label: t('analytics.charging.chargerType', 'Charger type') },
            { key: 'count', label: t('analytics.charging.sessions', 'Sessions') },
          ]}
          exportFilename="fleet-charger-types"
        >
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
              <ChartLegend />
            </PieChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>

        {/* Start Battery Distribution */}
        <AnalyticsChartPanel
          title={t('analytics.charging.startBattery', 'Start battery distribution')}
          icon={<Battery className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={batteryDist.length === 0}
          emptyMessage={t('analytics.charging.noBatDist', 'No battery distribution data')}
          ariaLabel={t('analytics.charging.startBatteryAria', 'Charging sessions by starting battery level')}
          data={batteryDist}
          dataColumns={[
            { key: 'range', label: t('analytics.charging.batteryRange', 'Battery level') },
            { key: 'count', label: t('analytics.charging.sessions', 'Sessions') },
          ]}
          exportFilename="fleet-start-battery-distribution"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={batteryDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('analytics.charging.sessions', 'Sessions')} fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>

        {/* Hourly Charging Pattern */}
        <AnalyticsChartPanel
          title={t('analytics.charging.hourlyPattern', 'Hourly charging pattern')}
          icon={<Clock className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={hourly.length === 0}
          emptyMessage={t('analytics.charging.noHourly', 'No hourly data')}
          ariaLabel={t('analytics.charging.hourlyPatternAria', 'Charging sessions and energy by hour of day')}
          data={hourly}
          dataColumns={[
            { key: 'hour', label: t('analytics.charging.hour', 'Hour') },
            { key: 'charges', label: t('analytics.charging.charges', 'Charges') },
            { key: 'energy', label: t('analytics.charging.energykWh', 'Energy (kWh)') },
          ]}
          exportFilename="fleet-hourly-charging"
          chartKey="analytics-hourly-charging"
        >
          {({ hiddenSeries }) => (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hourly} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="hour" tick={axisTickSm} tickFormatter={(h: number) => `${h}:00`} />
                <YAxis yAxisId="left" tick={axisTick} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                <Bar yAxisId="left" dataKey="charges" name={t('analytics.charging.charges', 'Charges')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} hide={hiddenSeries?.isHidden('charges')} />
                <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="energy" name={t('analytics.charging.energykWh', 'Energy (kWh)')} stroke={CHART_COLORS[3]} hide={hiddenSeries?.isHidden('energy')} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartPanel>

        {/* Charger Brands · Cost by Type · Cost Analysis · Monthly Trend (band) */}
        <ChargingDetailSection query={query} />
      </section>
    </FadeIn>
  );
}
