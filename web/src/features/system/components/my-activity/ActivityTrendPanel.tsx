/**
 * ActivityTrendPanel — the page hero. A gap-filled daily bar chart of activity
 * counts across the selected window, so the user can see their busy vs quiet
 * days at a glance. Owns its loading / empty / error states.
 */
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ChartTooltip,
  chartGrid,
  axisTickSm,
} from '@/components/charts';
import { Icons } from '@/lib/icons';
import { chartTokens } from '@/lib/tokens';
import type { TrendPoint } from './myActivityAnalytics';

export interface ActivityTrendPanelProps {
  data: TrendPoint[];
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
}

export function ActivityTrendPanel({
  data,
  isLoading,
  isError,
  isEmpty,
  error,
  onRetry,
  className,
}: ActivityTrendPanelProps) {
  const { t } = useTranslation();
  const rows = data ?? [];

  return (
    <GlassPanel className={className}>
      <div className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <Icons.analytics className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('activity.myActivity.trend.title', 'Activity over time')}
        </PanelTitle>
        {isLoading ? (
          <Skeleton height={260} />
        ) : isError ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : isEmpty || rows.length === 0 ? (
          <EmptyState
            icon={<Icons.analytics className="h-8 w-8" />}
            message={t('activity.myActivity.trend.empty', 'No activity recorded in this window.')}
          />
        ) : (
          <div className="h-56 sm:h-64 xl:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                {chartGrid}
                <XAxis
                  dataKey="label"
                  tick={axisTickSm}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis tick={axisTickSm} allowDecimals={false} width={32} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)', opacity: 0.4 }} />
                <Bar
                  dataKey="count"
                  name={t('activity.myActivity.trend.series', 'Actions')}
                  fill={chartTokens.series[5]}
                  fillOpacity={0.85}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
