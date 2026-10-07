import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bar, BarChart, CartesianGrid, ChartContainer, ChartLegend,
  ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import type { AutomationHistoryListResponse } from '@/api/types';

export function AutomationHistoryTrend({ query }: { query: UseQueryResult<AutomationHistoryListResponse> }) {
  const { t } = useTranslation();
  const trend = query.data?.trend;
  const resolution = (trend?.length ?? 0) > 3650 ? 4 : (trend?.length ?? 0) > 730 ? 7 : 10;
  const points = useMemo(() => {
    const buckets = new Map<string, { period: string; success: number; failed: number; other: number }>();
    for (const row of trend ?? []) {
      const period = row.day.slice(0, resolution);
      const point = buckets.get(period) ?? { period, success: 0, failed: 0, other: 0 };
      if (row.status === 'success') point.success += row.count;
      else if (row.status === 'failed') point.failed += row.count;
      else point.other += row.count;
      buckets.set(period, point);
    }
    return Array.from(buckets.values()).sort((a, b) => a.period.localeCompare(b.period));
  }, [trend, resolution]);
  return (
    <ChartContainer
      title={t('automations.historyPage.trend', 'Execution activity')}
      ariaLabel={t('automations.historyPage.trendAria', 'Execution outcomes across the selected period')}
      chartKey="automation-history-trend"
      loading={query.isLoading && !query.data}
      error={query.isError && !query.data ? query.error : undefined}
      onRetry={() => { void query.refetch(); }}
      empty={Boolean(query.data) && points.length === 0}
      emptyActionTo={{ label: t('automations.historyPage.manage', 'Manage automation rules'), to: '/automations/list' }}
      data={points}
      dataColumns={[
        { key: 'period', label: t('automations.historyPage.period', 'Period') },
        { key: 'success', label: t('automations.historyPage.success', 'Succeeded') },
        { key: 'failed', label: t('automations.historyPage.failed', 'Failed') },
        { key: 'other', label: t('automations.historyPage.other', 'Other outcomes') },
      ]}
    >
      {({ hiddenSeries }) => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period" />
            <YAxis allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <ChartLegend />
            <Bar dataKey="success" name={t('automations.historyPage.success', 'Succeeded')} fill="#34d399" hide={hiddenSeries?.isHidden('success') ?? false} />
            <Bar dataKey="failed" name={t('automations.historyPage.failed', 'Failed')} fill="#fb7185" hide={hiddenSeries?.isHidden('failed') ?? false} />
            <Bar dataKey="other" name={t('automations.historyPage.other', 'Other outcomes')} fill="#a78bfa" hide={hiddenSeries?.isHidden('other') ?? false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
