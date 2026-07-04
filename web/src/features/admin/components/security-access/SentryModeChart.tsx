import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/cn';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ChartTooltip,
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

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.security.sentryChart', 'Sentry Mode Activity')}
      </PanelTitle>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <Skeleton height={256} />
      ) : buckets.length > 0 ? (
        <div
          className="h-56 sm:h-64 xl:h-72"
          role="img"
          aria-label={t('admin.security.sentryChart', 'Sentry Mode Activity')}
        >
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
              <Legend wrapperStyle={{ fontSize: 12, color: chartTokens.axisStroke }} />
              <Bar
                dataKey="sentryOn"
                name={t('admin.security.chart.sentryOn', 'Sentry On')}
                fill={chartTokens.series[0]}
                radius={[4, 4, 0, 0]}
                stackId="sentry"
              />
              <Bar
                dataKey="sentryOff"
                name={t('admin.security.chart.sentryOff', 'Sentry Off')}
                fill={chartTokens.axisStroke}
                radius={[4, 4, 0, 0]}
                stackId="sentry"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState
          icon={<Activity className="h-8 w-8" aria-hidden="true" />}
          message={t('common.noData', 'No data available')}
          className="py-8"
        />
      )}
    </GlassPanel>
  );
}
