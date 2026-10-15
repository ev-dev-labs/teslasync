import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, CalendarDays, DollarSign } from 'lucide-react';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import {
  ChartTooltip,
  ChartLegend,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { AnalyticsChartPanel } from './AnalyticsChartPanel';
import { QUICK_LINKS } from './constants';
import type { FleetAnalyticsQuery } from './constants';
import { OverviewVehicleComparison } from './OverviewVehicleComparison';

export function OverviewTab({ query }: { query: FleetAnalyticsQuery }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const { locale } = useDateFormat();
  const distanceUnit = unitPrefs.distance;

  const { data, isLoading, isError, error, refetch } = query;
  const err = isError ? error : undefined;

  const vehicles = data?.vehicle_comparison ?? [];
  const monthlyTrend = useMemo(
    () => (data?.charging_analytics?.monthly_trend ?? []).map((row) => ({
      ...row,
      savings: typeof row.savings === 'number' && Number.isFinite(row.savings) ? row.savings : null,
    })),
    [data?.charging_analytics?.monthly_trend],
  );
  const formatSavings = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const amount = formatCurrency(value);
    return value < 0
      ? `${amount} (${t('analytics.hero.additionalSpending', 'Additional spending')})`
      : amount;
  };
  const dowData = data?.drive_analytics?.day_of_week ?? [];

  const vehicleDistData = useMemo(
    // backend `vehicle_comparison[].distance` is SI km — convert via meter floor.
    () => vehicles.map((v) => ({ id: v.id, name: v.name ?? '—', distance: convertDistanceFromSI(safe(v.distance) * 1000, distanceUnit) })),
    [vehicles, distanceUnit],
  );
  const dowDisplayData = useMemo(
    () => {
      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
      return dowData.map((row) => {
        const weekday = weekdays.indexOf(row.day);
        return {
          ...row,
          // Aggregate identities are calendar buckets, not instants to timezone-shift.
          day_label: weekday >= 0
            ? formatter.format(new Date(Date.UTC(2000, 0, 2 + weekday)))
            : row.day || '—',
          avg_distance: convertDistanceFromSI(safe(row.avg_distance) * 1000, distanceUnit),
        };
      });
    },
    [distanceUnit, dowData, locale],
  );

  return (
    <FadeIn className="mt-4 space-y-4 xl:space-y-5">
      <section
        aria-label={t('analytics.tabs.overview', 'Overview')}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5 2xl:grid-cols-3"
      >
        {/* Distance by Vehicle */}
        <AnalyticsChartPanel
          title={t('analytics.overview.distByVehicle', 'Distance by vehicle')}
          icon={<MapPin className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={vehicleDistData.length === 0}
          emptyMessage={t('analytics.overview.noVehicles', 'No vehicle data')}
          ariaLabel={`${t('analytics.overview.distByVehicleAria', 'Distance driven by vehicle')} (${distanceUnit})`}
          data={vehicleDistData}
          dataColumns={[
            { key: 'name', label: t('analytics.overview.vehicle', 'Vehicle') },
            { key: 'distance', label: `${t('analytics.driving.distance', 'Distance')} (${distanceUnit})` },
          ]}
          exportFilename="fleet-distance-by-vehicle"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={vehicleDistData} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="name" tick={axisTickSm} />
              <YAxis tick={axisTick} unit={` ${distanceUnit}`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="distance" name={`${t('analytics.driving.distance', 'Distance')} (${distanceUnit})`} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChartPanel>

        {/* Fleet Usage · Efficiency Leaderboard · Vehicle Comparison · Energy & Activity */}
        <OverviewVehicleComparison query={query} />

        {/* Day of Week Pattern */}
        <AnalyticsChartPanel
          title={t('analytics.overview.dayOfWeek', 'Day of week pattern')}
          icon={<CalendarDays className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={dowData.length === 0}
          emptyMessage={t('analytics.overview.noDow', 'No day-of-week data')}
          ariaLabel={`${t('analytics.overview.dayOfWeekAria', 'Drive count and average distance by day of week')} (${distanceUnit})`}
          data={dowDisplayData}
          dataColumns={[
            { key: 'day_label', label: t('analytics.overview.day', 'Day') },
            { key: 'drives', label: t('analytics.overview.drives', 'Drives') },
            { key: 'avg_distance', label: `${t('analytics.overview.avgDist', 'Avg distance')} (${distanceUnit})` },
          ]}
          exportFilename="fleet-day-of-week"
          chartKey="analytics-day-of-week"
        >
          {({ hiddenSeries }) => (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dowDisplayData} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="day_label" tick={axisTickSm} />
                <YAxis yAxisId="left" tick={axisTick} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                <Bar yAxisId="left" dataKey="drives" name={t('analytics.overview.drives', 'Drives')} fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} hide={hiddenSeries?.isHidden('drives')} />
                <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="avg_distance" name={`${t('analytics.overview.avgDist', 'Avg distance')} (${distanceUnit})`} stroke={CHART_COLORS[3]} hide={hiddenSeries?.isHidden('avg_distance')} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartPanel>

        {/* Monthly Cost Comparison — hero band */}
        <AnalyticsChartPanel
          className="md:col-span-2 2xl:col-span-3"
          title={t('analytics.overview.monthlyCost', 'Monthly cost comparison')}
          icon={<DollarSign className="h-4 w-4" />}
          loading={isLoading}
          error={err}
          onRetry={refetch}
          isEmpty={monthlyTrend.length === 0}
          emptyMessage={t('analytics.overview.noMonthly', 'No monthly data')}
          ariaLabel={t(
            'analytics.overview.monthlyCostAria',
            'Monthly electric cost, gas cost, and savings comparison',
          )}
          size="detail"
          data={monthlyTrend}
          dataColumns={[
            { key: 'month', label: t('analytics.charging.month', 'Month') },
            { key: 'cost', label: t('analytics.overview.electricCost', 'Electric cost'), format: (value) => formatCurrency(safe(value)) },
            { key: 'gas_cost', label: t('analytics.overview.gasCost', 'Gas cost'), format: (value) => formatCurrency(safe(value)) },
            { key: 'savings', label: t('analytics.overview.savings', 'Savings'), format: formatSavings },
          ]}
          exportFilename="fleet-monthly-cost-comparison"
          chartKey="analytics-monthly-cost-comparison"
        >
          {({ hiddenSeries }) => (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyTrend} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="month" tick={axisTickSm} />
                <YAxis yAxisId="left" tick={axisTick} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} />
                <Tooltip content={<ChartTooltip formatter={(value, name, entry) => [
                  entry.dataKey === 'savings' ? formatSavings(value)
                    : typeof value === 'number' && Number.isFinite(value) ? formatCurrency(value) : '—',
                  name,
                ]} />} />
                <ChartLegend />
                <Bar yAxisId="left" dataKey="cost" name={t('analytics.overview.electricCost', 'Electric cost')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} hide={hiddenSeries?.isHidden('cost')} />
                <Bar yAxisId="left" dataKey="gas_cost" name={t('analytics.overview.gasCost', 'Gas cost')} fill={CHART_COLORS[5]} radius={[3, 3, 0, 0]} hide={hiddenSeries?.isHidden('gas_cost')} />
                <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="savings" name={t('analytics.overview.savings', 'Savings')} stroke={CHART_COLORS[1]} hide={hiddenSeries?.isHidden('savings')} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartPanel>
      </section>

      {/* Quick Links — full-width band */}
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3">{t('analytics.overview.quickLinks', 'Quick links')}</PanelTitle>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {QUICK_LINKS.map((link) => (
            <Link key={link.href} to={link.href} className="block">
              <GlassPanel hover className="flex items-center gap-3 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)]" aria-hidden="true">
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
