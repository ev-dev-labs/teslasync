import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDot } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
} from '@/components/charts';
import { useTirePressureHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertPressureFromSI } from '@/lib/unitConversion';

/** Recommended PSI range in bar (2.4–2.8 bar ≈ 35–41 psi) */
const RECOMMENDED_RANGE_BAR = { low: 2.4, high: 2.8 } as const;

const TIRE_COLORS = {
  fl: '#3b82f6', // blue
  fr: '#06b6d4', // cyan
  rl: '#22c55e', // green
  rr: '#a855f7', // purple
} as const;

interface ChartDatum {
  time: string;
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
}

function buildChartData(
  data: ReturnType<typeof useTirePressureHistory>['data'],
  toPressureDisplay: (bar: number) => number,
): ChartDatum[] {
  const items = data ?? [];
  return items
    .filter((d) => d.timestamp)
    .map((d) => ({
      time: d.timestamp,
      fl: d.frontLeft != null ? toPressureDisplay(d.frontLeft) : null,
      fr: d.frontRight != null ? toPressureDisplay(d.frontRight) : null,
      rl: d.rearLeft != null ? toPressureDisplay(d.rearLeft) : null,
      rr: d.rearRight != null ? toPressureDisplay(d.rearRight) : null,
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function latestNonNull(data: ChartDatum[], key: keyof Omit<ChartDatum, 'time'>): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i][key];
    if (v != null) return v;
  }
  return null;
}

export default function TirePressureHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const toPressureDisplay = (value: number) => convertPressureFromSI(value, unitPrefs.pressure);

  const pressureUnit = unitPrefs.pressure;

  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useTirePressureHistory(vid > 0 ? String(vid) : '');

  const chartData = useMemo(
    () => buildChartData(data, toPressureDisplay),
    [data, toPressureDisplay],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const latestFL = useMemo(() => latestNonNull(chartData, 'fl'), [chartData]);
  const latestFR = useMemo(() => latestNonNull(chartData, 'fr'), [chartData]);
  const latestRL = useMemo(() => latestNonNull(chartData, 'rl'), [chartData]);
  const latestRR = useMemo(() => latestNonNull(chartData, 'rr'), [chartData]);

  const refLow = toPressureDisplay(RECOMMENDED_RANGE_BAR.low);
  const refHigh = toPressureDisplay(RECOMMENDED_RANGE_BAR.high);

  const formatPressure = (val: number | null): string =>
    val != null ? fmtNumber(val, 1) : '—';

  const stats: ChartSummaryStat[] = hasData
    ? [
        { label: t('widget.tirePressureHistory.fl', 'FL'), value: formatPressure(latestFL), unit: pressureUnit },
        { label: t('widget.tirePressureHistory.fr', 'FR'), value: formatPressure(latestFR), unit: pressureUnit },
        { label: t('widget.tirePressureHistory.rl', 'RL'), value: formatPressure(latestRL), unit: pressureUnit },
        { label: t('widget.tirePressureHistory.rr', 'RR'), value: formatPressure(latestRR), unit: pressureUnit },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  const chart = (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={chartMargin} {...chartAnimation}>
        {chartGrid}
        <XAxis
          dataKey="time"
          tick={tick}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatTime}
        />
        <YAxis
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={35}
          tickFormatter={(v: number) => `${fmt(v, 1)}`}
        />
        <Tooltip
          contentStyle={{
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={formatTime}
          formatter={(value: number, name: string) => {
            const labels: Record<string, string> = {
              fl: t('widget.tirePressureHistory.fl', 'FL'),
              fr: t('widget.tirePressureHistory.fr', 'FR'),
              rl: t('widget.tirePressureHistory.rl', 'RL'),
              rr: t('widget.tirePressureHistory.rr', 'RR'),
            };
            return [`${fmtNumber(value, 1)} ${pressureUnit}`, labels[name] ?? name];
          }}
        />
        <ReferenceLine
          y={refLow}
          stroke="rgba(34,197,94,0.35)"
          strokeDasharray="4 4"
          label={{ value: t('widget.tirePressureHistory.min', 'Min'), fill: 'rgba(34,197,94,0.5)', fontSize: 10, position: 'insideTopLeft' }}
        />
        <ReferenceLine
          y={refHigh}
          stroke="rgba(34,197,94,0.35)"
          strokeDasharray="4 4"
          label={{ value: t('widget.tirePressureHistory.max', 'Max'), fill: 'rgba(34,197,94,0.5)', fontSize: 10, position: 'insideBottomLeft' }}
        />
        <Line type="monotone" dataKey="fl" stroke={TIRE_COLORS.fl} strokeWidth={2} dot={false} connectNulls name="fl" />
        <Line type="monotone" dataKey="fr" stroke={TIRE_COLORS.fr} strokeWidth={2} dot={false} connectNulls name="fr" />
        <Line type="monotone" dataKey="rl" stroke={TIRE_COLORS.rl} strokeWidth={2} dot={false} connectNulls name="rl" />
        <Line type="monotone" dataKey="rr" stroke={TIRE_COLORS.rr} strokeWidth={2} dot={false} connectNulls name="rr" />
      </LineChart>
    </ResponsiveContainer>
  );

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.tirePressureHistory.noData', 'No tire pressure history')}
          emptyIcon={<CircleDot className="h-5 w-5" />}
          stats={stats}
          chart={null}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.tirePressureHistory.title', 'Tire Pressure History')}
      icon={<CircleDot className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.tirePressureHistory.noData', 'No tire pressure history')}
        emptyIcon={<CircleDot className="h-5 w-5" />}
        stats={stats}
        chart={chart}
      />
    </WidgetShell>
  );
}
