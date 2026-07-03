import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { QueryError } from '@/components/feedback';
import {
  ChartContainer, ChartGradient, ChartTooltip,
  chartGrid, axisTick, chartMarginLabeled,
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS,
} from '@/components/charts';
import { cn } from '@/lib/cn';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtWatts } from './helpers';
import { FLOW_COLORS } from './constants';

/** One sample of the live-status history, pre-shaped for the charts. */
export interface PowerHistoryPoint {
  time: number;
  label: string;
  solar: number;
  battery: number;
  grid: number;
  load: number;
  soc: number;
}

interface PowerHistoryChartProps {
  data: PowerHistoryPoint[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
}

const CHART_HEIGHT = 320;

/** Hero stacked-area chart of solar / battery / grid / home power over time. */
export function PowerHistoryChart({ data, loading, error, onRetry, className }: PowerHistoryChartProps) {
  const { t } = useTranslation();

  if (error) {
    return (
      <GlassPanel className={cn('p-4 sm:p-5', className)}>
        <PanelTitle className="mb-3">{t('powerFlow.powerOverTime', 'Power Over Time')}</PanelTitle>
        <QueryError error={error} onRetry={onRetry} />
      </GlassPanel>
    );
  }

  return (
    // chart-a11y:no-table dense per-sample power flow trace; SR users read live numbers from the KPI tiles above
    <ChartContainer
      className={className}
      title={t('powerFlow.powerOverTime', 'Power Over Time')}
      subtitle={t('powerFlow.powerOverTimeDesc', 'Solar, battery, and grid power flow')}
      ariaLabel={t('powerFlow.powerOverTimeAria', 'Solar, battery, grid, and home power flow stacked area chart over time')}
      loading={loading}
      empty={data.length === 0}
      height={CHART_HEIGHT}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={chartMarginLabeled}>
          <defs>
            <ChartGradient id="pfGradSolar" color={FLOW_COLORS.solar} />
            <ChartGradient id="pfGradBattery" color={FLOW_COLORS.battery} />
            <ChartGradient id="pfGradGrid" color={FLOW_COLORS.grid} />
            <ChartGradient id="pfGradHome" color={FLOW_COLORS.home} />
          </defs>
          {chartGrid}
          <XAxis
            dataKey="time"
            tickFormatter={(v) => formatDateShort(new Date(v).toISOString())}
            {...axisTick}
          />
          <YAxis tickFormatter={(v: number) => fmtWatts(v)} {...axisTick} />
          <Tooltip content={<ChartTooltip />} />
          <Legend />
          <Area
            {...AREA_DEFAULTS}
            dataKey="solar"
            name={t('powerFlow.solar', 'Solar')}
            stroke={FLOW_COLORS.solar}
            fill="url(#pfGradSolar)"
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="battery"
            name={t('powerFlow.batteryLabel', 'Battery')}
            stroke={FLOW_COLORS.battery}
            fill="url(#pfGradBattery)"
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="grid"
            name={t('powerFlow.grid', 'Grid')}
            stroke={FLOW_COLORS.grid}
            fill="url(#pfGradGrid)"
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="load"
            name={t('powerFlow.home', 'Home')}
            stroke={FLOW_COLORS.home}
            fill="url(#pfGradHome)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
