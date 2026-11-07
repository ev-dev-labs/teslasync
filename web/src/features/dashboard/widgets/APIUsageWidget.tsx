import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart2 } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import {
  Bar, BarChart, ChartTooltip, EmbeddedChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick, chartGrid,
} from '@/components/charts';

import { useApiLogStats } from '@/api/hooks/useAdmin';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function APIUsageWidget({ size }: WidgetProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const packId = usePackPresentation();
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
  const methodCalls = useMemo(() => Object.entries(data?.by_method ?? {}).map(([method, count]) => {
    const value = knownNumber(count);
    return { method, calls: value != null && Number.isSafeInteger(value) && value >= 0 ? value : null };
  }), [data?.by_method]);
  const hasMethodReading = methodCalls.some(row => row.calls != null);
  const headline = data ? (
    <WidgetBigNumber
      value={totalCalls == null ? null : fmtInt(totalCalls)}
      label={t('widget.apiUsage.calls24h', 'Calls (24h)')}
      badge={errorRate != null && errorRate > 5 ? {
        text: `${fmtNumber(errorRate)}% ${t('widget.apiUsage.errors', 'errors')}`,
        variant: 'error',
      } : undefined}
    />
  ) : (
    <EmptyState /* no-action: transient empty state — refresh remains available in the shell */
      icon={<BarChart2 className="h-5 w-5" />}
      message={t('widget.apiUsage.noData', 'No API usage data')}
      className="py-4"
    />
  );
  const methodChart = (
    <EmbeddedChart
      title={t('dashboardWidgets.system.apiUsage.methodCalls', 'Calls by method · retained logs')}
      ariaLabel={t('dashboardWidgets.system.apiUsage.methodCalls', 'Calls by method · retained logs')}
      ariaDescription={t('dashboardWidgets.system.apiUsage.methodScope', 'Method totals cover retained logs, not just the last 24 hours.')}
      visibleTitle
      height={160}
      empty={!hasMethodReading}
      emptyMessage={t('dashboardWidgets.system.apiUsage.noMethodData', 'No method breakdown available')}
      data={methodCalls}
      dataColumns={[
        { key: 'method', label: t('dashboardWidgets.system.apiUsage.httpMethod', 'HTTP method') },
        { key: 'calls', label: t('dashboardWidgets.system.apiUsage.calls', 'Calls'), kind: 'count' },
      ]}
      metadata={{ rangeLabel: t('dashboardWidgets.system.apiUsage.methodScope', 'Method totals cover retained logs, not just the last 24 hours.') }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={methodCalls}>
          {chartGrid}
          <XAxis dataKey="method" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false}
            domain={[0, 'auto']} tickFormatter={(value: number) => fmtInt(value)} />
          <Tooltip content={<ChartTooltip precision={0} />} />
          <Bar dataKey="calls" name={t('dashboardWidgets.system.apiUsage.calls', 'Calls')} fill="var(--theme-primary)"
            radius={packId === 'v7' || packId === 'v3' ? 0 : [4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </EmbeddedChart>
  );

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
        <InstrumentPresentation family="bars" compact headline={headline} icon={<BarChart2 />}>
          {headline}
        </InstrumentPresentation>
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
      <InstrumentPresentation family="bars" headline={headline} icon={<BarChart2 />}
        instrument={methodChart} details={<WidgetStatGrid stats={stats.slice(1)} cols={2} />}>
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
      </InstrumentPresentation>
    </WidgetShell>
  );
}
