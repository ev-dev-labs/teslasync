import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import { ChartCard, LayoutCard } from '@/components/layout';
import { Text, Code } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import {
  ChartTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, CHART_COLORS,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { SlowQueryRow } from '@/types/admin-operator-confidence';

interface SlowQueryAnalysisProps {
  chartRows: Array<{ key: number; label: string; full: string; value: number }>;
  cacheLeaders: Array<{ row: SlowQueryRow; ratio: number }>;
  metricLabel: string;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  formatMetric: (value: number) => string;
  axisFormat: (value: number) => string;
}

export function SlowQueryAnalysis({
  chartRows, cacheLeaders, metricLabel, loading, error, onRetry, formatMetric, axisFormat,
}: SlowQueryAnalysisProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const chartTitle = t('admin.slowQueries.chartTitle', 'Top queries by {{metric}}', { metric: metricLabel });
  return (
    <section aria-label={t('admin.slowQueries.analysis', 'Query analysis')}
      className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
      <div className="min-w-0 xl:col-span-2">
        <ChartCard title={chartTitle} size="compact" fluid
          ariaLabel={t('admin.slowQueries.chartAria', 'Horizontal bar chart ranking the top queries by {{metric}}', { metric: metricLabel })}
          loading={loading} error={error ?? undefined} onRetry={onRetry}
          empty={!loading && !error && chartRows.length === 0}
          emptyMessage={t('admin.slowQueries.noChart', 'No queries to chart yet.')}
          data={chartRows} dataColumns={[
            { key: 'full', label: t('admin.slowQueries.colQuery', 'Query') },
            { key: 'value', label: metricLabel, format: value => formatMetric(Number(value)) },
          ]}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={chartRows} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} horizontal={false} />
              <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={value => axisFormat(Number(value))} />
              <YAxis type="category" dataKey="label" width={150} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip valueFormatter={value => formatMetric(Number(value))} />}
                cursor={{ fill: 'var(--surface-2)', fillOpacity: 0.3 }} />
              <Bar dataKey="value" name={metricLabel} radius={[0, 4, 4, 0]}>
                {chartRows.map((row, index) => <Cell key={row.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <LayoutCard title={t('admin.slowQueries.cacheTitle', 'Cache efficiency')}
        actions={<HardDrive className="h-4 w-4 text-cyan-300" aria-hidden />}>
        {loading ? <Skeleton height={260} /> : error ? <QueryError error={error} onRetry={onRetry} /> : cacheLeaders.length === 0 ? (
          // no-action: queries without shared-buffer activity have no cache ratio; the UI cannot create Postgres buffer statistics.
          <EmptyState icon={<HardDrive className="h-8 w-8" aria-hidden />}
            message={t('admin.slowQueries.noCache', 'No shared-buffer statistics available for these queries.')} />
        ) : (
          <div className="space-y-3">
            <Text variant="helper">{t('admin.slowQueries.cacheHint', 'Lowest hit ratios first — I/O-bound queries are the strongest indexing candidates.')}</Text>
            {cacheLeaders.map(({ row, ratio }) => (
              <div key={row.query_id} className="min-w-0 space-y-1">
                <Code className="block break-words [overflow-wrap:anywhere]">{row.fingerprint || '—'}</Code>
                <MetricBar label={row.fingerprint.length > 30 ? `${row.fingerprint.slice(0, 29)}…` : row.fingerprint || '—'} value={ratio} max={100}
                  color={ratio >= 90 ? '#10b981' : ratio >= 50 ? '#f59e0b' : '#ef4444'}
                  sublabel={`${fmtNumber(ratio)}%`}
                  ariaLabel={row.fingerprint || '—'} />
              </div>
            ))}
          </div>
        )}
      </LayoutCard>
    </section>
  );
}
