import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, CalendarDays, DollarSign } from 'lucide-react';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import {
  ChartTooltip,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { AnalyticsPanel } from './AnalyticsPanel';
import { QUICK_LINKS } from './constants';
import type { FleetAnalyticsQuery } from './constants';
import { OverviewVehicleComparison } from './OverviewVehicleComparison';

export function OverviewTab({ query }: { query: FleetAnalyticsQuery }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;

  const { data, isLoading, isError, error, refetch } = query;
  const err = isError ? error : undefined;

  const vehicles = data?.vehicle_comparison ?? [];
  const monthlyTrend = data?.charging_analytics?.monthly_trend ?? [];
  const dowData = data?.drive_analytics?.day_of_week ?? [];

  const vehicleDistData = useMemo(
    // backend `vehicle_comparison[].distance` is SI km — convert via meter floor.
    () => vehicles.map((v) => ({ name: v.name ?? '—', distance: convertDistanceFromSI(safe(v.distance) * 1000, distanceUnit) })),
    [vehicles, distanceUnit],
  );

  return (
    <FadeIn className="mt-4 space-y-4 xl:space-y-5">
      <section
        aria-label={t('analytics.tabs.overview', 'Overview')}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5 2xl:grid-cols-3"
      >
        {/* Distance by Vehicle */}
        <AnalyticsPanel
          title={t('analytics.overview.distByVehicle', 'Distance by Vehicle')}
          icon={<MapPin className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={vehicleDistData.length === 0}
          emptyMessage={t('analytics.overview.noVehicles', 'No vehicle data')}
        >
          <div className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={vehicleDistData} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="name" tick={axisTickSm} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="distance" name={distanceUnit} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>

        {/* Fleet Usage · Efficiency Leaderboard · Vehicle Comparison · Energy & Activity */}
        <OverviewVehicleComparison query={query} />

        {/* Day of Week Pattern */}
        <AnalyticsPanel
          title={t('analytics.overview.dayOfWeek', 'Day of Week Pattern')}
          icon={<CalendarDays className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={dowData.length === 0}
          emptyMessage={t('analytics.overview.noDow', 'No day-of-week data')}
        >
          <div className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
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
          </div>
        </AnalyticsPanel>

        {/* Monthly Cost Comparison — hero band */}
        <AnalyticsPanel
          className="md:col-span-2 2xl:col-span-3"
          title={t('analytics.overview.monthlyCost', 'Monthly Cost Comparison')}
          icon={<DollarSign className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={monthlyTrend.length === 0}
          emptyMessage={t('analytics.overview.noMonthly', 'No monthly data')}
        >
          <div className="h-72 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
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
          </div>
        </AnalyticsPanel>
      </section>

      {/* Quick Links — full-width band */}
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3">{t('analytics.overview.quickLinks', 'Quick Links')}</PanelTitle>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {QUICK_LINKS.map((link) => (
            <Link key={link.href} to={link.href} className="block">
              <GlassPanel hover glow="cyan" className="flex items-center gap-3 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]" aria-hidden="true">
                  {link.icon}
                </div>
                <Text size="sm" weight="medium" color="primary" className="min-w-0 flex-1 truncate">
                  {t(link.labelKey, link.labelKey.split('.').pop() ?? '')}
                </Text>
                <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              </GlassPanel>
            </Link>
          ))}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
