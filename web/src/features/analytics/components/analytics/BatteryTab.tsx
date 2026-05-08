import { useTranslation } from 'react-i18next';
import { Heart, Battery, TrendingUp, MapPin, Activity } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  ChartTooltip, ChartGradient,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  LineChart, Line, AreaChart, Area, ComposedChart,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { FleetAnalytics } from '@/api/types';
import { SectionTitle } from './helpers';

export function BatteryTab({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const distanceUnit = unitPrefs.distance;
  // backend `range_km` is SI km; convert via meter-floored helper.
  const fromKm = (km: number) => convertDistanceFromSI(km * 1000, distanceUnit);

  const trend = data?.battery_trend ?? [];
  const latest = trend.length > 0 ? trend[trend.length - 1] : null;

  if (trend.length === 0) {
    return (
      <FadeIn className="mt-4">
        <GlassPanel className="p-6">
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            message={t('analytics.battery.noData', 'No battery trend data available')}
            icon={<Battery className="h-10 w-10" />}
          />
        </GlassPanel>
      </FadeIn>
    );
  }

  return (
    <FadeIn className="space-y-4 mt-4">
      {/* Battery Health Cards */}
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

      {/* Health Score Timeline */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.battery.healthTimeline', 'Health Score Timeline')}</SectionTitle>
        <ResponsiveContainer width="100%" height={280}>
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
      </GlassPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Capacity Trend */}
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.battery.capacityTrend', 'Capacity Trend')}</SectionTitle>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Line {...AREA_DEFAULTS} dataKey="capacity_wh" name={t('analytics.battery.capacity', 'Capacity')} stroke={CHART_COLORS[0]} />
            </LineChart>
          </ResponsiveContainer>
        </GlassPanel>

        {/* Range Trend */}
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.battery.rangeTrend', 'Range Trend')}</SectionTitle>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={trend.map((d) => ({ ...d, range: fromKm(safe(d.range_km)) }))}
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
        </GlassPanel>
      </div>

      {/* Degradation & Cycles */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.battery.degradationCycles', 'Degradation & Cycles')}</SectionTitle>
        <ResponsiveContainer width="100%" height={280}>
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
      </GlassPanel>
    </FadeIn>
  );
}
