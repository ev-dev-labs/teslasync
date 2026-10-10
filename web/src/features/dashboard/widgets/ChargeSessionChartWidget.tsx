import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartTooltip, EmbeddedChart, useMeasuredAxisWidth, type ChartDataRow } from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import { averageKnown, deriveDataState, knownNumber, sumKnown } from '@/api/dataState';
import { CHARGER_COLORS } from '@/lib/colors';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { ChargingSession } from '@/api/types';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';
import { dashboardTokens } from '../lib/dashboardTokens';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { classifyChargingSource } from '@/lib/chargerKind';
import { chartTokens } from '@/lib/tokens';

type ChartChargerType = 'home' | 'supercharger' | 'dc' | 'unknown';

/** Classify a charging session into a charger-type bucket for color-coding. */
export function classifyChargerType(session: ChargingSession): ChartChargerType {
  const kind = classifyChargingSource(session.charger_type);
  return kind === 'acHome' ? 'home' : kind === 'dcFast' ? 'dc' : kind;
}

const CHARGER_TYPE_LABEL: Record<ChartChargerType, string> = {
  home: 'Home / AC',
  supercharger: 'Supercharger',
  dc: 'DC fast',
  unknown: 'Unknown',
};

interface ChartDatum extends ChartDataRow {
  label: string;
  energy: number | null;
  type: ChartChargerType;
}

export default function ChargeSessionChartWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { formatDateShort } = useDateFormat();
  const { unitPrefs } = useUnits();

  const query = useQuery({
    queryKey: ['charging', id, 'session-chart-10'],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${id}&limit=10`),
    enabled: id > 0,
    staleTime: 60_000,
  });
  const { data: sessions, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;

  const chartData = useMemo<ChartDatum[]>(() =>
    (sessions ?? [])
      .map((s, i) => ({
        label: s.started_at
          ? formatDateShort(s.started_at)
          : `#${i + 1}`,
        energy: knownNumber(s.total_energy_added_wh) == null ? null : convertEnergyFromSI(s.total_energy_added_wh, unitPrefs.energy),
        type: classifyChargerType(s),
      }))
      .reverse(),
    [sessions, formatDateShort, unitPrefs.energy],
  );

  const hasData = chartData.length > 0;
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
    const avg = averageKnown(chartData.map(d => d.energy));
    return [
      { label: t('widget.chargeSessionChart.total', 'Total'), value: total == null ? null : fmt(total), unit: unitPrefs.energy },
      { label: t('widget.chargeSessionChart.avg', 'Avg'), value: avg == null ? null : fmt(avg), unit: unitPrefs.energy },
      { label: t('widget.chargeSessionChart.sessions', 'Sessions'), value: String(chartData.length) },
    ];
  }, [chartData, hasData, t, unitPrefs.energy, fmt]);

  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.chargeSessionChart.title', 'Charge sessions')}
        loading={isLoading && !sessions}
        error={!sessions && error ? String(error) : null}
        dataState={sessions ? deriveDataState(query, { provenance: 'historical', partial: chartData.some(d => d.energy == null) }) : undefined}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.chargeSessionChart.empty', 'No charge sessions yet')}
          emptyIcon={<Zap className="h-5 w-5" />}
          stats={stats}
          chart={null}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.chargeSessionChart.title', 'Charge sessions')}
      icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading && !sessions}
      error={!sessions && error ? String(error) : null}
      dataState={sessions ? deriveDataState(query, { provenance: 'historical', partial: chartData.some(d => d.energy == null) }) : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      noPadding
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.chargeSessionChart.empty', 'No charge sessions yet')}
        emptyIcon={<Zap className="h-5 w-5" />}
        stats={stats}
        chart={
          <div className="flex h-full w-full flex-col px-2 pb-1">
            <EmbeddedChart
              title={t('widget.chargeSessionChart.title', 'Charge sessions')}
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
                      t(`widget.chargeSessionChart.type.${props.payload?.type ?? 'unknown'}`, CHARGER_TYPE_LABEL[props.payload?.type ?? 'unknown']),
                    ]}
                    labelFormatter={(label: string) => label}
                    cursor={{ fill: chartTokens.gridStroke }}
                  />
                  <Bar dataKey="energy" radius={[4, 4, 0, 0]} maxBarSize={32}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={CHARGER_COLORS[d.type] ?? CHARGER_COLORS.Other} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </EmbeddedChart>

            {/* Legend */}
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-1">
              {(['home', 'supercharger', 'dc', 'unknown'] as const)
                .filter(type => type !== 'unknown' || chartData.some(point => point.type === 'unknown'))
                .map((type) => (
                <div key={type} className="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: CHARGER_COLORS[type] ?? CHARGER_COLORS.Other }}
                  />
                  <span className={dashboardTokens.metricLabel}>
                    {t(`widget.chargeSessionChart.type.${type}`, CHARGER_TYPE_LABEL[type])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        }
      />
    </WidgetShell>
  );
}
