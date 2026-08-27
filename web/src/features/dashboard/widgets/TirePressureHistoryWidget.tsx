import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDot } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
  ChartLegend, ChartTooltip, EmbeddedChart, type ChartDataRow,
} from '@/components/charts';
import { useTirePressureHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePressureFormat } from '@/hooks/usePressureFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/**
 * Recommended tire-pressure range expressed in SI kilopascals — the unit the
 * app-wide pressure converter (`toPressureValue` → `convertPressureFromSI`)
 * consumes. 240–280 kPa ≈ 2.4–2.8 bar ≈ 35–41 psi.
 */
export const RECOMMENDED_RANGE_KPA = { low: 240, high: 280 } as const;

/** 1 bar = 100 kPa (BIPM); used only for the pathological null-converter fallback. */
const KPA_PER_BAR = 100;

const TIRE_COLORS = {
  fl: '#3b82f6', // blue
  fr: '#06b6d4', // cyan
  rl: '#22c55e', // green
  rr: '#a855f7', // purple
} as const;

export interface ChartDatum extends ChartDataRow {
  time: string;
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
}

export function buildChartData(
  data: ReturnType<typeof useTirePressureHistory>['data'],
  toPressureValue: (kpa: number | null | undefined) => number | null,
): ChartDatum[] {
  const items = data ?? [];
  return items
    .filter((d) => d.timestamp)
    .map((d) => ({
      time: d.timestamp,
      fl: toPressureValue(d.frontLeft),
      fr: toPressureValue(d.frontRight),
      rl: toPressureValue(d.rearLeft),
      rr: toPressureValue(d.rearRight),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function latestNonNull(
  data: ChartDatum[],
  key: 'fl' | 'fr' | 'rl' | 'rr',
): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i][key];
    if (v != null) return v;
  }
  return null;
}

/**
 * Resolve the recommended-range reference lines in the user's display unit.
 * `toPressureValue` accepts SI kilopascals (the app-wide pressure contract),
 * so the range is expressed in kPa and converted here. Feeding the converter
 * Pascals instead (the previous `* 100_000`) placed the reference lines ~1000×
 * too high, off the plotted pressure domain.
 */
export function recommendedPressureRange(
  toPressureValue: (kpa: number | null | undefined) => number | null,
): { low: number; high: number } {
  return {
    low: toPressureValue(RECOMMENDED_RANGE_KPA.low) ?? RECOMMENDED_RANGE_KPA.low / KPA_PER_BAR,
    high: toPressureValue(RECOMMENDED_RANGE_KPA.high) ?? RECOMMENDED_RANGE_KPA.high / KPA_PER_BAR,
  };
}

/** Format a converted pressure value to a single decimal, or an em-dash when absent. */
function formatPressure(val: number | null): string {
  return val != null ? fmtNumber(val, 1) : '—';
}

export default function TirePressureHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { pressureUnit, toPressureValue } = usePressureFormat();
  const { formatDateTime } = useDateFormat();

  const formatTime = useCallback((ts: string): string => formatDateTime(ts), [formatDateTime]);

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
    () => buildChartData(data, toPressureValue),
    [data, toPressureValue],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const latestFL = useMemo(() => latestNonNull(chartData, 'fl'), [chartData]);
  const latestFR = useMemo(() => latestNonNull(chartData, 'fr'), [chartData]);
  const latestRL = useMemo(() => latestNonNull(chartData, 'rl'), [chartData]);
  const latestRR = useMemo(() => latestNonNull(chartData, 'rr'), [chartData]);

  const { low: refLow, high: refHigh } = useMemo(
    () => recommendedPressureRange(toPressureValue),
    [toPressureValue],
  );

  const stats = useMemo<ChartSummaryStat[]>(
    () =>
      hasData
        ? [
            { label: t('widget.tirePressureHistory.fl', 'FL'), value: formatPressure(latestFL), unit: pressureUnit },
            { label: t('widget.tirePressureHistory.fr', 'FR'), value: formatPressure(latestFR), unit: pressureUnit },
            { label: t('widget.tirePressureHistory.rl', 'RL'), value: formatPressure(latestRL), unit: pressureUnit },
            { label: t('widget.tirePressureHistory.rr', 'RR'), value: formatPressure(latestRR), unit: pressureUnit },
          ]
        : [],
    [hasData, latestFL, latestFR, latestRL, latestRR, pressureUnit, t],
  );

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const tick = isWide ? axisTick : axisTickSm;

  const chart = (
    <EmbeddedChart
      title={t('widget.tirePressureHistory.title', 'Tire Pressure History')}
      ariaLabel={t(
        'widget.tirePressureHistory.chartAria',
        'Front and rear tire pressure history',
      )}
      data={chartData}
      dataColumns={[
        { key: 'time', label: t('widget.tirePressureHistory.time', 'Time'), format: (value) => formatTime(String(value ?? '')) },
        { key: 'fl', label: `${t('widget.tirePressureHistory.fl', 'FL')} (${pressureUnit})` },
        { key: 'fr', label: `${t('widget.tirePressureHistory.fr', 'FR')} (${pressureUnit})` },
        { key: 'rl', label: `${t('widget.tirePressureHistory.rl', 'RL')} (${pressureUnit})` },
        { key: 'rr', label: `${t('widget.tirePressureHistory.rr', 'RR')} (${pressureUnit})` },
      ]}
      chartKey="dashboard-tire-pressure-history"
    >
      {({ hiddenSeries }) => (
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
          content={<ChartTooltip />}
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
        <ChartLegend />
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
        <Line type="monotone" dataKey="fl" stroke={TIRE_COLORS.fl} strokeWidth={2} dot={false} connectNulls={false} name="fl" hide={hiddenSeries?.isHidden('fl')} />
        <Line type="monotone" dataKey="fr" stroke={TIRE_COLORS.fr} strokeWidth={2} dot={false} connectNulls={false} name="fr" hide={hiddenSeries?.isHidden('fr')} />
        <Line type="monotone" dataKey="rl" stroke={TIRE_COLORS.rl} strokeWidth={2} dot={false} connectNulls={false} name="rl" hide={hiddenSeries?.isHidden('rl')} />
        <Line type="monotone" dataKey="rr" stroke={TIRE_COLORS.rr} strokeWidth={2} dot={false} connectNulls={false} name="rr" hide={hiddenSeries?.isHidden('rr')} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </EmbeddedChart>
  );

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
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
      onRefresh={handleRefresh}
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
