import { useTranslation } from 'react-i18next';

import { ChartCard, LayoutCard } from '@/components/layout';
import { QueryError } from '@/components/feedback';
import {
  ChartTooltip,
  chartGrid, axisTick, chartMarginLabeled, CHART_COLORS,
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import { cn } from '@/lib/cn';
import { formatDateShort } from '@/lib/dateFormat';
import type { PowerHistoryPoint } from './PowerHistoryChart';

interface BatterySocChartProps {
  data: PowerHistoryPoint[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
}

const CHART_HEIGHT = 260;

/**
 * Format an X-axis time tick as a short local date. Accepts the SI epoch-ms
 * `time` value (and, defensively, ISO strings / `Date`s). Delegates to the
 * shared {@link formatDateShort}, which yields the "—" placeholder for
 * unrenderable input — so a malformed timestamp degrades to a dash instead of
 * throwing `RangeError: Invalid time value`, which the previous
 * `new Date(v).toISOString()` pre-conversion did on any non-finite value.
 */
export function formatSocTimeTick(value: number | string | Date | null | undefined): string {
  if (value == null) return '—';
  return formatDateShort(value instanceof Date ? value : new Date(value));
}

/** Format a Y-axis state-of-charge tick as a percentage label, null-safe. */
export function formatSocPercentTick(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${value}%`;
}

/** Battery state-of-charge percentage over the selected history window. */
export function BatterySocChart({ data, loading, error, onRetry, className }: BatterySocChartProps) {
  const { t } = useTranslation();

  if (error) {
    return (
      <div className={cn('min-w-0', className)}>
      <LayoutCard title={t('powerFlow.socOverTime', 'Battery State of Charge')}>
        <QueryError error={error} onRetry={onRetry} />
      </LayoutCard>
      </div>
    );
  }

  const points = data ?? [];
  const evidence = points.map(({ time, soc }) => ({ time, soc }));

  return (
    <div className={cn('min-w-0', className)}>
    <ChartCard toolbar exportable size="standard"
      title={t('powerFlow.socOverTime', 'Battery State of Charge')}
      subtitle={t('powerFlow.socOverTimeDesc', 'Battery percentage over time')}
      ariaLabel={t('powerFlow.socOverTimeAria', 'Battery state of charge percentage over time line chart')}
      loading={loading}
      empty={points.length === 0}
      height={CHART_HEIGHT}
      data={evidence}
      exportData={evidence}
      dataColumns={[
        { key: 'time', label: t('powerFlow.lastUpdate', 'Updated'), format: value => value != null ? formatSocTimeTick(Number(value)) : '—' },
        { key: 'soc', label: t('powerFlow.stateOfCharge', 'State of Charge'), format: value => value != null ? formatSocPercentTick(Number(value)) : '—' },
      ]}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={points} margin={chartMarginLabeled}>
          {chartGrid}
          <XAxis
            dataKey="time"
            tickFormatter={(v) => formatSocTimeTick(v)}
            {...axisTick}
          />
          <YAxis domain={[0, 100]} tickFormatter={(v: number) => formatSocPercentTick(v)} {...axisTick} />
          <Tooltip content={<ChartTooltip />} />
          <Line
            {...AREA_DEFAULTS}
            dataKey="soc"
            name={t('powerFlow.stateOfCharge', 'State of Charge')}
            stroke={CHART_COLORS[1]}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
    </div>
  );
}
