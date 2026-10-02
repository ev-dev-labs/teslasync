import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
  ChartTooltip, EmbeddedChart,
  type ChartDataRow,
} from '@/components/charts';
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

/** Classify a charging session into a charger-type bucket for color-coding. */
export function classifyChargerType(session: ChargingSession): string {
  const ft = (session.charger_type ?? '').toLowerCase();

  if (ft.includes('supercharger') || ft.includes('tesla')) return 'supercharger';
  if (ft && ft !== '<invalid>' && ft !== '') return 'dc';
  return 'home';
}

const CHARGER_TYPE_LABEL: Record<string, string> = {
  home: 'Home / AC',
  supercharger: 'Supercharger',
  dc: 'DC fast',
};

interface ChartDatum extends ChartDataRow {
  label: string;
  energy: number | null;
  type: string;
}

export default function ChargeSessionChartWidget({ vehicleId, size }: WidgetProps) {
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

  const stats: ChartSummaryStat[] = useMemo(() => {
    if (!hasData) return [];
    const total = sumKnown(chartData.map(d => d.energy));
    const avg = averageKnown(chartData.map(d => d.energy));
    return [
      { label: t('widget.chargeSessionChart.total', 'Total'), value: total == null ? null : fmt(total, 1), unit: unitPrefs.energy },
      { label: t('widget.chargeSessionChart.avg', 'Avg'), value: avg == null ? null : fmt(avg, 1), unit: unitPrefs.energy },
      { label: t('widget.chargeSessionChart.sessions', 'Sessions'), value: String(chartData.length) },
    ];
  }, [chartData, hasData, t, unitPrefs.energy]);

  if (isCompact) {
    return (
      <WidgetShell
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
                <BarChart data={chartData} margin={chartMargin} {...chartAnimation}>
                  {chartGrid}
                  <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={tick}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    tickFormatter={(v: number) => `${fmt(v, 0)}`}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    formatter={(value: number, _name: string, props: { payload?: ChartDatum }) => [
                      `${fmt(value, 1)} ${unitPrefs.energy}`,
                      t(`widget.chargeSessionChart.type.${props.payload?.type ?? ''}`, CHARGER_TYPE_LABEL[props.payload?.type ?? ''] ?? props.payload?.type ?? ''),
                    ]}
                    labelFormatter={(label: string) => label}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <Bar dataKey="energy" radius={[4, 4, 0, 0]} maxBarSize={32}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={CHARGER_COLORS[d.type] ?? '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </EmbeddedChart>

            {/* Legend */}
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-1">
              {(['home', 'supercharger', 'dc'] as const).map((type) => (
                <div key={type} className="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: CHARGER_COLORS[type] }}
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
