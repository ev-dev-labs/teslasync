import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDot } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartTooltip, ChartLegend, EmbeddedChart, useMeasuredAxisWidth, type ChartDataRow } from '@/components/charts';
import { useTirePressureAnalysisHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePressureFormat } from '@/hooks/usePressureFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useRangeState } from '@/hooks/useRangeState';
import { Caption, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { WidgetBigNumber, WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { PASCALS_PER_KPA } from '@/lib/unitConversion';
import { isFiniteNumber } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/components/charts';

/**
 * Physical recommendation in kPa; usePressureFormat consumes canonical Pa.
 * 240–280 kPa ≈ 2.4–2.8 bar ≈ 35–41 psi.
 */
export const RECOMMENDED_RANGE_KPA = { low: 240, high: 280 } as const;

/** 1 bar = 100 kPa (BIPM); used only for the pathological null-converter fallback. */
const KPA_PER_BAR = 100;

const TIRE_COLORS = {
  fl: CHART_COLORS[1],
  fr: CHART_COLORS[2],
  rl: CHART_COLORS[3],
  rr: CHART_COLORS[4],
} as const;

export interface ChartDatum extends ChartDataRow {
  time: string;
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
}

export function buildChartData(
  data: unknown,
  toPressureValue: (pa: number | null | undefined) => number | null,
): ChartDatum[] {
  const items: unknown[] = Array.isArray(data) ? data : [];
  const toDisplayPressure = (value: unknown) => toPressureValue(isFiniteNumber(value) ? value : null);
  return items
    .filter((d): d is Record<string, unknown> & { created_at: string } =>
      d != null && typeof d === 'object' && 'created_at' in d &&
      typeof d.created_at === 'string' && Number.isFinite(Date.parse(d.created_at)))
    .map((d) => ({
      time: d.created_at,
      fl: toDisplayPressure(d.frontLeft),
      fr: toDisplayPressure(d.frontRight),
      rl: toDisplayPressure(d.rearLeft),
      rr: toDisplayPressure(d.rearRight),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function latestNonNull(
  data: ChartDatum[],
  key: 'fl' | 'fr' | 'rl' | 'rr',
): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i][key];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Bridge the physical kPa recommendation to the same Pa input as history rows
 * before applying the user's display preference.
 */
export function recommendedPressureRange(
  toPressureValue: (pa: number | null | undefined) => number | null,
): { low: number; high: number } {
  return {
    low: toPressureValue(RECOMMENDED_RANGE_KPA.low * PASCALS_PER_KPA) ?? RECOMMENDED_RANGE_KPA.low / KPA_PER_BAR,
    high: toPressureValue(RECOMMENDED_RANGE_KPA.high * PASCALS_PER_KPA) ?? RECOMMENDED_RANGE_KPA.high / KPA_PER_BAR,
  };
}

/** Format a converted pressure value to a single decimal, or an em-dash when absent. */
export default function TirePressureHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber: fmt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { pressureUnit, toPressureValue } = usePressureFormat();
  const { formatDateTime, formatDateShort } = useDateFormat();
  const { start, end, startInstant, endInstantExclusive, presetId } = useRangeState({ defaultPresetId: '30d' });

  const formatTime = useCallback((ts: string): string => formatDateTime(ts), [formatDateTime]);

  const query = useTirePressureAnalysisHistory(
    vid > 0 ? String(vid) : '',
    30,
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
  const dataState = useDataState({
    ...query,
    data: query.isError && (!Array.isArray(data) || data.length === 0) ? undefined : !isLoading && !query.isPending ? data ?? null : data,
  }, { provenance: 'historical' });

  const chartData = useMemo(
    () => buildChartData(data, toPressureValue),
    [data, toPressureValue],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const { low: refLow, high: refHigh } = useMemo(
    () => recommendedPressureRange(toPressureValue),
    [toPressureValue],
  );
  const axisLabels = useMemo(
    () => [0, refLow, refHigh, ...chartData.flatMap((entry) => [entry.fl, entry.fr, entry.rl, entry.rr])]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((value) => `${fmt(value)}`),
    [chartData, refLow, refHigh, fmt],
  );
  const axisWidth = useMeasuredAxisWidth({
    labels: axisLabels, fontSize: isWide ? 11 : 10, minWidth: 35, padding: 20, enabled: !isCompact,
  });

  const latestFL = latestNonNull(chartData, 'fl');
  const latestFR = latestNonNull(chartData, 'fr');
  const latestRL = latestNonNull(chartData, 'rl');
  const latestRR = latestNonNull(chartData, 'rr');
  const stats: ChartSummaryStat[] = isCompact && hasData ? [
    { label: t('widget.tirePressureHistory.fl', 'FL'), value: fmtNumber(latestFL) === '—' ? null : fmtNumber(latestFL), unit: pressureUnit },
    { label: t('widget.tirePressureHistory.fr', 'FR'), value: fmtNumber(latestFR) === '—' ? null : fmtNumber(latestFR), unit: pressureUnit },
    { label: t('widget.tirePressureHistory.rl', 'RL'), value: fmtNumber(latestRL) === '—' ? null : fmtNumber(latestRL), unit: pressureUnit },
    { label: t('widget.tirePressureHistory.rr', 'RR'), value: fmtNumber(latestRR) === '—' ? null : fmtNumber(latestRR), unit: pressureUnit },
  ] : [];

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const tick = isWide ? axisTick : axisTickSm;
  const rangeLabel = presetId === '30d'
    ? t('date.preset.last30', 'Last 30 days')
    : presetId
      ? t(`date.preset.${presetId}`, presetId)
      : `${formatDateShort(`${start}T00:00:00`)} – ${formatDateShort(`${end}T00:00:00`)}`;

  const renderChart = (showClassicReference: boolean) => (
    <EmbeddedChart
      title={t('widget.tirePressureHistory.title', 'Tire pressure history')}
      height={showClassicReference ? undefined : 240}
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
          <LineChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
        {chartGrid}
        {showClassicReference && <ReferenceArea
          y1={refLow}
          y2={refHigh}
          fill="var(--ok)"
          fillOpacity={0.12}
        />}
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
          width={axisWidth}
          tickFormatter={(v: number) => `${fmt(v)}`}
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
            return [`${fmtNumber(value)} ${pressureUnit}`, labels[name] ?? name];
          }}
        />
        <ChartLegend />
        <Line type="monotone" dataKey="fl" stroke={TIRE_COLORS.fl} strokeWidth={2} dot={false} connectNulls={false} name="fl" hide={hiddenSeries?.isHidden('fl')} />
        <Line type="monotone" dataKey="fr" stroke={TIRE_COLORS.fr} strokeWidth={2} dot={false} connectNulls={false} name="fr" hide={hiddenSeries?.isHidden('fr')} />
        <Line type="monotone" dataKey="rl" stroke={TIRE_COLORS.rl} strokeWidth={2} dot={false} connectNulls={false} name="rl" hide={hiddenSeries?.isHidden('rl')} />
        <Line type="monotone" dataKey="rr" stroke={TIRE_COLORS.rr} strokeWidth={2} dot={false} connectNulls={false} name="rr" hide={hiddenSeries?.isHidden('rr')} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </EmbeddedChart>
  );
  const chart = renderChart(true);
  const tires = [
    { key: 'fl', value: latestFL, label: t('widget.tirePressureHistory.fl', 'FL') },
    { key: 'fr', value: latestFR, label: t('widget.tirePressureHistory.fr', 'FR') },
    { key: 'rl', value: latestRL, label: t('widget.tirePressureHistory.rl', 'RL') },
    { key: 'rr', value: latestRR, label: t('widget.tirePressureHistory.rr', 'RR') },
  ] as const;
  const lastReported = (key: typeof tires[number]['key']) => {
    const sample = [...chartData].reverse().find(row => isFiniteNumber(row[key]));
    return sample
      ? t('dashboardWidgets.tires.tirePressureHistory.lastReported', 'Last reported {{time}}', { time: formatTime(sample.time) })
      : t('dashboardWidgets.tires.tirePressureHistory.notReported', 'Not reported');
  };
  const presentation = {
    family: 'line' as const,
    compact: isCompact,
    icon: <CircleDot />,
    context: <Caption>{rangeLabel} · {pressureUnit}</Caption>,
    headline: <WidgetBigNumber value={latestFL == null ? null : fmtNumber(latestFL)} unit={pressureUnit}
      label={t('dashboardWidgets.tires.tirePressureHistory.frontLeftPressure', 'Front-left pressure')}
      subtitle={lastReported('fl')} animated={false}
      badge={{ text: t('dashboardWidgets.tires.tirePressureHistory.history', 'History'), variant: 'neutral' }} />,
    details: (
      <div className="grid min-w-0 grid-cols-1 gap-3 @xs:grid-cols-2">
        {tires.slice(1).map(tire => (
          <WidgetBigNumber key={tire.key} value={tire.value == null ? null : fmtNumber(tire.value)}
            unit={pressureUnit} label={tire.label} subtitle={lastReported(tire.key)}
            animated={false} size="secondary" />
        ))}
        <div className="flex min-w-0 flex-col justify-center gap-2">
          <Caption>{t('widget.tirePressureHistory.recommended', 'Recommended')}</Caption>
          <Text variant="bodySm">{t('dashboardWidgets.tires.tirePressureHistory.recommendationUnavailable', 'Unavailable')}</Text>
        </div>
      </div>
    ),
    // History supplies no vehicle-specific recommendation; keep the legacy band
    // only in the unchanged Classic body, never present it as a measured target.
    instrument: isCompact ? (!hasData && (
      <EmptyState variant="informational" icon={<CircleDot className="h-5 w-5" />}
        message={t('widget.tirePressureHistory.noData', 'No tire pressure history')} />
    )) : (
      <WidgetChartSummary stats={[]} chart={renderChart(false)} isEmpty={!hasData}
        emptyMessage={t('widget.tirePressureHistory.noData', 'No tire pressure history')}
        emptyIcon={<CircleDot className="h-5 w-5" />}
        yAxisLabel={`${rangeLabel} · ${pressureUnit}`}
        legend={tires.map(tire => ({ label: tire.label, color: TIRE_COLORS[tire.key] }))} />
    ),
  };

  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.tirePressureHistory.title', 'Tire pressure history')}
        loading={isLoading}
        dataState={dataState}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        <InstrumentPresentation {...presentation}>
          <WidgetChartSummary
            compact
            isEmpty={!hasData}
            emptyMessage={t('widget.tirePressureHistory.noData', 'No tire pressure history')}
            emptyIcon={<CircleDot className="h-5 w-5" />}
            stats={stats}
            chart={null}
          />
        </InstrumentPresentation>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.tirePressureHistory.title', 'Tire pressure history')}
      icon={<CircleDot className="h-3.5 w-3.5 text-theme-accent" />}
      loading={isLoading}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <InstrumentPresentation {...presentation}>
        <WidgetChartSummary
          isEmpty={!hasData}
          emptyMessage={t('widget.tirePressureHistory.noData', 'No tire pressure history')}
          emptyIcon={<CircleDot className="h-5 w-5" />}
          stats={stats}
          yAxisLabel={`${rangeLabel} · ${pressureUnit}`}
          legend={[
            { label: t('widget.tirePressureHistory.fl', 'FL'), color: TIRE_COLORS.fl },
            { label: t('widget.tirePressureHistory.fr', 'FR'), color: TIRE_COLORS.fr },
            { label: t('widget.tirePressureHistory.rl', 'RL'), color: TIRE_COLORS.rl },
            { label: t('widget.tirePressureHistory.rr', 'RR'), color: TIRE_COLORS.rr },
            { label: t('widget.tirePressureHistory.recommended', 'Recommended'), color: 'color-mix(in srgb, var(--ok) 25%, transparent)' },
          ]}
          chart={chart}
        />
      </InstrumentPresentation>
    </WidgetShell>
  );
}
