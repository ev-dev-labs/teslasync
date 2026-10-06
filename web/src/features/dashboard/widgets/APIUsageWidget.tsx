import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart2 } from 'lucide-react';
import { Badge } from '@/components/ui';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import { EmptyState } from '@/components/feedback';

import { useApiLogStats } from '@/api/hooks/useAdmin';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
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

  // Only replace the whole widget with a full-panel error on the INITIAL
  // load failure, when there is no cached data to fall back on. This widget
  // refetches on an interval, so once we have data a transient
  // background-refetch failure must not blank out otherwise-valid numbers —
  // it is surfaced through the freshness indicator's error state instead
  // (WidgetShell forwards `isError` to <DataFreshness>).
  const blockingError = state.fatalError?.message;

  const coreStats = useMemo((): StatMetric[] => {
    return [
      {
        label: t('widget.apiUsage.totalCalls', 'Total calls (24h)'),
        metricId: 'count',
        rawValue: totalCalls,
        description: t('widget.apiUsage.callsDescription', 'API calls reported by the 24-hour source counter.'),
      },
      {
        label: t('widget.apiUsage.avgResponse', 'Avg response'),
        metricId: 'duration',
        rawValue: avgResponseMs == null ? null : avgResponseMs / 1000,
        display: { formatter: raw => ({ value: fmtNumber(Number(raw) * 1000), unit: 'ms' }) },
        description: t('widget.apiUsage.responseDescription', 'Reported average latency; source milliseconds are retained as canonical seconds.'),
      },
      {
        label: t('widget.apiUsage.errorRate', 'Error rate'),
        metricId: 'percent',
        rawValue: errorRate,
        display: { formatter: raw => ({ value: fmtNumber(Number(raw)), unit: '%' }) },
        description: t('widget.apiUsage.errorRateDescription', 'Reported error percentage; the existing high-error threshold is above 5%.'),
        comparisonContent: errorRate != null && errorRate > 5 ? <Badge variant="danger"><span aria-hidden="true">↓</span><span>{t('widget.apiUsage.highErrors', 'High')}</span></Badge> : undefined,
      },
      {
        label: t('widget.apiUsage.totalErrors', 'Errors'),
        metricId: 'count',
        rawValue: errorCount,
        description: t('widget.apiUsage.errorCountDescription', 'Recorded API errors; a missing counter is not zero.'),
        comparisonContent: errorCount != null && errorCount > 0 ? <Badge variant="danger">{t('widget.apiUsage.errors', 'errors')}</Badge> : undefined,
      },
    ];
  }, [data, totalCalls, avgResponseMs, errorRate, errorCount, t, fmtInt, fmtNumber]);

  // Compact layout: single big number
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.apiUsage.summaryTitle', 'API source counters')}
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
        <div className="space-y-3 min-w-0">
          <DashboardSourceBrief
            metrics={coreStats} state={state}
            eyebrow={t('dashboard.summary.eyebrow', 'Source summary')}
            title={t('widget.apiUsage.title', 'API usage')}
            description={t('widget.apiUsage.summaryDescription', 'API activity and latency retain their reported windows; no service-wide confidence score is inferred.')}
            scope={t('widget.apiUsage.summaryScope', 'System API logs; calls cover 24 hours, other counters have no exact source bounds')}
            loading={isLoading && !data} testId="api-usage-operational-brief"
          />
        {!data && (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<BarChart2 className="h-5 w-5" />}
          message={t('widget.apiUsage.noData', 'No API usage data')}
          className="py-4"
        />
        )}
        </div>
    </WidgetShell>
  );
}
