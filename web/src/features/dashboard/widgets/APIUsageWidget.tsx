import { useTranslation } from 'react-i18next';
import { BarChart2 } from 'lucide-react';
import { EmptyState } from '@/components/feedback';

import { useApiLogStats } from '@/api/hooks/useAdmin';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function APIUsageWidget({ size }: WidgetProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const query = useApiLogStats();
  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const state = deriveDataState({ ...query, data: data ?? (isLoading || query.isError || query.error ? undefined : null) });

  const isCompact = size.cols <= 1;

  const totalCalls = knownNumber(data?.last24h);
  const avgResponseMs = knownNumber(data?.avgDurationMs);
  const errorRate = knownNumber(data?.errorRate);
  const errorCount = knownNumber(data?.errorCount);

  const blockingError = state.fatalError?.message;
  const stats: StatGridItem[] = [
    {
      label: t('widget.apiUsage.calls24h', 'Calls (24h)'),
      value: totalCalls == null ? null : fmtInt(totalCalls),
    },
    {
      label: t('widget.apiUsage.avgResponse', 'Avg response'),
      value: avgResponseMs == null ? null : fmtNumber(avgResponseMs),
      unit: avgResponseMs == null ? undefined : 'ms',
    },
    {
      label: t('widget.apiUsage.errorRate', 'Error rate'),
      value: errorRate == null ? null : fmtNumber(errorRate),
      unit: errorRate == null ? undefined : '%',
    },
  ];

  // Compact layout: single big number
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.apiUsage.title', 'API usage')}
        icon={<BarChart2 className="h-3.5 w-3.5" />}
        loading={isLoading}
        dataState={state}
        error={blockingError}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={refetch}
      >
        {data ? (
          <WidgetBigNumber
            value={totalCalls == null ? null : fmtInt(totalCalls)}
            label={t('widget.apiUsage.calls24h', 'Calls (24h)')}
            badge={errorRate != null && errorRate > 5 ? {
              text: `${fmtNumber(errorRate)}% ${t('widget.apiUsage.errors', 'errors')}`,
              variant: 'error',
            } : undefined}
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<BarChart2 className="h-5 w-5" />}
            message={t('widget.apiUsage.noData', 'No API usage data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // Standard (2×2) and Wide (2×4)
  return (
    <WidgetShell
      title={t('widget.apiUsage.title', 'API usage')}
      icon={<BarChart2 className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={state}
      error={blockingError}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={refetch}
    >
      <div className="min-w-0">
        {!data && (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<BarChart2 className="h-5 w-5" />}
            message={t('widget.apiUsage.noData', 'No API usage data')}
            className="py-4"
          />
        )}
        {data && <WidgetStatGrid stats={stats} cols={3} />}
      </div>
    </WidgetShell>
  );
}
