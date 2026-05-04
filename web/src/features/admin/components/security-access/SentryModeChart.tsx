import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from '@/components/charts';
import { formatDateShort } from '@/lib/dateFormat';
import type { SentryDayBucket } from './helpers';

interface SentryModeChartProps {
  sentryBuckets: SentryDayBucket[];
}

export function SentryModeChart({ sentryBuckets }: SentryModeChartProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.2}>
      <GlassPanel className="p-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          {t('admin.security.sentryChart', 'Sentry Mode Activity')}
        </h2>
        {sentryBuckets.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sentryBuckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  tickFormatter={(val: string) => formatDateShort(val)}
                />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }}
                />
                <Bar
                  dataKey="sentryOn"
                  name={t('admin.security.chart.sentryOn', 'Sentry On')}
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                  stackId="sentry"
                />
                <Bar
                  dataKey="sentryOff"
                  name={t('admin.security.chart.sentryOff', 'Sentry Off')}
                  fill="#6b7280"
                  radius={[4, 4, 0, 0]}
                  stackId="sentry"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Activity className="h-8 w-8 opacity-20" />}
            message={t('common.noData', 'No data available')}
            className="py-8"
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
