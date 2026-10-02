import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart as PieIcon, DollarSign, TrendingDown, Fuel } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, useThemeChartPalette,
  EmbeddedChart, ChartTooltip, BarChart, Bar, XAxis, YAxis,
  chartMargin, chartAnimation, axisTickSm,
  type ChartDataRow,
} from '@/components/charts';
import { EmptyState, Skeleton } from '@/components/feedback';
import { DataProvenanceBadge } from '@/components/data-display';
import { Caption } from '@/components/ui';
import { useCostBreakdown } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber, knownString } from '@/api/dataState';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { WidgetRankedList, WidgetBigNumber, WidgetStatGrid, WidgetDetailCard, type RankedItem } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

interface DonutSegment extends ChartDataRow {
  name: string;
  value: number | null;
  color: string;
}

export default function CostBreakdownWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const id = vehicleId ?? config?.vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const { formatCurrency } = useFormatting();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;

  const {
    data,
    isLoading: costLoading,
    error: costError,
    isFetching,
    isStale,
    isError: costIsError,
    dataUpdatedAt,
    refetch,
  } = useCostBreakdown(id == null ? '' : String(id));

  const isLoading = costLoading || (id == null && (vehiclesQuery.isLoading ?? false));
  const error = costError ?? (id == null ? vehiclesQuery.error : null);
  const isError = costIsError || (id == null && (vehiclesQuery.isError ?? false));
  const isCompact = size.cols <= 1;
  const palette = useThemeChartPalette();
  const formatAmount = useCallback((value: unknown, decimals?: number) => {
    const amount = knownNumber(value);
    return amount == null ? '—' : formatCurrency(amount, decimals);
  }, [formatCurrency]);

  const monthlyEntries = useMemo(() => (
    Array.isArray(data?.monthly_breakdown)
      ? data.monthly_breakdown.filter((entry) => entry != null && typeof entry === 'object')
      : []
  ), [data]);

  // The existing tariff contract is currency/km, not a distance measurement.
  const costPerDist = useMemo(() => {
    const costPerKm = knownNumber(data?.cost_per_km_ev);
    return costPerKm == null ? null : costPerKm / convertDistanceFromSI(1000, distanceUnit);
  }, [data, distanceUnit]);

  const latestMonthCost = knownNumber(monthlyEntries[monthlyEntries.length - 1]?.ev_cost);

  const donutData = useMemo((): DonutSegment[] => {
    const recent = monthlyEntries.slice(-6);
    return recent.map((entry, i) => ({
      name: knownString(entry.month) ?? '—',
      value: knownNumber(entry.ev_cost),
      color: palette.series[i % palette.series.length],
    }));
  }, [monthlyEntries, palette]);

  const rankedItems = useMemo((): RankedItem[] => {
    return monthlyEntries.flatMap((entry, i) => {
      const value = knownNumber(entry.ev_cost);
      return value == null ? [] : [{
        id: `${entry.month ?? 'unknown'}-${i}`,
        label: knownString(entry.month) ?? '—',
        value,
        formattedValue: formatAmount(value),
      }];
    });
  }, [monthlyEntries, formatAmount]);

  const unknownMonths = monthlyEntries
    .filter((entry) => knownNumber(entry.ev_cost) == null)
    .map((entry) => ({ label: knownString(entry.month) ?? '—', value: '—' }));
  const totalCost = knownNumber(data?.total_charging_cost);
  const totalSavings = knownNumber(data?.total_savings);
  const monthlySavings = knownNumber(data?.monthly_savings);
  const handleRefresh = useCallback(() => {
    if (id == null) vehiclesQuery.refetch?.();
    else refetch();
  }, [id, vehiclesQuery.refetch, refetch]);
  const dataState = useDataState({
    data: data ?? (isLoading || isError || error ? undefined : null),
    error, isError, isLoading, isFetching, dataUpdatedAt, refetch: handleRefresh,
  }, {
    provenance: 'historical',
    partial: data != null && (
      !Array.isArray(data.monthly_breakdown)
      || monthlyEntries.length !== data.monthly_breakdown.length
      || unknownMonths.length > 0
      || [totalCost, totalSavings, costPerDist, monthlySavings].some((value) => value == null)
    ),
  });
  const canUseDonut = donutData.every((entry) => entry.value != null && entry.value >= 0)
    && donutData.some((entry) => entry.value != null && entry.value > 0);
  const primaryCost = monthlyEntries.length > 0 ? latestMonthCost : totalCost;

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        dataState={dataState}
        loadingContent={<Skeleton className="h-full min-h-16 rounded-shape-sm" />}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {data != null ? (
          <WidgetBigNumber
            value={primaryCost == null ? null : formatAmount(primaryCost)}
            label={monthlyEntries.length > 0
              ? t('widget.costBreakdown.latestMonth', 'Latest recorded month')
              : t('widget.costBreakdown.totalCost', 'Total cost')}
            subtitle={
              monthlySavings != null
                ? t('widget.costBreakdown.monthlySavingsEstimate', 'Monthly savings estimate vs gas: {{amount}}', {
                    amount: formatCurrency(monthlySavings),
                  })
                : undefined
            }
            badge={
              totalSavings != null && totalSavings > 0
                ? { text: t('widget.costBreakdown.saving', 'Saving'), variant: 'success' as const }
                : undefined
            }
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<PieIcon className="h-5 w-5" />}
            message={t('widget.costBreakdown.noData', 'No cost data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.costBreakdown.title', 'Cost breakdown')}
      icon={<PieIcon className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading}
      dataState={dataState}
      loadingContent={<Skeleton className="h-full min-h-24 rounded-shape-sm" />}
      status={<DataProvenanceBadge provenance={dataState.provenance} status={dataState.status} />}
      footer={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Caption>{t('widget.costBreakdown.lifetime', 'Lifetime')}</Caption>
          <DataProvenanceBadge provenance="inferred" />
          <Caption>{t('widget.costBreakdown.gasEstimate', 'Gas comparison is estimated.')}</Caption>
        </div>
      }
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
        <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
          <WidgetStatGrid cols={3} stats={[
            { label: t('widget.costBreakdown.totalCost', 'Total cost'), value: formatAmount(totalCost), icon: <DollarSign className="size-3.5" /> },
            { label: t('widget.costBreakdown.costPerDist', 'Cost / {{unit}}', { unit: distanceUnit }), value: formatAmount(costPerDist, 3), icon: <Fuel className="size-3.5" /> },
            { label: t('widget.costBreakdown.gasSavings', 'Gas savings'), value: formatAmount(totalSavings), icon: <TrendingDown className="size-3.5" /> },
          ]} />
          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-3 @sm:grid-cols-2 @sm:grid-rows-1">
          <EmbeddedChart
            title={t('widget.costBreakdown.title', 'Cost breakdown')}
            ariaLabel={t(
              'widget.costBreakdown.chartLabel',
              'Monthly EV charging cost breakdown',
            )}
            data={donutData}
            dataColumns={[
              { key: 'name', label: t('widget.costBreakdown.month', 'Month') },
              {
                key: 'value',
                label: t('widget.costBreakdown.cost', 'Cost'),
                format: (value) => formatAmount(value),
              },
            ]}
            empty={donutData.length === 0}
            emptyMessage={t('widget.costBreakdown.noData', 'No cost data')}
            className="h-full min-w-0"
          >
            <ResponsiveContainer width="100%" height="100%">
              {canUseDonut ? (
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {donutData.map((seg, i) => (
                    <Cell key={`${seg.name}-${i}`} fill={seg.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={<ChartTooltip valueFormatter={(value) => formatAmount(value, 2)} />}
                />
              </PieChart>
              ) : (
                <BarChart data={donutData} margin={chartMargin} {...chartAnimation}>
                  <XAxis dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTickSm} width={45} tickLine={false} axisLine={false} tickFormatter={(value: number) => formatAmount(value, 0)} />
                  <Tooltip content={<ChartTooltip valueFormatter={(value) => formatAmount(value, 2)} />} />
                  <Bar dataKey="value" name={t('widget.costBreakdown.cost', 'Cost')} fill={palette.primary} maxBarSize={32} radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </EmbeddedChart>

          <div className="min-h-0 min-w-0 overflow-auto">
          <WidgetRankedList
            items={rankedItems}
            compact={false}
            maxItems={5}
            showBars={rankedItems.every((entry) => entry.value >= 0)}
            emptyMessage={t('widget.costBreakdown.noData', 'No cost data')}
            emptyIcon={<PieIcon className="h-5 w-5" />}
          />
          {unknownMonths.length > 0 && <WidgetDetailCard entries={unknownMonths} compact />}
          </div>
          </div>
        </div>
    </WidgetShell>
  );
}
