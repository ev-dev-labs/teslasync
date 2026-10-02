import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart2, Clock, AlertTriangle, Activity, Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { useApiLogStats } from '@/api/hooks/useAdmin';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { severityTokens } from '@/lib/tokens';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

export default function APIUsageWidget({ size }: WidgetProps) {
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
  const isWide = size.cols >= 3;

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

  const coreStats = useMemo((): StatGridItem[] => {
    return [
      {
        label: t('widget.apiUsage.totalCalls', 'Total calls (24h)'),
        value: totalCalls == null ? '—' : fmtInt(totalCalls),
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.apiUsage.avgResponse', 'Avg response'),
        value: avgResponseMs == null ? '—' : fmtNumber(avgResponseMs, 1),
        unit: 'ms',
        icon: <Clock className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.apiUsage.errorRate', 'Error rate'),
        value: errorRate == null ? '—' : fmtNumber(errorRate, 1),
        unit: '%',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        valueColor: errorRate != null && errorRate > 5 ? severityTokens.critical.fg : undefined,
        trend: errorRate != null && errorRate > 5 ? 'down' : undefined,
        trendPositive: false,
        trendValue: errorRate != null && errorRate > 5 ? t('widget.apiUsage.highErrors', 'High') : undefined,
      },
      {
        label: t('widget.apiUsage.totalErrors', 'Errors'),
        value: errorCount == null ? '—' : fmtInt(errorCount),
        icon: <Activity className="h-3.5 w-3.5" />,
        valueColor: errorCount != null && errorCount > 0 ? severityTokens.critical.fg : undefined,
      },
    ];
  }, [data, totalCalls, avgResponseMs, errorRate, errorCount, t]);

  // Compact layout: single big number
  if (isCompact) {
    return (
      <WidgetShell
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
              text: `${fmtNumber(errorRate, 1)}% ${t('widget.apiUsage.errors', 'errors')}`,
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
          <WidgetStatGrid stats={coreStats} cols={isWide ? 4 : 2} />
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
