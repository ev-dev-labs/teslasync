import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cog } from 'lucide-react';
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceArea,
  ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm,
  chartAnimation, fmt,
  ChartLegend, ChartTooltip, EmbeddedChart, type ChartDataRow,
} from '@/components/charts';
import { useMotorHistory } from '@/api/hooks/useVehicles';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';

interface ChartDatum extends ChartDataRow {
  time: string;
  torque: number | null;
  statorTemp: number | null;
  gear: string | null;
  lateralG: number | null;
  longitudinalG: number | null;
}

/** Convert raw MotorSnapshot[] into sorted chart data. */
function buildChartData(
  data: ReturnType<typeof useMotorHistory>['data'],
  toTemperatureDisplay: (c: number) => number,
): ChartDatum[] {
  const items = data ?? [];
  return items
    .filter((d) => d.ts || d.created_at)
    .map((d) => {
      const ts = d.ts || d.created_at || '';
      const raw = d as unknown as Record<string, number | string | null | undefined>;
      const statorRaw = d.di_stator_temp ?? d.motor_temp_c_front ?? null;
      return {
        time: ts,
        torque: d.di_torque ?? null,
        statorTemp: statorRaw != null ? toTemperatureDisplay(statorRaw) : null,
        gear: d.gear ?? d.shift_state ?? null,
        lateralG: (raw.lateral_accel as number | null) ?? null,
        longitudinalG: (raw.longitudinal_accel as number | null) ?? null,
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Danger-zone threshold in Celsius (100°C) — converted to display unit for rendering. */
const DANGER_TEMP_C = 100;

export default function MotorHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime: formatTime } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  // Stable per temperature preference so the chartData / danger-threshold
  // memos below actually memoize (an inline arrow would be a new reference
  // every render and defeat them).
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );

  const tempUnit = unitPrefs.temperature;

  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useMotorHistory(vid, 200);

  const chartData = useMemo(
    () => buildChartData(data, toTemperatureDisplay),
    [data, toTemperatureDisplay],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Latest values for summary stats
  const latestTorque = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].torque != null) return chartData[i].torque;
    }
    return null;
  }, [chartData]);

  const latestStatorTemp = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].statorTemp != null) return chartData[i].statorTemp;
    }
    return null;
  }, [chartData]);

  const dangerThreshold = useMemo(() => toTemperatureDisplay(DANGER_TEMP_C), [toTemperatureDisplay]);

  // Compute Y-axis domain for stator temp so ReferenceArea renders correctly
  const tempMax = useMemo(() => {
    let max = dangerThreshold + 20;
    for (const d of chartData) {
      if (d.statorTemp != null && d.statorTemp > max) max = d.statorTemp;
    }
    return Math.ceil(max);
  }, [chartData, dangerThreshold]);

  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.motorHistory.torque', 'Torque'),
          value: latestTorque != null ? fmtNumber(latestTorque, 0) : '—',
          unit: 'Nm',
        },
        {
          label: t('widget.motorHistory.statorTemp', 'Stator'),
          value: latestStatorTemp != null ? fmtNumber(latestStatorTemp, 0) : '—',
          unit: tempUnit,
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  const shellProps = {
    loading: isLoading,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.motorHistory.noData', 'No motor history')}
          emptyIcon={<Cog className="h-5 w-5" />}
          stats={stats}
          chart={null}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.motorHistory.title', 'Motor History')}
      icon={<Cog className="h-3.5 w-3.5 text-neon-cyan" />}
      {...shellProps}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.motorHistory.noData', 'No motor history')}
        emptyIcon={<Cog className="h-5 w-5" />}
        stats={stats}
        chart={
          <EmbeddedChart
            title={t('widget.motorHistory.title', 'Motor History')}
            ariaLabel={t(
              'widget.motorHistory.chartAria',
              'Motor torque, stator temperature, and acceleration history',
            )}
            data={chartData}
            dataColumns={[
              { key: 'time', label: t('widget.motorHistory.time', 'Time'), format: (value) => formatTime(String(value ?? '')) },
              { key: 'torque', label: t('widget.motorHistory.torqueNm', 'Torque (Nm)') },
              { key: 'statorTemp', label: `${t('widget.motorHistory.statorTemp', 'Stator')} (${tempUnit})` },
              { key: 'lateralG', label: t('widget.motorHistory.lateralG', 'Lateral G') },
              { key: 'longitudinalG', label: t('widget.motorHistory.longG', 'Long. G') },
            ]}
            chartKey="dashboard-motor-history"
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="time"
                tick={tick}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => formatTime(v)}
              />
              {/* Left Y-axis — Torque (Nm) */}
              <YAxis
                yAxisId="torque"
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => `${fmt(v, 0)}`}
                label={isWide ? { value: 'Nm', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.4)', fontSize: 10 } : undefined}
              />
              {/* Right Y-axis — Stator temp */}
              <YAxis
                yAxisId="temp"
                orientation="right"
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={40}
                domain={[0, tempMax]}
                tickFormatter={(v: number) => `${fmt(v, 0)}°`}
                label={isWide ? { value: tempUnit, angle: 90, position: 'insideRight', fill: 'rgba(255,255,255,0.4)', fontSize: 10 } : undefined}
              />
              <Tooltip
                content={<ChartTooltip />}
                labelFormatter={(v: string) => formatTime(v)}
                formatter={(value: number, name: string) => {
                  if (name === 'torque') {
                    return [`${fmtNumber(value, 0)} Nm`, t('widget.motorHistory.torque', 'Torque')];
                  }
                  if (name === 'statorTemp') {
                    return [`${fmtNumber(value, 0)}${tempUnit}`, t('widget.motorHistory.statorTemp', 'Stator')];
                  }
                  if (name === 'lateralG') {
                    return [`${fmtNumber(value, 2)} g`, t('widget.motorHistory.lateralG', 'Lateral G')];
                  }
                  if (name === 'longitudinalG') {
                    return [`${fmtNumber(value, 2)} g`, t('widget.motorHistory.longG', 'Long. G')];
                  }
                  return [String(value), name];
                }}
              />
              <ChartLegend />
              {/* Danger zone band above 100°C */}
              <ReferenceArea
                yAxisId="temp"
                y1={dangerThreshold}
                y2={tempMax}
                fill="#ef4444"
                fillOpacity={0.1}
              />
              {/* Torque line — cyan */}
              <Line
                yAxisId="torque"
                type="monotone"
                dataKey="torque"
                stroke="#06b6d4"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                name="torque"
                hide={hiddenSeries?.isHidden('torque')}
              />
              {/* Stator temp line — orange */}
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="statorTemp"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                name="statorTemp"
                hide={hiddenSeries?.isHidden('statorTemp')}
              />
              {/* Wide mode: g-force overlays */}
              {isWide && (
                <Line
                  yAxisId="torque"
                  type="monotone"
                  dataKey="lateralG"
                  stroke="#a78bfa"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                  name="lateralG"
                  hide={hiddenSeries?.isHidden('lateralG')}
                />
              )}
              {isWide && (
                <Line
                  yAxisId="torque"
                  type="monotone"
                  dataKey="longitudinalG"
                  stroke="#34d399"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                  name="longitudinalG"
                  hide={hiddenSeries?.isHidden('longitudinalG')}
                />
              )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </EmbeddedChart>
        }
      />
    </WidgetShell>
  );
}
