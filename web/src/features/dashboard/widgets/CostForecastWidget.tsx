import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartTooltip, EmbeddedChart, Cell, Legend, useThemeChartPalette, useMeasuredAxisWidth, type ChartDataRow } from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useCostForecast } from '@/api/hooks/useCharging';
import { useFormatting } from '@/hooks/useFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber, knownString } from '@/api/dataState';
import { EmptyState, Skeleton } from '@/components/feedback';
import { WidgetBigNumber } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { CostHistoricalMonth, CostForecastMonth } from '@/types/charging';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useTimezone } from '@/lib/timezone';
import { useDateLabels } from '@/hooks/useDateLabels';

interface BarDatum extends ChartDataRow {
  month: string;
  cost: number | null;
  period: 'actual' | 'forecast';
}

function buildChartData(
  historical: CostHistoricalMonth[],
  forecast: CostForecastMonth[],
): BarDatum[] {
  // The backend contract promises arrays, but a malformed payload must degrade
  // cleanly instead of throwing at `.map` and blanking the whole widget.
  const histArr = Array.isArray(historical) ? historical : [];
  const foreArr = Array.isArray(forecast) ? forecast : [];
  const hist: BarDatum[] = histArr.filter((h) => h != null && typeof h === 'object').map((h) => ({
    month: knownString(h.month) ?? '—',
    cost: knownNumber(h.cost),
    period: 'actual',
  }));
  const fore: BarDatum[] = foreArr.filter((f) => f != null && typeof f === 'object').map((f) => ({
    month: knownString(f.month) ?? '—',
    cost: knownNumber(f.cost),
    period: 'forecast',
  }));
  return [...hist, ...fore].slice(-6);
}

export default function CostForecastWidget({ vehicleId, config, size }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const vid = vehicleId ?? config?.vehicleId ?? vehiclesQuery.data?.[0]?.id ?? null;
  const timezone = useTimezone('vehicle');
  const { formatMonthName } = useDateLabels('vehicle');

  const {
    data, isLoading: forecastLoading, error: forecastError, isFetching, isStale,
    isError: forecastIsError, dataUpdatedAt, refetch,
  } = useCostForecast(vid != null ? String(vid) : null, 6, timezone);

  const { formatCurrency, currencySymbol } = useFormatting();
  const palette = useThemeChartPalette();
  const isLoading = forecastLoading || (vid == null && (vehiclesQuery.isLoading ?? false));
  const error = forecastError ?? (vid == null ? vehiclesQuery.error : null);
  const isError = forecastIsError || (vid == null && (vehiclesQuery.isError ?? false));

  const handleRefresh = useCallback(() => {
    if (vid == null) vehiclesQuery.refetch?.();
    else refetch();
  }, [vid, vehiclesQuery.refetch, refetch]);

  const chartData = useMemo(
    () => buildChartData(data?.historical ?? [], data?.forecast ?? []),
    [data],
  );

  const rawForecast = data?.forecast;
  const forecastMonths = Array.isArray(rawForecast) ? rawForecast : [];
  const rawHistorical = data?.historical;
  const hist = Array.isArray(rawHistorical) ? rawHistorical : [];
  const forecastCosts = forecastMonths.map((entry) => knownNumber(entry?.cost));
  const nextCost = forecastCosts.length > 0 && forecastCosts.every((cost) => cost != null)
    ? forecastCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
    : null;

  const isCompact = size.cols <= 1;
  const axisLabels = useMemo(
    () => [0, ...chartData.map((entry) => entry.cost)]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((value) => `${currencySymbol}${fmt(value)}`),
    [chartData, currencySymbol, fmt],
  );
  const axisWidth = useMeasuredAxisWidth({
    labels: axisLabels, fontSize: size.cols >= 3 ? 11 : 10, minWidth: 40, padding: 20, enabled: !isCompact,
  });
  const dataState = useDataState({
    data: data ?? (isLoading || isError || error ? undefined : null),
    error, isError, isLoading, isFetching, dataUpdatedAt, refetch: handleRefresh,
  }, {
    provenance: 'inferred',
    partial: data != null && (
      !Array.isArray(data.historical) || !Array.isArray(data.forecast)
      || [...hist, ...forecastMonths].some((entry) => entry == null || knownNumber(entry.cost) == null)
      || (forecastMonths.length > 0 && nextCost == null)
    ),
  });

  const shellProps = {
    title: t('widget.costForecast.title', 'Cost forecast'),
  };

  // ── Compact (1×2): big predicted cost + trend ──
  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        loading={isLoading}
        dataState={dataState}
        loadingContent={<Skeleton className="h-full min-h-16 rounded-shape-sm" />}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        <WidgetBigNumber
          value={nextCost == null ? null : formatCurrency(nextCost)}
          label={t('widget.costForecast.nextPeriod', 'Next {{count}} months', { count: forecastMonths.length || 6 })}
          animated={false}
        />
        {data == null && <EmptyState message={t('widget.costForecast.noData', 'No forecast data')}
          action={{ label: t('common.refresh', 'Refresh'), onClick: handleRefresh }} />}
      </WidgetShell>
    );
  }

  // ── Standard (2×4): stat header + bar chart ──
  const isWide = size.cols >= 3;
  const tick = isWide ? axisTick : axisTickSm;
  const chartLabels = chartData.map((entry) => ({
    ...entry,
    month: formatMonthName(entry.month),
  }));

  return (
    <WidgetShell
      {...shellProps}
      loading={isLoading}
      dataState={dataState}
      loadingContent={<Skeleton className="h-full min-h-24 rounded-shape-sm" />}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <div className="flex h-full min-w-0 flex-col gap-2">
        <WidgetBigNumber
          value={nextCost == null ? null : formatCurrency(nextCost)}
          subtitle={t('widget.costForecast.nextPeriod', 'Next {{count}} months', { count: forecastMonths.length || 6 })}
          animated={false}
        />
        <div className="min-h-0 flex-1">
          <EmbeddedChart
            title={t('widget.costForecast.title', 'Cost forecast')}
            ariaLabel={t(
              'widget.costForecast.chartLabel',
              'Monthly charging cost history and forecast',
            )}
            data={chartLabels}
            dataColumns={[
              { key: 'month', label: t('widget.costForecast.month', 'Month') },
              {
                key: 'cost',
                label: t('widget.costForecast.costLabel', 'Cost'),
                format: (value) => {
                  const amount = knownNumber(value);
                  return amount == null ? '—' : formatCurrency(amount);
                },
              },
              {
                key: 'period',
                label: t('widget.costForecast.periodType', 'Period type'),
                format: (value) => value === 'forecast'
                  ? t('widget.costForecast.forecast', 'Forecast')
                  : t('widget.costForecast.actual', 'Actual'),
              },
            ]}
            className="h-full w-full"
            empty={chartData.length === 0}
            emptyMessage={t('widget.costForecast.noData', 'No forecast data')}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartLabels} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="month" tick={tick} tickLine={false} axisLine={false} />
                <YAxis
                  tick={tick}
                  tickLine={false}
                  axisLine={false}
                  width={axisWidth}
                  tickFormatter={(v: number) => `${currencySymbol}${fmt(v)}`}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  formatter={(value: number) => [
                    knownNumber(value) == null ? '—' : formatCurrency(value),
                    t('widget.costForecast.costLabel', 'Cost'),
                  ]}
                  cursor={{ fill: palette.neutral, fillOpacity: 0.08 }}
                />
                <Legend payload={[
                  { value: t('widget.costForecast.actual', 'Actual'), type: 'square', color: palette.primary },
                  { value: t('widget.costForecast.forecast', 'Forecast'), type: 'square', color: palette.neutral },
                ]} iconSize={8} />
                <Bar
                  dataKey="cost"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                  fill={palette.primary}
                  name={t('widget.costForecast.costLabel', 'Cost')}
                >
                  {chartLabels.map((entry, index) => (
                    <Cell
                      key={`${entry.period}-${entry.month}-${index}`}
                      fill={entry.period === 'forecast' ? palette.neutral : palette.primary}
                      stroke={entry.period === 'forecast' ? palette.primary : undefined}
                      strokeDasharray={entry.period === 'forecast' ? '3 3' : undefined}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        </div>
      </div>
    </WidgetShell>
  );
}
