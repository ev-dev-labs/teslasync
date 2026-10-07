import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Building2, Plug, DollarSign, TrendingUp } from 'lucide-react';
import type { StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import {
  ChartTooltip,
  ChartLegend,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  ComposedChart, Line, Area, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts';

import { AnalyticsPanel } from './AnalyticsPanel';
import { AnalyticsChartPanel } from './AnalyticsChartPanel';
import type { FleetAnalyticsQuery } from './constants';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { FleetSectionBrief } from '../operationalbrief-a-m/FleetSectionBrief';

/** Stable bar corner-radius — hoisted so the hot chart JSX never allocates a fresh array per render. */
const BAR_RADIUS: [number, number, number, number] = [3, 3, 0, 0];

/**
 * Charging deep-dive panels (Charger Brands, Cost by Type, Cost Analysis,
 * Monthly Trend). Rendered as bare grid items so they flow into the Charging
 * tab's bento; the Monthly Trend spans a full-width hero band.
 */
export function ChargingDetailSection({ query }: { query: FleetAnalyticsQuery }) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  const { data, isLoading, isError, error, refetch } = query;
  const err = isError ? error : undefined;

  const ca = data?.charging_analytics;
  const brands = ca?.charger_brands ?? [];
  const chargerTypes = ca?.charger_types ?? [];
  const monthlyTrend = ca?.monthly_trend ?? [];
  const costStats = ca?.cost_stats;
  const metrics: StatMetric[] = [
    { metricId: 'currency', occurrenceId: 'charging-min-cost', rawValue: costStats?.min, label: t('analytics.charging.minCost', 'Min cost') },
    { metricId: 'currency', occurrenceId: 'charging-average-cost', rawValue: costStats?.avg, label: t('analytics.charging.avgCost', 'Avg cost') },
    { metricId: 'currency', occurrenceId: 'charging-median-cost', rawValue: costStats?.median, label: t('analytics.charging.medianCost', 'Median cost') },
    { metricId: 'currency', occurrenceId: 'charging-max-cost', rawValue: costStats?.max, label: t('analytics.charging.maxCost', 'Max cost') },
  ];
  const costMetrics: StatMetric[] = metrics.map(metric => ({
    ...metric,
    display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
  }));

  const brandLeaderboard = useMemo(() => {
    const maxCount = brands.reduce((m, b) => Math.max(m, safe(b.count)), 0) || 1;
    return brands.map((b) => ({ ...b, pct: (safe(b.count) / maxCount) * 100 }));
  }, [brands]);

  const typeTotal = chargerTypes.reduce((s, x) => s + safe(x.count), 0);

  return (
    <>
      {/* Charger Brands */}
      <AnalyticsPanel
        title={t('analytics.charging.chargerBrands', 'Charger brands')}
        icon={<Building2 className="h-4 w-4" />}
        loading={isLoading}
        error={err}
        onRetry={refetch}
        isEmpty={brandLeaderboard.length === 0}
        emptyMessage={t('analytics.charging.noBrands', 'No charger brand data')}
      >
        <div className="space-y-3">
          {brandLeaderboard.map((b, idx) => (
            <div key={`${idx}-${b.brand ?? 'unknown'}`}>
              <div className="mb-1 flex items-center justify-between">
                <Text size="xs" weight="medium" color="primary">
                  #{idx + 1} {b.brand ?? '—'}
                </Text>
                <Text size="xs" color="muted">
                  {fmtInt(b.count)} {t('analytics.charging.sessions', 'sessions')}
                </Text>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div
                  data-testid="charger-brand-fill"
                  className="h-full rounded-full bg-emerald-500 transition-all duration-slow"
                  style={{ width: `${b.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </AnalyticsPanel>

      {/* Cost by Charger Type */}
      <AnalyticsPanel
        title={t('analytics.charging.costByType', 'Cost by charger type')}
        icon={<Plug className="h-4 w-4" />}
        loading={isLoading}
        error={err}
        onRetry={refetch}
        isEmpty={chargerTypes.length === 0}
        emptyMessage={t('analytics.charging.noCostByType', 'No charger type data')}
      >
        <div className="space-y-3">
          {chargerTypes.map((ct, i) => {
            const pct = typeTotal > 0 ? (safe(ct.count) / typeTotal) * 100 : 0;
            return (
              <div key={i} className="flex items-center gap-3">
                <Text size="xs" weight="medium" color="secondary" className="w-28 truncate text-right">
                  {ct.type ?? '—'}
                </Text>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div
                    className="h-full rounded-full transition-all duration-slow"
                    style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                </div>
                <Text size="xs" color="primary" mono className="w-20 text-right">
                  {fmtInt(ct.count)} ({fmtInt(pct)}%)
                </Text>
              </div>
            );
          })}
        </div>
      </AnalyticsPanel>

      {/* Cost Analysis Cards */}
      <AnalyticsPanel
        title={t('analytics.brief.costTitle', 'Returned charging cost distribution')}
        icon={<DollarSign className="h-4 w-4" />}
        loading={isLoading}
        error={err}
        onRetry={refetch}
        isEmpty={!costStats}
        emptyMessage={t('analytics.charging.noCostStats', 'No cost statistics')}
        skeletonHeight={140}
      >
        <FleetSectionBrief query={query} metrics={costMetrics}
          title={t('analytics.charging.costAnalysis', 'Cost analysis')}
          description={t('analytics.brief.costDescription', 'Minimum, average, median and maximum returned charging costs; missing prices are not free charging.')} />
      </AnalyticsPanel>

      {/* Monthly Charging Trend — hero band */}
      <AnalyticsChartPanel
        className="md:col-span-2 2xl:col-span-3"
        title={t('analytics.charging.monthlyTrend', 'Monthly charging trend')}
        icon={<TrendingUp className="h-4 w-4" />}
        loading={isLoading}
        error={err}
        onRetry={refetch}
        isEmpty={monthlyTrend.length === 0}
        emptyMessage={t('analytics.charging.noMonthly', 'No monthly data')}
        ariaLabel={t(
          'analytics.charging.monthlyTrendAria',
          'Monthly charging energy, average power, and session count',
        )}
        size="detail"
        data={monthlyTrend}
        dataColumns={[
          { key: 'month', label: t('analytics.charging.month', 'Month') },
          { key: 'energy', label: t('analytics.charging.energykWh', 'Energy (kWh)') },
          { key: 'avg_power', label: t('analytics.charging.avgPowerkW', 'Avg power (kW)') },
          { key: 'sessions', label: t('analytics.charging.sessions', 'Sessions') },
        ]}
        exportFilename="fleet-monthly-charging"
        chartKey="analytics-monthly-charging"
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthlyTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="month" tick={axisTickSm} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              {areaGradient('monthlyEnergyGrad', CHART_COLORS[1])}
              <Area {...AREA_DEFAULTS} yAxisId="left" dataKey="energy" name={t('analytics.charging.energykWh', 'Energy (kWh)')} stroke={CHART_COLORS[1]} fill="url(#monthlyEnergyGrad)" hide={hiddenSeries?.isHidden('energy')} />
              <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="avg_power" name={t('analytics.charging.avgPowerkW', 'Avg power (kW)')} stroke={CHART_COLORS[3]} hide={hiddenSeries?.isHidden('avg_power')} />
              <Bar yAxisId="left" dataKey="sessions" name={t('analytics.charging.sessions', 'Sessions')} fill={CHART_COLORS[2]} radius={BAR_RADIUS} opacity={0.6} hide={hiddenSeries?.isHidden('sessions')} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </AnalyticsChartPanel>
    </>
  );
}
