import { useTranslation } from 'react-i18next';
import { Plug, Zap, DollarSign, Gauge, Timer, TrendingUp } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  ChartTooltip,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  BarChart, Bar, ComposedChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { FleetAnalytics } from '@/api/types';
import { SectionTitle } from './helpers';
import { PIE_COLORS } from './constants';
import { ChargingDetailSection } from './ChargingDetailSection';

export function ChargingTab({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();

  const ca = data?.charging_analytics;
  const chargerTypes = ca?.charger_types ?? [];
  const batteryDist = ca?.start_battery_dist ?? [];
  const hourly = ca?.hourly_pattern ?? [];
  const powerStats = ca?.power_stats;
  const durStats = ca?.duration_stats;
  const effStats = ca?.efficiency_stats;

  return (
    <FadeIn className="space-y-4 mt-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label={t('analytics.charging.sessions', 'Sessions')}
          value={fmtInt(data?.total_charging_sessions)}
          icon={<Plug className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('analytics.charging.totalEnergy', 'Total Energy')}
          value={fmtNumber(data?.total_energy_kwh, 1)}
          subtitle="kWh"
          icon={<Zap className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('analytics.charging.totalCost', 'Total Cost')}
          value={`$${fmtNumber(data?.total_cost, 2)}`}
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Charger Types Donut */}
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.charging.chargerTypes', 'Charger Types')}</SectionTitle>
          {chargerTypes.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
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
          ) : (
            <EmptyState message={t('analytics.charging.noTypes', 'No charger type data')} />
          )}
        </GlassPanel>

        {/* Start Battery Distribution */}
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.charging.startBattery', 'Start Battery Distribution')}</SectionTitle>
          {batteryDist.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={batteryDist} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="range" tick={axisTickSm} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name={t('analytics.charging.sessions', 'Sessions')} fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('analytics.charging.noBatDist', 'No battery distribution data')} />
          )}
        </GlassPanel>
      </div>

      {/* Hourly Charging Pattern */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.charging.hourlyPattern', 'Hourly Charging Pattern')}</SectionTitle>
        {hourly.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
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
        ) : (
          <EmptyState message={t('analytics.charging.noHourly', 'No hourly data')} />
        )}
      </GlassPanel>

      <ChargingDetailSection data={data} />
    </FadeIn>
  );
}
