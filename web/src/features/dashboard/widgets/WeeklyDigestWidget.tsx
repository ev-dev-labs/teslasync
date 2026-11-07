import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, EmbeddedChart, ChartTooltip, axisTick, chartGrid, useMeasuredAxisWidth } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { Caption } from '@/components/ui';
import { useWeeklyDigest } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { useCompareWindow } from '@/hooks/useCompareWindow';

import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import { WidgetBigNumber, WidgetComparisonCard, type ComparisonMetric } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertDistanceToSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

const unknownMetricValue = null as unknown as number;

function driveCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export default function WeeklyDigestWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { currentLabel, previousLabel, vsPreviousLabel } = useCompareWindow('week');
  const pack = usePackPresentation();
  const vehiclesQuery = useVehicles();
  const id = vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const idStr = id != null && Number.isSafeInteger(id) && id > 0 ? String(id) : '';

  const query = useWeeklyDigest(idStr);
  const source = idStr ? query : vehiclesQuery;
  const {
    isLoading, isFetching, isStale, isError, dataUpdatedAt, } = source;
  const data = idStr ? query.data : undefined;
  const digestState = useDataState(query, { provenance: 'historical' });
  const discoveryState = useDataState(vehiclesQuery);
  const dataState = idStr ? digestState : discoveryState;

  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const isCompact = size.cols <= 1;

  const metrics = useMemo((): ComparisonMetric[] => {
    if (!data) return [];

    const toDistance = (km: number) =>
      convertDistanceFromSI(convertDistanceToSI(km, 'km'), distanceUnit);
    const dist = toDistance(data.distanceKm ?? 0);
    const prevDist = toDistance(data.prevDistanceKm ?? 0);

    const kmPerDisplayUnit = convertDistanceFromSI(convertDistanceToSI(1, distanceUnit), 'km');
    const eff = (data.efficiency ?? 0) * kmPerDisplayUnit;
    const prevEff = (data.prevEfficiency ?? 0) * kmPerDisplayUnit;

    const energy = isFiniteNumber(data.energyWh) ? data.energyWh / 1000 : null;
    const prevEnergy = isFiniteNumber(data.prevEnergyWh) ? data.prevEnergyWh / 1000 : null;

    const drives = driveCount(data.drives);
    const prevDrives = driveCount(data.prevDrives);

    return [
      {
        label: t('widget.weeklyDigest.distance', 'Distance'),
        current: isFiniteNumber(data.distanceKm) ? dist : unknownMetricValue,
        previous: isFiniteNumber(data.prevDistanceKm) ? prevDist : unknownMetricValue,
        formattedCurrent: isFiniteNumber(data.distanceKm) ? fmtNumber(dist, 0) : '—',
        formattedPrevious: isFiniteNumber(data.prevDistanceKm) ? `${fmtNumber(prevDist, 0)} ${distanceUnit}` : undefined,
        unit: distanceUnit,
        higherIsBetter: true,
        tone: 'neutral',
        deltaDisplay: 'percent',
      },
      {
        label: t('widget.weeklyDigest.drives', 'Drives'),
        current: drives ?? unknownMetricValue,
        previous: prevDrives ?? unknownMetricValue,
        formattedCurrent: drives != null ? fmtInt(drives) : '—',
        formattedPrevious: prevDrives != null ? fmtInt(prevDrives) : undefined,
        higherIsBetter: true,
        tone: 'neutral',
        deltaDisplay: 'absolute',
      },
      {
        label: t('widget.weeklyDigest.energy', 'Energy'),
        current: energy ?? unknownMetricValue,
        previous: prevEnergy ?? unknownMetricValue,
        formattedCurrent: energy != null ? fmtNumber(energy, 1) : '—',
        formattedPrevious: prevEnergy != null ? `${fmtNumber(prevEnergy, 1)} kWh` : undefined,
        unit: 'kWh',
        higherIsBetter: true,
        tone: 'neutral',
        deltaDisplay: 'percent',
      },
      {
        label: t('widget.weeklyDigest.efficiency', 'Efficiency'),
        current: isFiniteNumber(data.efficiency) ? eff : unknownMetricValue,
        previous: isFiniteNumber(data.prevEfficiency) ? prevEff : unknownMetricValue,
        formattedCurrent: isFiniteNumber(data.efficiency) ? fmtNumber(eff, 0) : '—',
        formattedPrevious: isFiniteNumber(data.prevEfficiency) ? `${fmtNumber(prevEff, 0)} ${efficiencyUnit}` : undefined,
        unit: efficiencyUnit,
        higherIsBetter: false,
        tone: 'good',
        deltaDisplay: 'percent',
      },
    ];
  }, [data, distanceUnit, efficiencyUnit, t, fmtNumber, fmtInt]);

  const sourceMetrics: ComparisonMetric[] = metrics.length > 0 ? metrics : [
    { label: t('widget.weeklyDigest.distance', 'Distance'), current: unknownMetricValue, previous: unknownMetricValue, formattedCurrent: '—', unit: distanceUnit, higherIsBetter: true },
    { label: t('widget.weeklyDigest.drives', 'Drives'), current: unknownMetricValue, previous: unknownMetricValue, formattedCurrent: '—', higherIsBetter: true },
    { label: t('widget.weeklyDigest.energy', 'Energy'), current: unknownMetricValue, previous: unknownMetricValue, formattedCurrent: '—', unit: 'kWh', higherIsBetter: true },
    { label: t('widget.weeklyDigest.efficiency', 'Efficiency'), current: unknownMetricValue, previous: unknownMetricValue, formattedCurrent: '—', unit: efficiencyUnit, higherIsBetter: false },
  ];

  const handleRefresh = useCallback(() => {
    if (idStr) {
      void query.refetch();
    } else {
      void vehiclesQuery.refetch?.();
    }
  }, [idStr, query.refetch, vehiclesQuery.refetch]);

  const drives = driveCount(data?.drives);
  const chartData = [
    { period: previousLabel, drives: driveCount(data?.prevDrives) },
    { period: currentLabel, drives },
  ];
  const axisWidth = useMeasuredAxisWidth({
    labels: chartData.map(row => row.drives == null ? '—' : fmtInt(row.drives)),
    fontSize: 11, minWidth: 32, padding: 16, enabled: !isCompact,
  });
  const comparison = <WidgetComparisonCard metrics={sourceMetrics} compact={isCompact}
    previousLabel={previousLabel} emptyMessage={t('widget.weeklyDigest.noData', 'No weekly data yet')} />;
  const empty = <EmptyState /* no-action: transient empty state; refresh remains available in the source header */
    icon={<CalendarDays className="h-5 w-5" />}
    message={t('widget.weeklyDigest.noData', 'No weekly data yet')} className="py-4" />;

  return (
    <WidgetShell
      dataState={dataState.hasData || isLoading || source.isPending || dataState.fatalError || dataState.isRefreshBlocked ? dataState : undefined}
      title={t('widget.weeklyDigest.title', 'This week')}
      icon={isCompact ? undefined : <CalendarDays className="h-3.5 w-3.5 text-theme-accent" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <InstrumentPresentation family="bars" compact={isCompact} icon={isCompact ? undefined : <CalendarDays />}
        headline={isCompact ? undefined : <WidgetBigNumber value={drives == null ? null : fmtInt(drives)}
          unit={t('widget.weeklyDigest.drives', 'Drives')} animated={false} />}
        context={isCompact ? (!data && !isLoading ? empty : undefined) : <Caption>{vsPreviousLabel}</Caption>}
        details={comparison}
        instrument={isCompact ? undefined : (
          <EmbeddedChart title={t('widget.weeklyDigest.drives', 'Drives')} fluid={false} size="compact"
            ariaLabel={t('dashboardWidgets.analytics.weeklyDigest.chartLabel', 'Drives this week compared with last week')}
            empty={chartData.every(row => row.drives == null)}
            emptyMessage={t('widget.weeklyDigest.noData', 'No weekly data yet')}
            data={chartData} dataColumns={[
              { key: 'period', label: t('dashboardWidgets.analytics.weeklyDigest.period', 'Period') },
              { key: 'drives', label: t('widget.weeklyDigest.drives', 'Drives'), kind: 'count' },
            ]}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 24, right: 12, bottom: 0, left: 0 }}>
                {chartGrid}
                <XAxis dataKey="period" tick={axisTick} tickLine={false} axisLine={false} interval={0} />
                <YAxis tick={axisTick} width={axisWidth} tickLine={false} axisLine={false} domain={[0, 'auto']}
                  allowDecimals={false} tickFormatter={value => fmtInt(value)} />
                <Tooltip content={<ChartTooltip precision={0} />} cursor={{ fill: chartTokens.gridStroke }} />
                <Bar dataKey="drives" name={t('widget.weeklyDigest.drives', 'Drives')}
                  fill={chartTokens.series[0]} maxBarSize={44} radius={pack === 'v7' ? 0 : [4, 4, 0, 0]}
                  label={{ position: 'top', fill: chartTokens.axisStroke,
                    formatter: (value: unknown) => isFiniteNumber(value) ? fmtInt(value) : '—' }}
                  isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        )}>
        {data && metrics.length > 0 ? comparison : !isLoading ? empty : null}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
