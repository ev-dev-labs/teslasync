import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  ChartTooltip, chartGrid, axisTickSm,
} from '@/components/charts';

import { HOURS_COLOR, type TrendPoint } from './constants';

interface HoursTrendPanelProps {
  points: TrendPoint[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Estimated remaining runtime (hours) over recent readings. */
export function HoursTrendPanel({ points, isLoading, error, onRetry }: HoursTrendPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('powershare.hoursTrend.title', 'Remaining Runtime Trend')}
      </PanelTitle>
      {isLoading ? (
        <Skeleton height={220} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : points.length === 0 ? (
        <EmptyState /* no-action: transient — runtime appears once telemetry streams */
          icon={<Clock className="h-8 w-8" />}
          message={t(
            'powershare.hoursTrend.noData',
            'No runtime readings yet. Estimated hours appear once Powershare reports telemetry.',
          )}
        />
      ) : (
        <div className="h-56 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points}>
              {chartGrid}
              <XAxis dataKey="label" tick={axisTickSm} minTickGap={24} />
              <YAxis tick={axisTickSm} width={36} unit=" h" allowDecimals />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="value"
                name={t('powershare.kpi.hoursRemaining', 'Hours Remaining')}
                stroke={HOURS_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </GlassPanel>
  );
}
