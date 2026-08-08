/**
 * ActivityHourPanel — distribution of activity across the 24 hours of the day
 * (local time), revealing when the user tends to act. Always renders all 24
 * buckets so the shape is comparable across windows. Owns its own states.
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
import type { HourPoint } from './myActivityAnalytics';

// Hoisted so these object/array literals keep a stable identity across renders
// instead of being re-created on every pass through the chart branch.
const TOOLTIP_CURSOR = { fill: 'var(--surface-2)', opacity: 0.4 };
const BAR_RADIUS: [number, number, number, number] = [3, 3, 0, 0];

export interface ActivityHourPanelProps {
  data: HourPoint[];
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
}

export function ActivityHourPanel({
  data,
  isLoading,
  isError,
  isEmpty,
  error,
  onRetry,
  className,
}: ActivityHourPanelProps) {
  const { t } = useTranslation();
  const rows = data ?? [];

  return (
    <GlassPanel className={className}>
      <div className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <Icons.clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('activity.myActivity.byHour.title', 'By hour of day')}
        </PanelTitle>
        {isLoading ? (
          <Skeleton height={220} />
        ) : isError ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : isEmpty || rows.length === 0 ? (
          // no-action: the hourly distribution's window is controlled by the RangePicker in the page header; a different range repopulates it.
          <EmptyState
            icon={<Icons.clock className="h-8 w-8" />}
            message={t('activity.myActivity.byHour.empty', 'No activity to chart by hour yet.')}
          />
        ) : (
          <div
            className="h-56 sm:h-64"
            role="img"
            aria-label={t(
              'activity.myActivity.byHour.chartAria',
              'Activity counts by hour of day',
            )}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                {chartGrid}
                <XAxis dataKey="label" tick={axisTickSm} interval={2} />
                <YAxis tick={axisTickSm} allowDecimals={false} width={32} />
                <Tooltip content={<ChartTooltip />} cursor={TOOLTIP_CURSOR} />
                <Bar
                  dataKey="count"
                  name={t('activity.myActivity.byHour.series', 'Actions')}
                  fill={chartTokens.series[4]}
                  fillOpacity={0.85}
                  radius={BAR_RADIUS}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
