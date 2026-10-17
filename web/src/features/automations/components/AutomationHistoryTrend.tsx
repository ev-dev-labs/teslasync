import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bar, BarChart, CartesianGrid, ChartContainer, ChartLegend,
  ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import type { AutomationHistoryListResponse } from '@/api/types';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { gaugeTone } from '@/lib/tokens';

export function AutomationHistoryTrend({ query }: { query: UseQueryResult<AutomationHistoryListResponse> }) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat('utc');
  const periodLabel = (period: unknown) => {
    if (typeof period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(period)) return formatDate(null);
    const date = new Date(`${period}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== period) return formatDate(null);
    return formatDate(date);
  };
  const trend = query.data?.trend;
  const source = useDataState({ ...query, data: query.data ?? undefined });
  const points = useMemo(() => {
    const buckets = new Map<string, { period: string; success: number; failed: number; other: number }>();
    for (const row of trend ?? []) {
      const period = row.day ?? '';
      const point = buckets.get(period) ?? { period, success: 0, failed: 0, other: 0 };
      if (row.status === 'success') point.success += row.count;
      else if (row.status === 'failed') point.failed += row.count;
      else point.other += row.count;
      buckets.set(period, point);
    }
    return Array.from(buckets.values()).sort((a, b) => a.period.localeCompare(b.period));
  }, [trend]);
  return (
    <ChartContainer
      title={t('automations.historyPage.trend', 'Execution activity')}
      subtitle={t('teslaUsage.daily', 'Daily (UTC)')}
      ariaLabel={t('automations.historyPage.trendAria', 'Execution outcomes across the selected period')}
      chartKey="automation-history-trend"
      loading={query.isLoading && !source.hasData}
      error={source.fatalError}
      onRetry={() => { void query.refetch(); }}
      empty={Boolean(query.data) && points.length === 0}
      emptyActionTo={{ label: t('automations.historyPage.manage', 'Manage automation rules'), to: '/automations/list' }}
      data={points}
      dataColumns={[
        { key: 'period', label: t('automations.historyPage.period', 'Period'), format: periodLabel },
        { key: 'success', label: t('automations.historyPage.success', 'Succeeded') },
        { key: 'failed', label: t('automations.historyPage.failed', 'Failed') },
        { key: 'other', label: t('automations.historyPage.other', 'Other outcomes') },
      ]}
    >
      {({ hiddenSeries }) => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period" tickFormatter={periodLabel} />
            <YAxis allowDecimals={false} />
            <Tooltip content={<ChartTooltip labelFormatter={periodLabel} />} />
            <ChartLegend />
            <Bar dataKey="success" name={t('automations.historyPage.success', 'Succeeded')} fill={gaugeTone.success} hide={hiddenSeries?.isHidden('success') ?? false} />
            <Bar dataKey="failed" name={t('automations.historyPage.failed', 'Failed')} fill={gaugeTone.danger} hide={hiddenSeries?.isHidden('failed') ?? false} />
            <Bar dataKey="other" name={t('automations.historyPage.other', 'Other outcomes')} fill={gaugeTone.neutral} hide={hiddenSeries?.isHidden('other') ?? false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
