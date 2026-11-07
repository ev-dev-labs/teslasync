import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, chartAnimationProps, ChartTooltip, EmbeddedChart, Cell, Legend, useThemeChartPalette, useMeasuredAxisWidth, type ChartDataRow } from '@/components/charts';
import { Badge, Caption, Icon } from '@/components/ui';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useCostForecast } from '@/api/hooks/useCharging';
import { useFormatting } from '@/hooks/useFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber, knownString } from '@/api/dataState';
import { EmptyState, Skeleton } from '@/components/feedback';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
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
  // Recharts mounts content functions as components; avoid remount/refetch loops.
  const forecastTooltip = useCallback(({ active, label, payload }: {
    active?: boolean; label?: string | number; payload?: readonly { payload?: unknown }[];
  }) => {
    const point = payload?.[0]?.payload as BarDatum | undefined;
    return <ChartTooltip active={active} label={label}
      payload={point ? [{
        name: point.period === 'forecast'
          ? t('widget.costForecast.forecast', 'Forecast')
          : t('widget.costForecast.actual', 'Actual'),
        value: point.cost, color: palette.primary,
      }] : []}
      valueFormatter={(value) => {
        const amount = knownNumber(value);
        return amount == null ? '—' : formatCurrency(amount);
      }} />;
  }, [formatCurrency, palette.primary, t]);
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
  const headline = (
    <WidgetBigNumber
      value={nextCost == null ? null : formatCurrency(nextCost)}
      label={isCompact ? t('widget.costForecast.nextPeriod', 'Next {{count}} months', { count: forecastMonths.length || 6 }) : undefined}
      subtitle={!isCompact ? t('widget.costForecast.nextPeriod', 'Next {{count}} months', { count: forecastMonths.length || 6 }) : undefined}
      animated={false}
    />
  );
  const periodRange = (months: readonly { month: string }[]) => {
    if (months.length === 0) return null;
    const first = knownString(months[0]?.month);
    const last = knownString(months[months.length - 1]?.month);
    if (first == null || last == null) return null;
    return first === last ? formatMonthName(first) : `${formatMonthName(first)} – ${formatMonthName(last)}`;
  };
  const context = <Badge variant="neutral" size="sm">{t('widget.costForecast.forecast', 'Forecast')}</Badge>;
  const details = (
    <div className="space-y-2">
      <WidgetStatGrid cols={2} stats={[
        { label: t('widget.costForecast.actual', 'Actual'), value: periodRange(hist) },
        { label: t('widget.costForecast.forecast', 'Forecast'), value: periodRange(forecastMonths) },
      ]} />
      <Caption as="p">{t('dashboardWidgets.battery.costForecast.estimateNote', 'Future costs are estimates.')}</Caption>
    </div>
  );
  const emptyForecast = data == null && <EmptyState message={t('widget.costForecast.noData', 'No forecast data')}
    action={{ label: t('common.refresh', 'Refresh'), onClick: handleRefresh }} />;

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
        <InstrumentPresentation family="line" compact headline={headline}
          icon={<Icon icon={TrendingUp} size="xl" />} context={context}
          instrument={emptyForecast} details={details}>
          {headline}
          {emptyForecast}
        </InstrumentPresentation>
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
  const lineData = chartLabels.map((entry, index) => ({
    ...entry,
    actualCost: entry.period === 'actual' ? entry.cost : null,
    // The dashed projection starts at the last actual observation, without
    // bridging a missing cost or inventing an additional source sample.
    forecastCost: entry.period === 'forecast' || chartLabels[index + 1]?.period === 'forecast'
      ? entry.cost
      : null,
  }));
  const chartAxes = (asLine: boolean) => (
    <>
      {chartGrid}
      <XAxis dataKey="month" tick={tick} tickLine={false} axisLine={false} />
      <YAxis
        tick={tick}
        tickLine={false}
        axisLine={false}
        width={axisWidth}
        tickFormatter={(v: number) => `${currencySymbol}${fmt(v)}`}
      />
      {!asLine ? (
        <Tooltip
          content={<ChartTooltip />}
          formatter={(value: number) => [
            knownNumber(value) == null ? '—' : formatCurrency(value),
            t('widget.costForecast.costLabel', 'Cost'),
          ]}
          cursor={{ fill: palette.neutral, fillOpacity: 0.08 }}
        />
      ) : (
        <Tooltip
          content={forecastTooltip}
          cursor={{ stroke: palette.neutral }}
        />
      )}
      <Legend payload={[
        { value: t('widget.costForecast.actual', 'Actual'), type: asLine ? 'line' : 'square', color: palette.primary },
        { value: t('widget.costForecast.forecast', 'Forecast'), type: asLine ? 'plainline' : 'square',
          color: asLine ? palette.primary : palette.neutral, ...(asLine ? { payload: { strokeDasharray: '6 5' } } : {}) },
      ]} iconSize={8} />
    </>
  );
  const renderChart = (asLine: boolean) => (
    // chart-legend-audit:skip actual and forecast are provenance segments of one cost series; Classic renders the same series as bars
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
      height={asLine ? 180 : undefined}
      empty={chartData.length === 0}
      emptyMessage={t('widget.costForecast.noData', 'No forecast data')}
    >
      <ResponsiveContainer width="100%" height="100%">
        {!asLine ? (
          <BarChart data={chartLabels} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
            {chartAxes(false)}
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
        ) : (
          <LineChart data={lineData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
            {chartAxes(true)}
            <Line dataKey="actualCost" type="linear" stroke={palette.primary}
              strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} connectNulls={false}
              name={t('widget.costForecast.actual', 'Actual')} {...chartAnimationProps()} />
            <Line dataKey="forecastCost" type="linear" stroke={palette.primary}
              strokeWidth={2} strokeDasharray="6 5" dot={{ r: 3 }} activeDot={{ r: 4 }} connectNulls={false}
              name={t('widget.costForecast.forecast', 'Forecast')} {...chartAnimationProps()} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </EmbeddedChart>
  );

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
      <InstrumentPresentation family="line" headline={headline} instrument={renderChart(true)}
        icon={<Icon icon={TrendingUp} size="xl" />} context={context} details={details}>
        <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
          <div className="shrink-0">{headline}</div>
          <div className="min-h-0 flex-1">{renderChart(false)}</div>
        </div>
      </InstrumentPresentation>
    </WidgetShell>
  );
}
