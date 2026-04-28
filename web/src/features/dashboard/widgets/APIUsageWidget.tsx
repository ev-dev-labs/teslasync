import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart2, Clock, AlertTriangle, Activity, Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { useApiLogStats } from '@/api/hooks/useAdmin';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

export default function APIUsageWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useApiLogStats();

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const totalCalls = data?.last24h ?? 0;
  const avgResponseMs = data?.avgDurationMs ?? 0;
  const errorRate = data?.errorRate ?? 0;
  const errorCount = data?.errorCount ?? 0;

  const coreStats = useMemo((): StatGridItem[] => {
    if (!data) return [];
    return [
      {
        label: t('widget.apiUsage.totalCalls', 'Total Calls (24h)'),
        value: fmtInt(totalCalls),
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.apiUsage.avgResponse', 'Avg Response'),
        value: fmtNumber(avgResponseMs, 1),
        unit: 'ms',
        icon: <Clock className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.apiUsage.errorRate', 'Error Rate'),
        value: fmtNumber(errorRate, 1),
        unit: '%',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        valueColor: errorRate > 5 ? 'text-red-400' : undefined,
        trend: errorRate > 5 ? 'down' as const : errorRate > 0 ? 'flat' as const : undefined,
        trendValue: errorRate > 5 ? t('widget.apiUsage.highErrors', 'High') : undefined,
      },
      {
        label: t('widget.apiUsage.totalErrors', 'Errors'),
        value: fmtInt(errorCount),
        icon: <Activity className="h-3.5 w-3.5" />,
        valueColor: errorCount > 0 ? 'text-red-400' : undefined,
      },
    ];
  }, [data, totalCalls, avgResponseMs, errorRate, errorCount, t]);

  // Compact layout: single big number
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={refetch}
      >
        {data ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5 min-h-[44px]">
            <span className="text-2xl font-bold text-white/90">{fmtInt(totalCalls)}</span>
            <span className="text-[10px] text-white/40 uppercase tracking-wider">
              {t('widget.apiUsage.calls24h', 'Calls (24h)')}
            </span>
            {errorRate > 5 && (
              <span className="text-[10px] text-red-400 mt-0.5">
                {fmtNumber(errorRate, 1)}% {t('widget.apiUsage.errors', 'errors')}
              </span>
            )}
          </div>
        ) : (
          <EmptyState
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
      title={t('widget.apiUsage.title', 'API Usage')}
      icon={<BarChart2 className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={refetch}
    >
      {data ? (
        <div className="space-y-3">
          <WidgetStatGrid stats={coreStats} cols={isWide ? 4 : 2} />
        </div>
      ) : (
        <EmptyState
          icon={<BarChart2 className="h-5 w-5" />}
          message={t('widget.apiUsage.noData', 'No API usage data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
