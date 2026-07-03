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

  return (
    // chart-a11y:no-table dense per-sample SOC trace; current SOC is shown on the battery gauge tile
    <ChartContainer
      className={className}
      title={t('powerFlow.socOverTime', 'Battery State of Charge')}
      subtitle={t('powerFlow.socOverTimeDesc', 'Battery percentage over time')}
      ariaLabel={t('powerFlow.socOverTimeAria', 'Battery state of charge percentage over time line chart')}
      loading={loading}
      empty={data.length === 0}
      height={CHART_HEIGHT}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={chartMarginLabeled}>
          {chartGrid}
          <XAxis
            dataKey="time"
            tickFormatter={(v) => formatDateShort(new Date(v).toISOString())}
            {...axisTick}
          />
          <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} {...axisTick} />
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
