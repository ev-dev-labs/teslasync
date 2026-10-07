import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { QueryError } from '@/components/feedback';
import {
  ChartContainer, ChartTooltip,
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
  return `${value ?? 0}%`;
}

/** Battery state-of-charge percentage over the selected history window. */
export function BatterySocChart({ data, loading, error, onRetry, className }: BatterySocChartProps) {
  const { t } = useTranslation();

  if (error) {
    return (
      <GlassPanel className={cn('p-4 sm:p-5', className)}>
        <PanelTitle className="mb-3">{t('powerFlow.socOverTime', 'Battery State of Charge')}</PanelTitle>
        <QueryError error={error} onRetry={onRetry} />
      </GlassPanel>
    );
  }

  const points = data ?? [];

  return (
    // chart-a11y:no-table dense per-sample SOC trace; current SOC is shown on the battery gauge tile
    <ChartContainer
      className={className}
      title={t('powerFlow.socOverTime', 'Battery State of Charge')}
      subtitle={t('powerFlow.socOverTimeDesc', 'Battery percentage over time')}
      ariaLabel={t('powerFlow.socOverTimeAria', 'Battery state of charge percentage over time line chart')}
      loading={loading}
      empty={points.length === 0}
      height={CHART_HEIGHT}
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
    </ChartContainer>
  );
}
