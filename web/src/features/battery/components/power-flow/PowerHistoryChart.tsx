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
import { formatDateShort, formatDateTime } from '@/lib/dateFormat';
import { isFiniteNumber } from '@/lib/numberFormat';
import { useTimezone } from '@/lib/timezone';
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
  const { precision: displayPrecision, locale: displayLocale, fmtPercent } = useNumberFormatting();
  const timezone = useTimezone('user');
  const { t } = useTranslation();

  // The API layer is untyped at runtime and can transiently omit the series;
  // guard so `.length` below (and recharts' own `.map`) never throw on a
  // nullish/garbage `data` prop.
  const rows = Array.isArray(data) ? data : [];
  const evidence = rows.map(({ time, solar, battery, grid, load, soc }) => ({ time, solar, battery, grid, load, soc }));

  // Format the epoch X value through a Date object rather than
  // `new Date(v).toISOString()`, which throws `RangeError: Invalid time value`
  // for a NaN/undefined sample. `formatDateShort` already renders the "—"
  // placeholder for unparseable input, so the axis stays crash-safe.
  const formatTimeTick = useCallback(
    (value: unknown) => formatDateShort(isFiniteNumber(value) ? new Date(value) : undefined, { locale: displayLocale, tz: timezone }),
    [displayLocale, timezone],
  );
  const formatTimeLabel = useCallback(
    (value: unknown) => formatDateTime(isFiniteNumber(value) ? new Date(value) : undefined, { locale: displayLocale, tz: timezone }),
    [displayLocale, timezone],
  );
  const formatWattTick = useCallback((value: number) => fmtWatts(value), [displayPrecision, displayLocale]);
  const formatValue = useCallback(
    (value: unknown, _name: string, unit?: string) =>
      !isFiniteNumber(value) ? '—' : unit === '%' ? fmtPercent(value) : fmtWatts(value),
    [fmtPercent, displayPrecision, displayLocale],
  );

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
        { key: 'time', label: t('powerFlow.lastUpdate', 'Updated'), format: formatTimeLabel },
        { key: 'solar', label: t('powerFlow.solar', 'Solar'), format: value => formatValue(value, '', 'W') },
        { key: 'battery', label: t('powerFlow.batteryLabel', 'Battery'), format: value => formatValue(value, '', 'W') },
        { key: 'grid', label: t('powerFlow.grid', 'Grid'), format: value => formatValue(value, '', 'W') },
        { key: 'load', label: t('powerFlow.home', 'Home'), format: value => formatValue(value, '', 'W') },
        { key: 'soc', label: t('powerFlow.stateOfCharge', 'State of charge'), format: value => formatValue(value, '', '%') },
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
          <Tooltip content={<ChartTooltip labelFormatter={formatTimeLabel} valueFormatter={formatValue} />} />
          <ChartLegend />
          <Area
            {...AREA_DEFAULTS}
            dataKey="solar"
            unit="W"
            name={t('powerFlow.solar', 'Solar')}
            stroke={FLOW_COLORS.solar}
            fill="url(#pfGradSolar)"
            hide={hiddenSeries?.isHidden('solar')}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="battery"
            unit="W"
            name={t('powerFlow.batteryLabel', 'Battery')}
            stroke={FLOW_COLORS.battery}
            fill="url(#pfGradBattery)"
            hide={hiddenSeries?.isHidden('battery')}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="grid"
            unit="W"
            name={t('powerFlow.grid', 'Grid')}
            stroke={FLOW_COLORS.grid}
            fill="url(#pfGradGrid)"
            hide={hiddenSeries?.isHidden('grid')}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="load"
            unit="W"
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
