import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartContainer, ChartTooltip, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from '@/components/charts';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import type { DataState } from '@/api/dataState';
import { cn } from '@/lib/cn';
import { chartTokens } from '@/lib/tokens';
import type { ChargerHealthSummary } from '../../lib/chargerHealth';
import { ChargerHealthSourceNotice } from './ChargerHealthSourceNotice';

interface ChargerHealthChartProps {
  summary: ChargerHealthSummary;
  state: DataState<unknown>;
  loading: boolean;
}

export function ChargerHealthChart({ summary, state, loading }: ChargerHealthChartProps) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  // Preserve the original chart's eligibility, scaling, rounding and ordering.
  // baseline/recent are its historical kW fallback-table operands, NOT hook SI.
  const chartData = useMemo(() => summary.sites
    .filter(site => site.status !== 'unknown')
    .map(site => ({
      site: site.label,
      ratio: Math.round(site.performanceRatio * 1000) / 10,
      baseline: Math.round(site.baselineW / 100) / 10,
      recent: Math.round(site.recentW / 100) / 10,
      status: site.status,
    })), [summary.sites]);
  const exportData = useMemo(() => chartData
    .map(({ status, ...rest }) => ({ ...rest, status: String(status) })), [chartData]);

  return <FadeIn delay={0.1} className={cn('min-w-0 space-y-3', placement?.className ?? 'col-span-full')}>
    <ChargerHealthSourceNotice state={state} includeFatal={false} />
    <ChartContainer
      title={t('chargerHealth.chart', 'Recent Power vs. Own Baseline')}
      subtitle={t('chargerHealth.chartHint', '100 % means the site is still delivering everything it once did')}
      ariaLabel={t('chargerHealth.chartAria',
        'Bar chart of each charging site recent power as a percentage of its own demonstrated baseline')}
      loading={loading}
      error={state.fatalError}
      onRetry={state.retry ?? undefined}
      empty={chartData.length === 0}
      emptyMessage={!state.hasData && state.isRefreshBlocked
        ? t('chargerHealth.state.paused', 'Charging sessions loading is paused. Connect to resume or retry.')
        : t('chargerHealth.noData',
          'No charging location has enough clean sessions to benchmark yet. A few full-power charges at the same place is all it takes.')}
      height={340}
      data={exportData}
      exportData={exportData}
      dataColumns={[
        { key: 'site', label: t('chargerHealth.col.site', 'Site') },
        { key: 'ratio', label: t('chargerHealth.col.ratio', 'Performance (%)') },
        { key: 'baseline', label: t('chargerHealth.col.baseline', 'Baseline (kW)') },
        { key: 'recent', label: t('chargerHealth.col.recent', 'Recent (kW)') },
        { key: 'status', label: t('chargerHealth.col.status', 'Status') },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 42, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
          <XAxis dataKey="site" tickFormatter={(label: string) => label.length > 22 ? `${label.slice(0, 21)}…` : label}
            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
            angle={-30} textAnchor="end" height={64} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={[0, 110]} unit="%" />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine y={100} stroke={chartTokens.series[2]} strokeDasharray="4 4"
            label={{
              value: t('chargerHealth.baseline', 'Baseline'),
              position: 'right',
              fill: 'var(--text-muted)',
              fontSize: 11,
            }} />
          <Bar dataKey="ratio" name={t('chargerHealth.col.ratio', 'Performance (%)')} radius={[3, 3, 0, 0]}>
            {chartData.map((datum, index) => <Cell key={`${datum.site}-${index}`}
              fill={datum.status === 'healthy' ? chartTokens.series[2]
                : datum.status === 'degrading' ? chartTokens.series[3] : chartTokens.series[5]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  </FadeIn>;
}
