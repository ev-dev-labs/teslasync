import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, BatteryCharging, Leaf, DollarSign, Route, TrendingUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartTooltip, EmbeddedChart, useMeasuredAxisWidth, type ChartDataRow } from '@/components/charts';
import { DataProvenanceBadge } from '@/components/data-display';
import { Caption } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
import { knownNumber } from '@/api/dataState';
import { useEnergyStats } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { convertEfficiencyFromSI, convertEnergyFromSI, type EnergyUnitPref } from '@/lib/unitConversion';

import { chartTokens } from '@/lib/tokens';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import type { DailyEnergy } from '@/types/energy';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** A single point on the daily-energy area chart. */
export interface EnergyChartPoint extends ChartDataRow {
  date: string;
  /** Daily energy converted from Wh to the selected display unit. */
  energy: number | null;
}

/** Keep chart values and unit labels aligned; missing readings remain gaps. */
export function buildEnergyChartData(
  breakdown: DailyEnergy[] | null | undefined,
  unit: EnergyUnitPref = 'kWh',
): EnergyChartPoint[] {
  return (Array.isArray(breakdown) ? breakdown : []).filter((d) => d?.date).map((d) => {
    const energy = knownNumber(d.energy_wh);
    return { date: d.date, energy: energy == null ? null : convertEnergyFromSI(energy, unit) };
  });
}

export default function EnergyStatsWidget({ vehicleId, size, config }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const gradientId = useId();
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const id = vehicleId ?? config?.vehicleId ?? vehicles?.[0]?.id ?? 0;

  const query = useEnergyStats(id > 0 ? String(id) : null);
  const { data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const loading = isLoading || (!id && vehiclesLoading);
  const queryError = error ?? (!id ? vehiclesError : null);
  const dataState = useDataState({
    ...query,
    data: data ?? (loading || queryError || isError ? undefined : null),
    error: queryError,
  }, { provenance: 'historical', partial: !!data && [
    data.total_energy_used_wh, data.total_energy_charged_wh,
    data.avg_efficiency_wh_per_m, data.co2_saved_kg,
  ].some((value) => knownNumber(value) == null) });

  const { unitPrefs, formatEnergy } = useUnits();
  const toEfficiencyDisplay = useCallback(
    (whPerM: number) => convertEfficiencyFromSI(whPerM * 1000, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const dailyBreakdown = data?.daily_breakdown;

  const chartData = useMemo(
    () => buildEnergyChartData(dailyBreakdown, unitPrefs.energy),
    [dailyBreakdown, unitPrefs.energy],
  );

  const hasData = !!data;
  const hasChartData = chartData.some((point) => point.energy != null);
  const axisLabels = useMemo(
    () => [0, ...chartData.map((entry) => entry.energy)]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((value) => fmt(value)),
    [chartData, fmt],
  );
  const axisWidth = useMeasuredAxisWidth({
    labels: axisLabels, fontSize: isWide ? 11 : 10, minWidth: 40, padding: 20, enabled: !isCompact,
  });

  // Build stat items for the grid
  const stats = useMemo((): StatGridItem[] => {
    if (!data) return [];

    const items: StatGridItem[] = [
      {
        label: t('widget.energyStats.totalUsed', 'Total used'),
        value: formatEnergy(knownNumber(data.total_energy_used_wh)),
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.energyStats.totalCharged', 'Total charged'),
        value: formatEnergy(knownNumber(data.total_energy_charged_wh)),
        icon: <BatteryCharging className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.energyStats.avgEfficiency', 'Avg efficiency'),
        value: knownNumber(data.avg_efficiency_wh_per_m) == null ? null : fmtNumber(toEfficiencyDisplay(data.avg_efficiency_wh_per_m)),
        unit: efficiencyUnit,
        icon: <TrendingUp className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.energyStats.co2Saved', 'CO₂ saved'),
        value: knownNumber(data.co2_saved_kg) == null ? null : fmtNumber(data.co2_saved_kg),
        unit: 'kg',
        icon: <Leaf className="h-3.5 w-3.5" />,
      },
    ];

    if (isWide) {
      items.push(
        {
          label: t('widget.energyStats.totalCost', 'Total cost'),
          value: knownNumber(data.total_cost) == null ? null : fmtNumber(data.total_cost),
          unit: '$',
          icon: <DollarSign className="h-3.5 w-3.5" />,
        },
        {
          label: t('widget.energyStats.netBalance', 'Net energy'),
          value: formatEnergy(
            knownNumber(data.total_energy_charged_wh) == null || knownNumber(data.total_energy_used_wh) == null
              ? null : data.total_energy_charged_wh - data.total_energy_used_wh,
          ),
          icon: <Route className="h-3.5 w-3.5" />,
        },
      );
    }

    return items;
  }, [data, isWide, toEfficiencyDisplay, efficiencyUnit, formatEnergy, t, fmtNumber]);

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const shellProps = {
    title: t('widget.energyStats.title', 'Energy stats'),
    icon: <Zap className="h-3.5 w-3.5 text-amber-400" />,
    loading,
    dataState,
    loadingContent: <Skeleton className="h-full min-h-16 rounded-shape-sm" />,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: handleRefresh,
  };

  // ── Compact (1×2) ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        {hasData ? (
          <WidgetBigNumber
            value={knownNumber(data.total_wh) == null ? null : fmtNumber(convertEnergyFromSI(data.total_wh, unitPrefs.energy))}
            unit={unitPrefs.energy}
            align="center"
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Zap className="h-5 w-5" />}
            message={t('widget.energyStats.noData', 'No energy data available')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // ── Standard (2×4) / Wide (3×4+) ──
  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      status={<DataProvenanceBadge provenance={dataState.provenance} status={dataState.status} />}
      footer={hasData ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Caption>{t('widget.energyStats.co2Estimate', 'CO₂ savings are estimated.')}</Caption>
          <DataProvenanceBadge provenance="inferred" />
        </div>
      ) : undefined}
      {...shellProps}
    >
      {hasData ? (
        <div className="flex min-w-0 flex-col gap-3">
          {/* Area chart: daily energy usage */}
          <EmbeddedChart
              empty={!hasChartData}
              emptyMessage={t('widget.energyStats.noData', 'No energy data available')}
              title={t('widget.energyStats.title', 'Energy stats')}
              ariaLabel={t(
                'widget.energyStats.chartAria',
                'Daily driving energy usage',
              )}
              data={chartData}
              dataColumns={[
                { key: 'date', label: t('widget.energyStats.date', 'Date') },
                { key: 'energy', label: `${t('widget.energyStats.dailyUsage', 'Daily usage')} (${unitPrefs.energy})` },
              ]}
              fluid={false}
              className="shrink-0"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
                  {chartGrid}
                  <XAxis
                    dataKey="date"
                    tick={tick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={tick}
                    tickLine={false}
                    axisLine={false}
                    width={axisWidth}
                    tickFormatter={(v: number) => fmt(v)}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    formatter={(value: number) => [
                      `${fmtNumber(value)} ${unitPrefs.energy}`,
                      t('widget.energyStats.dailyUsage', 'Daily usage'),
                    ]}
                    cursor={{ fill: chartTokens.gridStroke }}
                  />
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartTokens.series[2]} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={chartTokens.series[2]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="energy"
                    stroke={chartTokens.series[2]}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                    name={`${t('widget.energyStats.dailyUsage', 'Daily usage')} (${unitPrefs.energy})`}
                  />
                </AreaChart>
              </ResponsiveContainer>
          </EmbeddedChart>

          {/* Stat cards grid */}
          <WidgetStatGrid stats={stats} cols={isWide ? 3 : 2} />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.energyStats.noData', 'No energy data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
