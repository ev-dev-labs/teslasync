import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  chartGrid,
  chartMargin,
  chartAnimation,
  ChartTooltip,
  EmbeddedChart,
  useMeasuredAxisWidth,
  type ChartDataRow,
} from '@/components/charts';
import { EmptyState, Skeleton } from '@/components/feedback';
import { knownNumber } from '@/api/dataState';
import { useEnergyStats } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import {
  convertEnergyFromSI,
  formatEnergyPerDistance,
  type EnergyUnitPref,
} from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetChartSummary, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';
import type { DailyEnergy } from '@/types/energy';

export interface EnergyChartPoint extends ChartDataRow {
  date: string;
  energy: number | null;
}

export function buildEnergyChartData(
  breakdown: DailyEnergy[] | null | undefined,
  unit: EnergyUnitPref = 'kWh',
): EnergyChartPoint[] {
  return (Array.isArray(breakdown) ? breakdown : [])
    .filter((day) => day?.date)
    .map((day) => {
      const energy = knownNumber(day.energy_wh);
      return {
        date: day.date,
        energy: energy == null ? null : convertEnergyFromSI(energy, unit),
      };
    });
}

export default function EnergyStatsWidget({ vehicleId, size, config }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const dateFormat = useDateFormat();
  const formatDayKey = dateFormat.formatDayKey ?? ((value: string | null | undefined) => String(value ?? ''));
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const id = vehicleId ?? config?.vehicleId ?? vehicles?.[0]?.id ?? 0;

  const query = useEnergyStats(id > 0 ? String(id) : null);
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;

  const loading = isLoading || (!id && vehiclesLoading);
  const queryError = error ?? (!id ? vehiclesError : null);
  const dataState = useDataState({
    ...query,
    data: data ?? (loading || queryError || isError ? undefined : null),
    error: queryError,
  }, {
    provenance: 'historical',
    partial: !!data && [
      data.total_energy_used_wh,
      data.total_energy_charged_wh,
      data.avg_efficiency_wh_per_m,
      data.co2_saved_kg,
    ].some((value) => knownNumber(value) == null),
  });

  const { unitPrefs } = useUnits();
  const isCompact = size.cols <= 1;
  const usedWh = knownNumber(data?.total_energy_used_wh);
  const chargedWh = knownNumber(data?.total_energy_charged_wh);
  const efficiencyWhPerM = knownNumber(data?.avg_efficiency_wh_per_m);
  const co2Kg = knownNumber(data?.co2_saved_kg);

  const chartData = useMemo(
    () => buildEnergyChartData(data?.daily_breakdown, unitPrefs.energy).map((point) => ({
      ...point,
      date: formatDayKey(point.date, { style: 'short' }),
    })),
    [data?.daily_breakdown, unitPrefs.energy, formatDayKey],
  );
  const hasChartData = chartData.some((point) => point.energy != null);

  const axisLabels = useMemo(
    () => [0, ...chartData.map((point) => point.energy)]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((value) => fmtNumber(value)),
    [chartData, fmtNumber],
  );
  const axisWidth = useMeasuredAxisWidth({
    labels: axisLabels,
    fontSize: size.cols >= 3 ? 11 : 10,
    minWidth: 40,
    padding: 20,
    enabled: !isCompact,
  });

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const shellProps = {
    title: t('widget.energyStats.title', 'Energy stats'),
    icon: <Zap className="h-3.5 w-3.5 text-[var(--text-secondary)]" />,
    loading,
    dataState,
    loadingContent: <Skeleton className="h-full min-h-16 rounded-shape-sm" />,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: handleRefresh,
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        {data ? (
          <WidgetBigNumber
            value={usedWh == null ? null : fmtNumber(convertEnergyFromSI(usedWh, unitPrefs.energy), unitPrefs.energy === 'kWh' ? 1 : 0)}
            unit={unitPrefs.energy}
            label={t('widget.energyStats.totalUsed', 'Total used')}
            animated={false}
            decimals={unitPrefs.energy === 'kWh' ? 1 : 0}
            align="center"
          />
        ) : (
          <EmptyState
            variant="informational"
            icon={<Zap className="h-5 w-5" />}
            message={t('widget.energyStats.noData', 'No energy data available')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  const secondaryStats = [
    {
      label: t('widget.energyStats.totalCharged', 'Total charged'),
      value: chargedWh == null ? null : fmtNumber(convertEnergyFromSI(chargedWh, unitPrefs.energy), 1),
      unit: chargedWh == null ? undefined : unitPrefs.energy,
    },
    {
      label: t('widget.energyStats.avgEfficiency', 'Avg efficiency'),
      value: efficiencyWhPerM == null ? null : formatEnergyPerDistance(efficiencyWhPerM, unitPrefs),
    },
    {
      label: t('widget.energyStats.co2Saved', 'CO₂ saved'),
      value: co2Kg == null ? null : fmtNumber(co2Kg),
      unit: co2Kg == null ? undefined : 'kg',
    },
  ];

  return (
    <WidgetShell {...shellProps}>
      {data ? (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="shrink-0 space-y-3">
          <WidgetBigNumber
            value={usedWh == null ? null : fmtNumber(convertEnergyFromSI(usedWh, unitPrefs.energy), unitPrefs.energy === 'kWh' ? 1 : 0)}
            unit={unitPrefs.energy}
            label={usedWh == null ? undefined : t('widget.energyStats.totalUsed', 'Total used')}
            animated={false}
            align="start"
          />
          <WidgetStatGrid
            cols={3}
            maxPerRow={3}
            stats={secondaryStats}
          />
          </div>
          <div className="min-h-0 flex-1">
          <WidgetChartSummary
            yAxisLabel={unitPrefs.energy}
            stats={[]}
            chart={
              <EmbeddedChart
                empty={!hasChartData}
                emptyMessage={t('widget.energyStats.noData', 'No energy data available')}
                title={t('widget.energyStats.title', 'Energy stats')}
                ariaLabel={t('widget.energyStats.chartAria', 'Daily driving energy usage')}
                data={chartData}
                dataColumns={[
                  { key: 'date', label: t('widget.energyStats.date', 'Date') },
                  { key: 'energy', label: `${t('widget.energyStats.dailyUsage', 'Daily usage')} (${unitPrefs.energy})` },
                ]}
                className="h-full min-h-0"
                viewportClassName="min-h-0 sm:min-h-0"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
                    {chartGrid}
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={axisWidth}
                      tickFormatter={(value: number) => fmtNumber(value)}
                      tick={{ fontSize: size.cols >= 3 ? 11 : 10 }}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      formatter={(value: number) => [
                        `${fmtNumber(value)} ${unitPrefs.energy}`,
                        t('widget.energyStats.dailyUsage', 'Daily usage'),
                      ]}
                      cursor={{ fill: chartTokens.gridStroke }}
                    />
                    <Bar
                      dataKey="energy"
                      fill={chartTokens.series[2]}
                      radius={[3, 3, 0, 0]}
                      name={t('widget.energyStats.dailyUsage', 'Daily usage')}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            }
          />
          </div>
        </div>
      ) : (
        <EmptyState
          variant="informational"
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.energyStats.noData', 'No energy data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
