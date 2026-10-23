import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ThermometerSun } from 'lucide-react';
import { LineChart, Line, XAxis, Tooltip, ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartTooltip, EmbeddedChart, type ChartDataRow } from '@/components/charts';
import { useClimateHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';

import { useDateFormat } from '@/hooks/useDateFormat';
import { useRangeState } from '@/hooks/useRangeState';
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
    .filter((d) => {
      const ts = d.created_at ?? d.timestamp;
      return typeof ts === 'string' && Number.isFinite(Date.parse(ts));
    })
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
  const { fmtInt: fmt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatTime } = useDateFormat();
  const vehiclesQuery = useVehicles();
  const candidate = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const vid = Number.isSafeInteger(candidate) && Number(candidate) > 0 ? Number(candidate) : 0;
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  const { startInstant, endInstantExclusive } = useRangeState({ defaultPresetId: '24h' });
  // Memoise on the primitive unit so the chartData memo below actually caches;
  // an inline arrow would be a new reference every render and defeat it.
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, tempUnit),
    [tempUnit],
  );

  const query = useClimateHistory(
    vid > 0 ? String(vid) : '',
    vid > 0 ? { start: startInstant, end: endInstantExclusive } : undefined,
  );
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
  const tick = size.cols >= 3 ? axisTick : axisTickSm;
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
  const stats: ChartSummaryStat[] = hasData ? [
    { label: t('widget.climateHistory.cabin', 'Cabin'), value: latestInside != null ? fmt(latestInside) : '—', unit: tempUnit },
    { label: t('widget.climateHistory.outside', 'Outside'), value: latestOutside != null ? fmt(latestOutside) : '—', unit: tempUnit },
  ] : [];

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
        stats={[]}
        legend={[
          { label: t('widget.inside', 'Inside'), color: CHART_COLORS[0] },
          { label: t('widget.climateHistory.outside', 'Outside'), color: CHART_COLORS[1] },
        ]}
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
              <LineChart data={chartData} margin={{ ...chartMargin, left: 4, right: 4 }} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="time"
                tick={tick}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => formatTime(v)}
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
              <Line
                type="monotone"
                dataKey="inside"
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                connectNulls={false}
                name="inside"
                hide={hiddenSeries?.isHidden('inside')}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="outside"
                stroke={CHART_COLORS[1]}
                strokeWidth={2}
                connectNulls={false}
                name="outside"
                hide={hiddenSeries?.isHidden('outside')}
                dot={false}
                isAnimationActive={false}
              />
              </LineChart>
            </ResponsiveContainer>
            )}
            </EmbeddedChart>
        }
      />
    </WidgetShell>
  );
}
