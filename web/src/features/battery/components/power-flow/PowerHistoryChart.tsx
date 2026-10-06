import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartCard, LayoutCard } from '@/components/layout';
import { QueryError } from '@/components/feedback';
import {
  ChartGradient, ChartLegend, ChartTooltip,
  chartGrid, axisTick, chartMarginLabeled,
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import { cn } from '@/lib/cn';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtWatts } from './helpers';
import { FLOW_COLORS } from './constants';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** One sample of the live-status history, pre-shaped for the charts. */
export interface PowerHistoryPoint {
  time: number;
  label: string;
  solar: number | null;
  battery: number | null;
  grid: number | null;
  load: number | null;
  soc: number | null;
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
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();

  // The API layer is untyped at runtime and can transiently omit the series;
  // guard so `.length` below (and recharts' own `.map`) never throw on a
  // nullish/garbage `data` prop.
  const rows = Array.isArray(data) ? data : [];
  const evidence = rows.map(({ time, solar, battery, grid, load }) => ({ time, solar, battery, grid, load }));

  // Format the epoch X value through a Date object rather than
  // `new Date(v).toISOString()`, which throws `RangeError: Invalid time value`
  // for a NaN/undefined sample. `formatDateShort` already renders the "—"
  // placeholder for unparseable input, so the axis stays crash-safe.
  const formatTimeTick = useCallback(
    (value: number) => formatDateShort(new Date(value)),
    [],
  );
  const formatWattTick = useCallback((value: number) => fmtWatts(value), [displayPrecision, displayLocale]);

  if (error) {
    return (
      <div className={cn('min-w-0', className)}>
      <LayoutCard title={t('powerFlow.powerOverTime', 'Power Over Time')}>
        <QueryError error={error} onRetry={onRetry} />
      </LayoutCard>
      </div>
    );
  }

  return (
    <div className={cn('min-w-0', className)}>
    <ChartCard toolbar exportable size="standard"
      title={t('powerFlow.powerOverTime', 'Power Over Time')}
      subtitle={t('powerFlow.powerOverTimeDesc', 'Solar, battery, and grid power flow')}
      ariaLabel={t('powerFlow.powerOverTimeAria', 'Solar, battery, grid, and home power flow stacked area chart over time')}
      chartKey="power-flow-history"
      loading={loading}
      empty={rows.length === 0}
      height={CHART_HEIGHT}
      data={evidence}
      exportData={evidence}
      dataColumns={[
        { key: 'time', label: t('powerFlow.lastUpdate', 'Updated'), format: value => value != null ? formatDateShort(new Date(Number(value))) : '—' },
        { key: 'solar', label: t('powerFlow.solar', 'Solar'), format: value => value != null ? fmtWatts(Number(value)) : '—' },
        { key: 'battery', label: t('powerFlow.batteryLabel', 'Battery'), format: value => value != null ? fmtWatts(Number(value)) : '—' },
        { key: 'grid', label: t('powerFlow.grid', 'Grid'), format: value => value != null ? fmtWatts(Number(value)) : '—' },
        { key: 'load', label: t('powerFlow.home', 'Home'), format: value => value != null ? fmtWatts(Number(value)) : '—' },
      ]}
    >
      {({ hiddenSeries }) => (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <AreaChart data={rows} margin={chartMarginLabeled}>
          <defs>
            <ChartGradient id="pfGradSolar" color={FLOW_COLORS.solar} />
            <ChartGradient id="pfGradBattery" color={FLOW_COLORS.battery} />
            <ChartGradient id="pfGradGrid" color={FLOW_COLORS.grid} />
            <ChartGradient id="pfGradHome" color={FLOW_COLORS.home} />
          </defs>
          {chartGrid}
          <XAxis
            dataKey="time"
            tickFormatter={formatTimeTick}
            {...axisTick}
          />
          <YAxis tickFormatter={formatWattTick} {...axisTick} />
          <Tooltip content={<ChartTooltip />} />
          <ChartLegend />
          <Area
            {...AREA_DEFAULTS}
            dataKey="solar"
            name={t('powerFlow.solar', 'Solar')}
            stroke={FLOW_COLORS.solar}
            fill="url(#pfGradSolar)"
            hide={hiddenSeries?.isHidden('solar')}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="battery"
            name={t('powerFlow.batteryLabel', 'Battery')}
            stroke={FLOW_COLORS.battery}
            fill="url(#pfGradBattery)"
            hide={hiddenSeries?.isHidden('battery')}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="grid"
            name={t('powerFlow.grid', 'Grid')}
            stroke={FLOW_COLORS.grid}
            fill="url(#pfGradGrid)"
            hide={hiddenSeries?.isHidden('grid')}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="load"
            name={t('powerFlow.home', 'Home')}
            stroke={FLOW_COLORS.home}
            fill="url(#pfGradHome)"
            hide={hiddenSeries?.isHidden('load')}
          />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
    </div>
  );
}
