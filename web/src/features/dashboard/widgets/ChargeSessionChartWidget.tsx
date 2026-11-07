import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartTooltip, EmbeddedChart, useMeasuredAxisWidth, type ChartDataRow } from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDashboardChargingHistory } from '@/api/hooks/useCharging';
import { deriveDataState, knownNumber, sumKnown } from '@/api/dataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { Caption } from '@/components/ui';
import { WidgetBigNumber, WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import type { PackId } from './designPacks/types';
import type { WidgetProps } from './types';
import type { ChargingSession } from '@/api/types';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { classifyChargingSource } from '@/lib/chargerKind';
import { chartTokens } from '@/lib/tokens';
import { dashboardTokens } from '../lib/dashboardTokens';

type ChartChargerType = 'home' | 'ac' | 'supercharger' | 'dc' | 'unknown';

/** Classify a charging session into a charger-type bucket for color-coding. */
export function classifyChargerType(session: ChargingSession): ChartChargerType {
  const kind = classifyChargingSource(session);
  return kind === 'acHome' ? 'home' : kind === 'dcFast' ? 'dc' : kind;
}

const CHARGER_TYPE_LABEL: Record<ChartChargerType, string> = {
  home: 'Home / AC',
  ac: 'AC',
  supercharger: 'Supercharger',
  dc: 'DC fast',
  unknown: 'Unknown',
};

interface ChartDatum extends ChartDataRow {
  label: string;
  energy: number | null;
  type: ChartChargerType;
}

const CHARGER_SERIES: Record<ChartChargerType, string> = {
  home: dashboardTokens.chart.series[1],
  ac: dashboardTokens.chart.series[0],
  supercharger: dashboardTokens.chart.series[3],
  dc: dashboardTokens.chart.series[2],
  unknown: dashboardTokens.chart.series[4],
};

const BAR_RADII: Record<PackId, [number, number, number, number]> = {
  classic: [4, 4, 0, 0],
  v1: [7, 7, 3, 3],
  v2: [8, 8, 4, 4],
  v3: [6, 6, 2, 2],
  v4: [7, 7, 3, 3],
  v5: [4, 4, 0, 0],
  v6: [16, 16, 5, 5],
  v7: [2, 2, 0, 0],
};

export default function ChargeSessionChartWidget({ vehicleId, size, config }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const packId = usePackPresentation();
  const vehiclesQuery = useVehicles();
  const { data: vehicles } = vehiclesQuery;
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { formatDateShort } = useDateFormat();
  const { unitPrefs } = useUnits();

  const query = useDashboardChargingHistory(id, { kind: 'session-chart', range: config?.timeRange });
  const { data: sessions, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const handleRefresh = () => {
    if (id > 0) void refetch();
    else void vehiclesQuery.refetch();
  };

  const chartData = useMemo<ChartDatum[]>(() =>
    (sessions ?? [])
      .map((s) => ({
        label: s.started_at
          ? formatDateShort(s.started_at)
          : '—',
        energy: knownNumber(s.total_energy_added_wh) == null ? null : convertEnergyFromSI(s.total_energy_added_wh, unitPrefs.energy),
        type: classifyChargerType(s),
      }))
      .reverse(),
    [sessions, formatDateShort, unitPrefs.energy],
  );

  const hasData = chartData.length > 0;
  const dataState = sessions ? deriveDataState(query, {
    provenance: 'historical',
    partial: chartData.some(point => point.energy == null),
    unavailable: !hasData,
  }) : undefined;
  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const tick = isWide ? axisTick : axisTickSm;
  const energyAxisLabels = useMemo(() => [0, ...chartData.map(point => point.energy)
    .filter((value): value is number => value != null && Number.isFinite(value))]
    .map(value => `${fmt(value)}`), [chartData, fmt]);
  const energyAxisWidth = useMeasuredAxisWidth({
    labels: energyAxisLabels, fontSize: tick.fontSize, minWidth: 36, padding: 20, enabled: !isCompact,
  });

  const stats: ChartSummaryStat[] = useMemo(() => {
    if (!hasData) return [];
    const total = sumKnown(chartData.map(d => d.energy));
    return [
    { label: t('widget.chargeSessionChart.total', 'Total'), value: total == null ? null : fmt(total), unit: unitPrefs.energy },
    ];
  }, [chartData, hasData, t, unitPrefs.energy, fmt]);

  const sourceStats: ChartSummaryStat[] = useMemo(() => {
    const groups: { type: ChartChargerType; types: ChartChargerType[] }[] = [
      { type: 'home', types: ['home', 'ac'] },
      { type: 'dc', types: ['dc', 'supercharger'] },
      ...(chartData.some(point => point.type === 'unknown')
        ? [{ type: 'unknown' as const, types: ['unknown' as const] }] : []),
    ];
    return groups.map(({ type, types }) => {
      const points = chartData.filter(point => types.includes(point.type));
      const total = points.some(point => point.energy == null) ? null : sumKnown(points.map(point => point.energy));
      return {
        label: t(`widget.chargeSessionChart.type.${type}`, CHARGER_TYPE_LABEL[type]),
        value: total == null ? null : fmt(total),
        unit: unitPrefs.energy,
      };
    });
  }, [chartData, fmt, t, unitPrefs.energy]);
  const latest = chartData[chartData.length - 1];
  const compactBody = (
    <WidgetChartSummary
      compact
      isEmpty={!hasData}
      emptyMessage={t('widget.chargeSessionChart.empty', 'No charge sessions yet')}
      emptyIcon={<Zap className="h-5 w-5" />}
      stats={stats}
      chart={null}
    />
  );

  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.chargeSessionChart.title', 'Charge Session Chart')}
        loading={isLoading && !sessions}
        error={!sessions && error ? String(error) : null}
        dataState={dataState}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        <InstrumentPresentation family="bars" compact headline={compactBody} icon={<Zap />}>
          {compactBody}
        </InstrumentPresentation>
      </WidgetShell>
    );
  }

  const renderChartBody = (redesigned = false) => (
      <div className="min-h-0 flex-1 px-4 pb-3">
        <WidgetChartSummary
          isEmpty={!hasData}
          emptyMessage={t('widget.chargeSessionChart.empty', 'No charge sessions yet')}
          emptyIcon={<Zap className="h-5 w-5" />}
          stats={[]}
          yAxisLabel={t('widget.chargeSessionChart.energyPerSession', 'Energy per session · last {{count}}', { count: 20 })}
          legend={(['home', 'ac', 'supercharger', 'dc', 'unknown'] as const)
            .filter(type => type !== 'unknown' || chartData.some(point => point.type === 'unknown'))
            .map(type => ({
              label: type === 'ac' ? t('dashboard.chargerAc', 'AC') : t(`widget.chargeSessionChart.type.${type}`, CHARGER_TYPE_LABEL[type]),
              color: CHARGER_SERIES[type],
            }))}
          chart={
            <div className="flex h-full w-full flex-col px-2 pb-1">
              <EmbeddedChart
                title={t('widget.chargeSessionChart.title', 'Charge Session Chart')}
                ariaLabel={t(
                  'widget.chargeSessionChart.chartLabel',
                  'Bar chart of energy added per charge session',
                )}
                data={chartData}
                dataColumns={[
                  { key: 'label', label: t('widget.chargeSessionChart.session', 'Session') },
                  { key: 'energy', label: `${t('widget.energyAdded', 'Added')} (${unitPrefs.energy})` },
                  { key: 'type', label: t('widget.chargeSessionChart.chargerType', 'Charger type') },
                ]}
                className="min-h-0 flex-1"
                height={redesigned ? 220 : undefined}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
                    {chartGrid}
                    <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={tick}
                      tickLine={false}
                      axisLine={false}
                      width={energyAxisWidth}
                      tickFormatter={(v: number) => `${fmt(v)}`}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      formatter={(value: number, _name: string, props: { payload?: ChartDatum }) => [
                        `${fmt(value)} ${unitPrefs.energy}`,
                        props.payload?.type === 'ac' ? t('dashboard.chargerAc', 'AC') : t(`widget.chargeSessionChart.type.${props.payload?.type ?? 'unknown'}`, CHARGER_TYPE_LABEL[props.payload?.type ?? 'unknown']),
                      ]}
                      labelFormatter={(label: string) => label}
                      cursor={{ fill: chartTokens.gridStroke }}
                    />
                    <Bar dataKey="energy" radius={BAR_RADII[redesigned ? packId : 'classic']} maxBarSize={redesigned ? packId === 'v2' ? 46 : 42 : 32}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={CHARGER_SERIES[d.type]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            </div>
          }
        />
      </div>
  );

  return (
    <WidgetShell
      title={t('widget.chargeSessionChart.title', 'Charge Session Chart')}
      icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading && !sessions}
      error={!sessions && error ? String(error) : null}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
      noPadding
    >
      <InstrumentPresentation
        family="bars"
        icon={<Zap />}
        headline={<WidgetBigNumber
          value={latest?.energy == null ? null : fmt(latest.energy)}
          unit={unitPrefs.energy}
          label={t('dashboardWidgets.charging.chargeSessionChart.latestSession', 'Latest session')}
          subtitle={latest?.label}
          animated={false}
        />}
        instrument={renderChartBody(true)}
        details={<div className="space-y-2 px-4 pb-3">
          <Caption>{t('dashboardWidgets.charging.chargeSessionChart.byChargerType', 'Energy by charger type')}</Caption>
          <WidgetChartSummary compact stats={sourceStats} chart={null} />
        </div>}
      >
        {renderChartBody()}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
