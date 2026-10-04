import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ThermometerSun } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartLegend, ChartTooltip, EmbeddedChart, useMeasuredAxisWidth, type ChartDataRow } from '@/components/charts';
import { useClimateHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';

import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { CHART_COLORS } from '@/components/charts';

interface ChartDatum extends ChartDataRow {
  time: string;
  inside: number | null;
  outside: number | null;
}

function buildChartData(
  data: ReturnType<typeof useClimateHistory>['data'],
  toTemperatureDisplay: (c: number) => number,
): ChartDatum[] {
  const items = safeArray(data);
  return items
    .filter((d) => d.created_at || d.timestamp)
    .map((d) => {
      const ts = d.created_at ?? d.timestamp ?? '';
      const insideRaw = knownNumber(d.insideTemp);
      const outsideRaw = knownNumber(d.outsideTemp);
      const inside = insideRaw != null ? toTemperatureDisplay(insideRaw) : null;
      const outside = outsideRaw != null ? toTemperatureDisplay(outsideRaw) : null;
      return { time: ts, inside, outside };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

export default function ClimateHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatDateTime: formatTime } = useDateFormat();
  const vehiclesQuery = useVehicles();
  const candidate = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const vid = Number.isSafeInteger(candidate) && Number(candidate) > 0 ? Number(candidate) : 0;
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  // Memoise on the primitive unit so the chartData memo below actually caches;
  // an inline arrow would be a new reference every render and defeat it.
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, tempUnit),
    [tempUnit],
  );

  const query = useClimateHistory(vid > 0 ? String(vid) : '');
  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;

  const handleRefresh = useCallback(() => {
    if (vehicleId == null) void vehiclesQuery.refetch?.();
    if (vid) void refetch();
  }, [refetch, vehicleId, vehiclesQuery, vid]);

  const chartData = useMemo(
    () => buildChartData(data, toTemperatureDisplay),
    [data, toTemperatureDisplay],
  );

  const hasData = chartData.length > 0;
  const discoveryState = useDataState(vehiclesQuery);
  const sourceState = useDataState({
    ...query,
    data: data ?? (!vid || (!isLoading && !query.isPending && !isError) ? null : undefined),
  }, {
    provenance: 'historical', unavailable: !hasData,
    partial: chartData.some((row) => row.inside == null || row.outside == null),
  });
  const dataState = !vid && vehicleId == null && discoveryState.status !== 'ok'
    ? discoveryState : sourceState;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const latestInside = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].inside != null) return chartData[i].inside;
    }
    return null;
  }, [chartData]);

  const latestOutside = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].outside != null) return chartData[i].outside;
    }
    return null;
  }, [chartData]);

  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.climateHistory.cabin', 'Cabin'),
          value: latestInside != null ? fmt(latestInside) : '—',
          unit: tempUnit,
        },
        {
          label: t('widget.climateHistory.outside', 'Outside'),
          value: latestOutside != null ? fmt(latestOutside) : '—',
          unit: tempUnit,
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;
  const temperatureAxisLabels = useMemo(() => [0, ...chartData.flatMap(point => [point.inside, point.outside])
    .filter((value): value is number => value != null && Number.isFinite(value))]
    .map(value => `${fmt(value)}°`), [chartData, fmt]);
  const temperatureAxisWidth = useMeasuredAxisWidth({
    labels: temperatureAxisLabels, fontSize: tick.fontSize, minWidth: 35, padding: 20, enabled: !isCompact,
  });

  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.climateHistory.title', 'Climate history')}
        dataState={{ ...dataState, retry: handleRefresh }}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.climateHistory.noData', 'No climate history')}
          emptyIcon={<ThermometerSun className="h-5 w-5" />}
          stats={stats}
          chart={null}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.climateHistory.title', 'Climate history')}
      icon={<ThermometerSun className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      dataState={{ ...dataState, retry: handleRefresh }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.climateHistory.noData', 'No climate history')}
        emptyIcon={<ThermometerSun className="h-5 w-5" />}
        stats={stats}
        chart={
          <EmbeddedChart
            title={t('widget.climateHistory.title', 'Climate history')}
            ariaLabel={t(
              'widget.climateHistory.chartAria',
              'Cabin and outside temperature history',
            )}
            data={chartData}
            dataColumns={[
              { key: 'time', label: t('widget.climateHistory.time', 'Time') },
              { key: 'inside', label: `${t('widget.climateHistory.cabin', 'Cabin')} (${tempUnit})` },
              { key: 'outside', label: `${t('widget.climateHistory.outside', 'Outside')} (${tempUnit})` },
            ]}
            chartKey="dashboard-climate-history"
            className="h-full w-full"
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
              {chartGrid}
              <defs>
                <linearGradient id="gradInside" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradOutside" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[1]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS[1]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tick={tick}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => formatTime(v)}
              />
              <YAxis
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={temperatureAxisWidth}
                tickFormatter={(v: number) => `${fmt(v)}°`}
              />
              <Tooltip
                content={<ChartTooltip />}
                labelFormatter={(v: string) => formatTime(v)}
                formatter={(value: number, name: string) => {
                  const label =
                    name === 'inside'
                      ? t('widget.climateHistory.cabin', 'Cabin')
                      : t('widget.climateHistory.outside', 'Outside');
                  return [`${fmt(value)}${tempUnit}`, label];
                }}
              />
              <ChartLegend />
              <Area
                type="monotone"
                dataKey="inside"
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                fill="url(#gradInside)"
                connectNulls={false}
                name="inside"
                hide={hiddenSeries?.isHidden('inside')}
              />
              <Area
                type="monotone"
                dataKey="outside"
                stroke={CHART_COLORS[1]}
                strokeWidth={2}
                fill="url(#gradOutside)"
                connectNulls={false}
                name="outside"
                hide={hiddenSeries?.isHidden('outside')}
              />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </EmbeddedChart>
        }
      />
    </WidgetShell>
  );
}
