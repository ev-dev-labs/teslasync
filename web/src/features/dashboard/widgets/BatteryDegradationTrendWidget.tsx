import { useCallback, useMemo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer,
  Tooltip, ReferenceLine,
  chartGrid, axisTickSm, useThemeChartPalette,
  AREA_DEFAULTS, areaGradient,
  EmbeddedChart,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useBatteryDegradation } from '@/api/hooks/useEnergy';
import { fmtNumber } from '@/lib/numberFormat';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { gaugeTone } from '@/lib/tokens';
import { WidgetShell } from './WidgetShell';
import { WidgetChartSummary } from './shared';
import type { ChartSummaryStat } from './shared';
import type { WidgetProps } from './types';

export default function BatteryDegradationTrendWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const query = useBatteryDegradation(idStr);
  const { data, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const trust = useDataState(query, { provenance: 'historical' });
  const gradientId = `degradation-${useId().replace(/:/g, '')}`;
  const { reduce } = useMotionPreference();

  const chartData = useMemo(() => {
    const trend = data?.monthly_trend ?? [];
    if (trend.length === 0) return [];
    const originalRange = knownNumber(trend[0]?.avg_range);
    return trend.map((entry) => ({
      month: entry.month ?? '',
      range: knownNumber(entry.avg_range),
      health: knownNumber(entry.avg_health),
      original: originalRange,
    }));
  }, [data]);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const currentHealth = knownNumber(data?.current_health_pct) ?? knownNumber(data?.current_health);
  const degradationRate = knownNumber(data?.degradation_rate_pct_per_month);
  const totalCycles = knownNumber(data?.current_cycles);

  // Series colour follows the active theme.
  const palette = useThemeChartPalette();

  const stats = useMemo<ChartSummaryStat[]>(() => {
    const items: ChartSummaryStat[] = [];
    items.push({
      label: t('widget.soh', 'SoH'),
      value: currentHealth != null ? `${fmtNumber(currentHealth, 1)}%` : '—',
    });
      items.push({
        label: t('widget.degradation', 'Degradation'),
        value: degradationRate != null ? `${degradationRate > 0 ? '−' : ''}${fmtNumber(degradationRate, 2)}%/${t('widget.mo', 'mo')}` : '—',
      });
    items.push({
      label: t('widget.cycles', 'Cycles'),
      value: totalCycles != null ? fmtNumber(totalCycles, 0) : '—',
    });
    return items;
  }, [currentHealth, degradationRate, totalCycles, t]);

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const chart = (
    <EmbeddedChart
      title={t('widget.batteryDegradation', 'Battery degradation')}
      ariaLabel={t(
        'widget.batteryDegradationChart.aria',
        'Monthly battery health trend',
      )}
      empty={chartData.filter((point) => point.health != null).length <= 1}
      emptyMessage={data ? t('widget.needMoreData', 'More data needed for trend') : t('widget.noDegradation', 'No degradation data')}
      data={chartData}
      dataColumns={[
        { key: 'month', label: t('widget.batteryDegradationChart.month', 'Month') },
        { key: 'health', label: t('widget.healthPct', 'Health %') },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          {areaGradient(gradientId, palette.series[1])}
          {chartGrid}
          <XAxis dataKey="month" {...axisTickSm} />
          <YAxis
            domain={['dataMin - 2', 100]}
            tickFormatter={(v: number) => `${v}%`}
            {...axisTickSm}
          />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine y={80} stroke={gaugeTone.danger} strokeDasharray="4 4" strokeOpacity={0.4} />
          <Area
            {...AREA_DEFAULTS}
            dataKey="health"
            stroke={palette.series[1]}
            fill={`url(#${gradientId})`}
            isAnimationActive={!reduce}
            name={t('widget.healthPct', 'Health %')}
          />
        </AreaChart>
      </ResponsiveContainer>
    </EmbeddedChart>
  );

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.batteryDegradation', 'Battery degradation')}
      icon={isCompact ? undefined : <TrendingDown className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={data != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetChartSummary
        stats={stats}
        chart={chart}
        compact={isCompact}
        emptyMessage={t('widget.noDegradation', 'No degradation data')}
        emptyIcon={<TrendingDown className="h-5 w-5" />}
      />
      {isCompact && !data && (
        <EmptyState message={t('widget.noDegradation', 'No degradation data')} icon={<TrendingDown className="h-5 w-5" />} />
      )}
    </WidgetShell>
  );
}
