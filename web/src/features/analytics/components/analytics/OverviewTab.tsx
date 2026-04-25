import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import type { FleetAnalytics } from '@/api/types';
import { SectionTitle } from './helpers';
import { QUICK_LINKS } from './constants';
import { OverviewVehicleComparison } from './OverviewVehicleComparison';

export function OverviewTab({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { convertDistance, distanceUnit } = useSettings();

  const vehicles = data?.vehicle_comparison ?? [];
  const monthlyTrend = data?.charging_analytics?.monthly_trend ?? [];
  const dowData = data?.drive_analytics?.day_of_week ?? [];

  const vehicleDistData = useMemo(
    () => vehicles.map((v) => ({ name: v.name, distance: convertDistance(safe(v.distance)) })),
    [vehicles, convertDistance],
  );

  return (
    <FadeIn className="space-y-4 mt-4">
      {/* Distance by Vehicle */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.overview.distByVehicle', 'Distance by Vehicle')}</SectionTitle>
        {vehicleDistData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={vehicleDistData} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="name" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="distance" name={distanceUnit} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.overview.noVehicles', 'No vehicle data')} />
        )}
      </GlassPanel>

      <OverviewVehicleComparison data={data} />

      {/* Day of Week Pattern */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.overview.dayOfWeek', 'Day of Week Pattern')}</SectionTitle>
        {dowData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={dowData} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="day" tick={axisTickSm} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="drives" name={t('analytics.overview.drives', 'Drives')} fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} />
              <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="avg_distance" name={t('analytics.overview.avgDist', 'Avg Distance')} stroke={CHART_COLORS[3]} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.overview.noDow', 'No day-of-week data')} />
        )}
      </GlassPanel>

      {/* Monthly Cost Comparison */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.overview.monthlyCost', 'Monthly Cost Comparison')}</SectionTitle>
        {monthlyTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthlyTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="month" tick={axisTickSm} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="cost" name={t('analytics.overview.electricCost', 'Electric Cost')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
              <Bar yAxisId="left" dataKey="gas_cost" name={t('analytics.overview.gasCost', 'Gas Cost')} fill={CHART_COLORS[5]} radius={[3, 3, 0, 0]} />
              <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="savings" name={t('analytics.overview.savings', 'Savings')} stroke={CHART_COLORS[1]} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.overview.noMonthly', 'No monthly data')} />
        )}
      </GlassPanel>

      {/* Quick Links */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.overview.quickLinks', 'Quick Links')}</SectionTitle>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {QUICK_LINKS.map((link) => (
            <Link key={link.href} to={link.href} className="block">
              <GlassPanel hover glow="cyan" className="flex items-center gap-3 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                  {link.icon}
                </div>
                <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
                  {t(link.labelKey, link.labelKey.split('.').pop() ?? '')}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              </GlassPanel>
            </Link>
          ))}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
