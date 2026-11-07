import { useCallback, useMemo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer,
  Tooltip,
  chartGrid, axisTickSm, useThemeChartPalette,
  AREA_DEFAULTS, areaGradient,
  EmbeddedChart,
  useMeasuredAxisWidth,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { Caption } from '@/components/ui';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useBatteryDegradation } from '@/api/hooks/useEnergy';

import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateLabels } from '@/hooks/useDateLabels';

export default function BatteryDegradationTrendWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const { unitPrefs } = useUnits();
  const { formatMonthYear } = useDateLabels('vehicle');
  const distanceUnit = unitPrefs.distance;
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const query = useBatteryDegradation(idStr);
  const { data, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const trust = useDataState(query, { provenance: 'historical' });
  const gradientId = `degradation-${useId().replace(/:/g, '')}`;
  const { reduce } = useMotionPreference();

  // Range fields arrive in kilometres; lift to SI metres once, then convert
  // to the user's distance preference for display (never fabricate: a
  // missing reading stays missing, a measured 0 stays 0).
  const toDisplayRange = useCallback(
    (km: number | null) => (km != null ? convertDistanceFromSI(km * 1000, distanceUnit) : null),
    [distanceUnit],
  );

  const chartData = useMemo(() => {
    const trend = data?.monthly_trend ?? [];
    return trend.map((entry) => ({
      month: (() => {
        const raw = entry.month ?? '';
        if (!raw || /^[A-Za-z]{3}(?:\s+\d{4})?$/.test(raw)) return raw;
        return formatMonthYear(raw);
      })(),
      range: toDisplayRange(knownNumber(entry.avg_range)),
    }));
  }, [data, formatMonthYear, toDisplayRange]);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const rangeAxisLabels = useMemo(() => {
    const values = chartData.map(point => point.range).filter((value): value is number => value != null && Number.isFinite(value));
    return values.map(value => fmtInt(value));
  }, [chartData, fmtInt]);
  const rangeAxisWidth = useMeasuredAxisWidth({
    labels: rangeAxisLabels, fontSize: axisTickSm.fontSize, minWidth: 60, padding: 24, enabled: !isCompact,
  });

  const originalRangeKm = knownNumber(data?.monthly_trend?.[0]?.avg_range);
  const currentRangeKm = knownNumber(data?.current_range)
    ?? knownNumber(data?.monthly_trend?.[data.monthly_trend.length - 1]?.avg_range);
  const currentRange = toDisplayRange(currentRangeKm);
  const originalRange = toDisplayRange(originalRangeKm);
  const degradationPct = currentRangeKm != null && originalRangeKm != null && originalRangeKm > 0
    ? ((currentRangeKm - originalRangeKm) / originalRangeKm) * 100
    : null;
  const rangeChange = currentRange != null && originalRange != null ? currentRange - originalRange : null;
  const observations = chartData.filter(point => point.range != null && point.month);
  const period = observations.length > 0
    ? t('dashboardWidgets.battery.batteryDegradationTrend.period', 'Observed {{start}} – {{end}}', {
      start: observations[0].month, end: observations[observations.length - 1].month,
    })
    : t('dashboardWidgets.battery.batteryDegradationTrend.periodUnknown', 'Observation period unavailable');

  // Series colour follows the active theme.
  const palette = useThemeChartPalette();

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const chart = (
    <EmbeddedChart
      title={t('widget.batteryDegradation', 'Battery degradation')}
      ariaLabel={t(
        'widget.batteryDegradationChart.aria',
        'Monthly max range trend',
      )}
      empty={chartData.filter((point) => point.range != null).length <= 1}
      emptyMessage={data ? t('widget.needMoreData', 'More data needed for trend') : t('widget.noDegradation', 'No degradation data')}
      data={chartData}
      dataColumns={[
        { key: 'month', label: t('widget.batteryDegradationChart.month', 'Month') },
        { key: 'range', label: t('widget.range', 'Range'), format: value => knownNumber(value) != null ? `${fmtInt(value)} ${distanceUnit}` : '—' },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          {areaGradient(gradientId, palette.series[1])}
          {chartGrid}
          <XAxis dataKey="month" {...axisTickSm} />
          <YAxis
            domain={['dataMin - 5', 'dataMax + 5']}
            tickFormatter={(v: number) => fmtInt(v)}
            {...axisTickSm}
            tick={axisTickSm}
            width={rangeAxisWidth}
          />
          <Tooltip content={<ChartTooltip />} />
          <Area
            {...AREA_DEFAULTS}
            dataKey="range"
            stroke={palette.series[1]}
            fill={`url(#${gradientId})`}
            connectNulls={false}
            isAnimationActive={!reduce}
            name={t('widget.range', 'Range')}
            unit={distanceUnit}
          />
        </AreaChart>
      </ResponsiveContainer>
    </EmbeddedChart>
  );

  const headlineProps = {
    value: currentRange != null ? Math.round(currentRange) : null,
    unit: distanceUnit,
    label: t('widget.batteryDegradationTrend.maxRange', 'Max range at 100%'),
    delta: degradationPct != null ? {
      text: `${degradationPct > 0 ? '+' : degradationPct < 0 ? '−' : ''}${fmtNumber(Math.abs(degradationPct), 1)}%`,
      tone: 'neutral' as const,
    } : undefined,
    animated: false,
  };
  const baseline = originalRange != null && degradationPct != null ? `${fmtInt(originalRange)} ${distanceUnit}` : null;
  const headline = <WidgetBigNumber {...headlineProps} subtitle={baseline != null
    ? t('widget.batteryDegradationTrend.sinceNew', 'since new ({{range}})', { range: baseline }) : undefined} />;
  const observedHeadline = <WidgetBigNumber {...headlineProps} subtitle={baseline != null
    ? t('dashboardWidgets.battery.batteryDegradationTrend.sinceObserved', 'since first observation ({{range}})', { range: baseline }) : undefined} />;
  const compactEmpty = isCompact && !data ? (
    <EmptyState message={t('widget.noDegradation', 'No degradation data')} icon={<TrendingDown className="h-5 w-5" />}
      action={{ label: t('common.refresh', 'Refresh'), onClick: handleRefresh }} />
  ) : null;
  const details = (
    <div className="space-y-2">
      {!isCompact && <WidgetStatGrid cols={2} stats={[
        { label: t('dashboardWidgets.battery.batteryDegradationTrend.firstObserved', 'First observed'), value: originalRange != null ? fmtInt(originalRange) : null, unit: distanceUnit },
        { label: t('dashboardWidgets.battery.batteryDegradationTrend.change', 'Change'), value: rangeChange != null ? `${rangeChange > 0 ? '+' : rangeChange < 0 ? '−' : ''}${fmtInt(Math.abs(rangeChange))}` : null, unit: distanceUnit },
      ]} />}
      <Caption as="p">{period}</Caption>
      <Caption as="p">{t('dashboardWidgets.battery.batteryDegradationTrend.estimateNote', 'Measured range estimates; the first observation is not factory capacity.')}</Caption>
      {compactEmpty}
    </div>
  );

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.batteryDegradation', 'Battery degradation')}
      icon={isCompact ? undefined : <TrendingDown className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={data != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <InstrumentPresentation family="line" compact={isCompact} headline={observedHeadline}
        icon={<TrendingDown />}
        instrument={!isCompact ? <div className="h-44 min-h-0 min-w-0">{chart}</div> : undefined}
        details={details}>
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <div className="shrink-0">{headline}</div>
          {!isCompact && <div className="mt-2 min-h-0 flex-1">{chart}</div>}
        </div>
        {compactEmpty}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
