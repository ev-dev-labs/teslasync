import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cog } from 'lucide-react';
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceArea,
  ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm,
  chartAnimation, EmbeddedChart, ChartTooltip, ChartLegend, useMeasuredAxisWidth, type ChartDataRow,
} from '@/components/charts';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useMotorHistory, useVehicles } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useRangeState } from '@/hooks/useRangeState';
import { useUnits } from '@/hooks/useUnits';
import { convertTempFromSI } from '@/lib/unitConversion';
import { WidgetBigNumber } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { CHART_COLORS, COLOR } from '@/lib/colors';

interface MotorHistoryDatum extends ChartDataRow {
  time: string;
  temperature: number | null;
  torque: number | null;
  statorTemp: number | null;
}

function buildChartData(
  data: ReturnType<typeof useMotorHistory>['data'],
  toDisplay: (value: number) => number,
): MotorHistoryDatum[] {
  return (data ?? [])
    .map((sample) => {
      const ts = sample.ts || sample.created_at || '';
      const raw = sample.di_stator_temp ?? sample.motor_temp_c_rear ?? sample.motor_temp_c_front ?? null;
      const torque = sample.di_torque ?? null;
      const temperature = raw != null && Number.isFinite(raw) ? toDisplay(raw) : null;
      return {
        time: ts,
        temperature,
        torque: torque != null && Number.isFinite(torque) ? torque : null,
        statorTemp: temperature,
      };
    })
    .filter((row) => row.time !== '')
    .sort((a, b) => a.time.localeCompare(b.time));
}

export default function MotorHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatDateTime, formatTime, formatDateShort } = useDateFormat();
  const { unitPrefs } = useUnits();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { start, end, startInstant, endInstantExclusive, presetId } =
    useRangeState({ defaultPresetId: '7d' });

  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );
  const tempUnit = unitPrefs.temperature;
  const query = useMotorHistory(vid, {
    limit: 200,
    start: startInstant,
    end: endInstantExclusive,
  });
  const { data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const trust = useDataState({
    ...query,
    data: data ?? (isLoading || isError ? undefined : []),
  }, { provenance: 'historical', unavailable: data?.length === 0 });

  const chartData = useMemo(
    () => buildChartData(data, toTemperatureDisplay),
    [data, toTemperatureDisplay],
  );
  const hasData = chartData.some((row) => row.temperature != null);
  const isCompact = size.cols <= 1;
  const peak = useMemo(() => {
    const values = chartData
      .map((row) => row.temperature)
      .filter((value): value is number => value != null && Number.isFinite(value));
    return values.length ? Math.max(...values) : null;
  }, [chartData]);

  const dangerThreshold = toTemperatureDisplay(120);
  const tempMax = useMemo(() => {
    const highest = chartData.reduce(
      (max, row) => row.temperature != null ? Math.max(max, row.temperature) : max,
      Math.max(dangerThreshold, -Infinity),
    );
    return Math.ceil(highest + 10);
  }, [chartData, dangerThreshold]);

  const rangeLabel = presetId === '7d'
    ? t('widget.motorHistory.last7Days', '7 days')
    : `${formatDateShort(`${start}T00:00:00`)} – ${formatDateShort(`${end}T00:00:00`)}`;
  const temperatureLabels = useMemo(() => chartData
    .map((row) => row.temperature)
    .filter((value): value is number => value != null && Number.isFinite(value))
    .map((value) => `${fmt(value)}°`), [chartData, fmt]);
  const torqueLabels = useMemo(() => [0, ...chartData.map((row) => row.torque)]
    .filter((value): value is number => value != null && Number.isFinite(value))
    .map((value) => fmt(value)), [chartData, fmt]);
  const torqueWidth = useMeasuredAxisWidth({
    labels: torqueLabels,
    fontSize: size.cols >= 3 ? 11 : 10,
    minWidth: 40,
    padding: 20,
    enabled: !isCompact,
  });
  const statorLabels = useMemo(
    () => [0, dangerThreshold, tempMax, ...chartData.map((row) => row.temperature)]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((value) => `${fmt(value)}°`),
    [chartData, dangerThreshold, tempMax, fmt],
  );
  const statorWidth = useMeasuredAxisWidth({
    labels: statorLabels,
    fontSize: size.cols >= 3 ? 11 : 10,
    minWidth: 40,
    padding: 20,
    enabled: !isCompact,
  });

  const shellProps = {
    loading: isLoading,
    dataState: trust,
    loadingContent: <Skeleton className="h-32 w-full" />,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };
  const noData = (
    <EmptyState
      variant="informational"
      icon={<Cog className="h-5 w-5" />}
      message={t('widget.motorHistory.noData', 'No motor history')}
    />
  );

  if (isCompact) {
    return (
      <WidgetShell title={t('widget.motorHistory.title', 'Motor history')} {...shellProps}>
        <WidgetBigNumber
          value={peak == null ? null : fmt(peak, 0)}
          unit={tempUnit}
          label={t('widget.motorHistory.peakStator', 'Peak stator temp')}
          subtitle={rangeLabel}
          animated={false}
          align="center"
        />
        {!hasData && noData}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.motorHistory.title', 'Motor history')}
      icon={<Cog className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      {...shellProps}
    >
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex min-w-0 items-end justify-between gap-3">
          <WidgetBigNumber
            value={peak == null ? null : fmt(peak, 0)}
            unit={tempUnit}
            label={t('widget.motorHistory.statorTempRange', 'Stator temp · {{range}}', { range: rangeLabel })}
            animated={false}
            align="start"
            size="secondary"
          />
          <span className="pb-1 text-end text-xs text-[var(--text-muted)]">
            {peak != null
              ? t(
                  peak >= dangerThreshold ? 'widget.motorHistory.dangerReached' : 'widget.motorHistory.dangerNotReached',
                  peak >= dangerThreshold ? 'Danger threshold reached' : 'Danger zone not reached',
                )
              : t('widget.motorHistory.awaitingReading', 'Awaiting temperature reading')}
          </span>
        </div>

        {!hasData ? noData : (
          <div className="mt-2 min-h-0 flex-1">
            <EmbeddedChart
              title={t('widget.motorHistory.title', 'Motor history')}
              ariaLabel={t(
                'widget.motorHistory.chartAria',
                'Motor torque, stator temperature, and acceleration history',
              )}
              data={chartData}
              dataColumns={[
                { key: 'time', label: t('widget.motorHistory.time', 'Time'), format: (value) => formatDateTime(String(value ?? '')) },
                { key: 'temperature', label: `${t('widget.motorHistory.statorTemp', 'Stator')} (${tempUnit})` },
              ]}
              chartKey="dashboard-motor-history"
            >
              {({ hiddenSeries }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
                    {chartGrid}
                    <XAxis
                      dataKey="time"
                      tick={size.cols >= 3 ? axisTick : axisTickSm}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: string) => formatTime(value)}
                    />
                    <YAxis
                      yAxisId="torque"
                      tick={size.cols >= 3 ? axisTick : axisTickSm}
                      tickLine={false}
                      axisLine={false}
                      width={torqueWidth}
                      tickFormatter={(value: number) => fmt(value)}
                    />
                    <YAxis
                      yAxisId="temp"
                      orientation="right"
                      tick={size.cols >= 3 ? axisTick : axisTickSm}
                      tickLine={false}
                      axisLine={false}
                      width={statorWidth}
                      domain={[Math.min(...temperatureLabels.map((value) => Number(value.replace('°', ''))).filter(Number.isFinite), dangerThreshold), tempMax]}
                      tickFormatter={(value: number) => `${fmt(value)}°`}
                    />
                    <YAxis
                      yAxisId="acceleration"
                      hide={true}
                      tick={size.cols >= 3 ? axisTick : axisTickSm}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      labelFormatter={(value: string) => formatDateTime(value)}
                      formatter={(value: number) => [
                        `${fmt(value, 0)} ${tempUnit}`,
                        t('widget.motorHistory.statorTemp', 'Stator'),
                      ]}
                    />
                    <ReferenceArea
                      yAxisId="temp"
                      y1={dangerThreshold}
                      y2={tempMax}
                      fill={COLOR.BAD}
                      fillOpacity={0.1}
                    />
                    <ChartLegend />
                    <Line
                      yAxisId="torque"
                      type="monotone"
                      dataKey="torque"
                      stroke={CHART_COLORS[3]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      name={t('widget.motorHistory.torque', 'Torque')}
                      hide={hiddenSeries?.isHidden('torque')}
                    />
                    <Line
                      yAxisId="temp"
                      type="monotone"
                      dataKey="temperature"
                      stroke={CHART_COLORS[1]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      name={t('widget.motorHistory.statorTemp', 'Stator')}
                      hide={hiddenSeries?.isHidden('temperature')}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </EmbeddedChart>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {t(
                'widget.motorHistory.dangerThreshold',
                'Danger zone above {{value}} {{unit}}',
                { value: fmt(dangerThreshold, 0), unit: tempUnit },
              )}
            </div>
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
