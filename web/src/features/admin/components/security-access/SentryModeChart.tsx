import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/cn';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { DataStateNotice } from '@/components/feedback';
import type { DataState } from '@/api/dataState';
import type { SecurityEvent } from '@/types/admin';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ChartLegend,
  ChartTooltip,
  EmbeddedChart,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { formatDayKey } from '@/lib/dateFormat';
import type { SentryDayBucket } from './helpers';

interface SentryModeChartProps {
  sourceState?: DataState<SecurityEvent[]>;
  sentryBuckets: SentryDayBucket[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function SentryModeChart({ sentryBuckets, sourceState, isLoading, error, onRetry, className }: SentryModeChartProps) {
  const { t } = useTranslation();
  const { locale } = useNumberFormatting();

  // The parent derives `sentryBuckets` from an untyped history response that
  // can transiently omit the array; guard before reading `.length` or handing
  // it to the chart so a missing payload renders the empty state instead of
  // throwing. useMemo keeps the fallback reference stable across re-renders so
  // the memoised chart's `data` prop doesn't churn.
  const buckets = useMemo(
    () => (Array.isArray(sentryBuckets) ? sentryBuckets : []),
    [sentryBuckets],
  );
  const chartRows = useMemo(
    () => buckets.map(({ date, sentryOn, sentryOff, sentryUnknown }) => ({ date, sentryOn, sentryOff, sentryUnknown: sentryUnknown ?? 0 })),
    [buckets],
  );

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
        {t('admin.security.sentryChart', 'Sentry mode activity')}
      </PanelTitle>
      {sourceState?.status === 'stale' && <DataStateNotice state="stale" />}
      {sourceState && !sourceState.hasData && sourceState.isRefreshBlocked ? (
        <DataStateNotice state="partial" title={t('dataSources.status.paused', 'Refresh paused')} />
      ) : <EmbeddedChart
        chartKey="admin-security-sentry-mode"
        title={t('admin.security.sentryChart', 'Sentry mode activity')}
        ariaLabel={t('admin.security.sentryChart', 'Sentry mode activity')}
        loading={(isLoading || sourceState?.status === 'initial') && !error}
        error={error instanceof Error ? error : error ? new Error(String(error)) : undefined}
        onRetry={onRetry}
        empty={!error && !isLoading && buckets.length === 0}
        emptyMessage={t(
          'admin.security.sentryEmpty',
          'No Sentry Mode activity is recorded in this history window.',
        )}
        emptyDescription={t(
          'admin.security.sentryEmptyDescription',
          'The chart populates as security snapshots record Sentry Mode on and off states.',
        )}
        data={chartRows}
        dataColumns={[
          { key: 'date', label: t('admin.security.chart.date', 'Date') },
          { key: 'sentryOn', label: t('admin.security.chart.sentryOn', 'Sentry on') },
          { key: 'sentryOff', label: t('admin.security.chart.sentryOff', 'Sentry off') },
          ...(buckets.some((bucket) => (bucket.sentryUnknown ?? 0) > 0)
            ? [{ key: 'sentryUnknown', label: t('admin.security.unknown', 'Unknown') }] : []),
        ]}
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
              <XAxis
                dataKey="date"
                tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
                tickFormatter={(val: string) => formatDayKey(val, { locale, style: 'short' })}
              />
              <YAxis tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              <Bar
                dataKey="sentryOn"
                name={t('admin.security.chart.sentryOn', 'Sentry on')}
                fill={chartTokens.series[0]}
                radius={[4, 4, 0, 0]}
                stackId="sentry"
                hide={hiddenSeries?.isHidden('sentryOn') ?? false}
              />
              <Bar
                dataKey="sentryOff"
                name={t('admin.security.chart.sentryOff', 'Sentry off')}
                fill={chartTokens.axisStroke}
                radius={[4, 4, 0, 0]}
                stackId="sentry"
                hide={hiddenSeries?.isHidden('sentryOff') ?? false}
              />
              {buckets.some((bucket) => (bucket.sentryUnknown ?? 0) > 0) && <Bar
                dataKey="sentryUnknown"
                name={t('admin.security.unknown', 'Unknown')}
                fill={chartTokens.series[2]}
                stackId="sentry"
                hide={hiddenSeries?.isHidden('sentryUnknown') ?? false}
              />}
            </BarChart>
          </ResponsiveContainer>
        )}
      </EmbeddedChart>}
    </GlassPanel>
  );
}
