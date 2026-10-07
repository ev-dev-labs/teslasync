import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/cn';
import { GlassPanel, PanelTitle } from '@/components/ui';
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
import { formatDateShort } from '@/lib/dateFormat';
import type { SentryDayBucket } from './helpers';

interface SentryModeChartProps {
  sentryBuckets: SentryDayBucket[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function SentryModeChart({ sentryBuckets, isLoading, error, onRetry, className }: SentryModeChartProps) {
  const { t } = useTranslation();

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
    () => buckets.map(({ date, sentryOn, sentryOff }) => ({ date, sentryOn, sentryOff })),
    [buckets],
  );

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.security.sentryChart', 'Sentry Mode Activity')}
      </PanelTitle>
      <EmbeddedChart
        chartKey="admin-security-sentry-mode"
        title={t('admin.security.sentryChart', 'Sentry Mode Activity')}
        ariaLabel={t('admin.security.sentryChart', 'Sentry Mode Activity')}
        loading={isLoading && !error}
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
          { key: 'sentryOn', label: t('admin.security.chart.sentryOn', 'Sentry On') },
          { key: 'sentryOff', label: t('admin.security.chart.sentryOff', 'Sentry Off') },
        ]}
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
              <XAxis
                dataKey="date"
                tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
                tickFormatter={(val: string) => formatDateShort(val)}
              />
              <YAxis tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              <Bar
                dataKey="sentryOn"
                name={t('admin.security.chart.sentryOn', 'Sentry On')}
                fill={chartTokens.series[0]}
                radius={[4, 4, 0, 0]}
                stackId="sentry"
                hide={hiddenSeries?.isHidden('sentryOn') ?? false}
              />
              <Bar
                dataKey="sentryOff"
                name={t('admin.security.chart.sentryOff', 'Sentry Off')}
                fill={chartTokens.axisStroke}
                radius={[4, 4, 0, 0]}
                stackId="sentry"
                hide={hiddenSeries?.isHidden('sentryOff') ?? false}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </EmbeddedChart>
    </GlassPanel>
  );
}
