import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt, safe,
  ChartTooltip, EmbeddedChart,
  type ChartDataRow,
} from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import { CHARGER_COLORS } from '@/lib/colors';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { ChargingSession } from '@/api/types';
import { convertEnergyFromSI } from '@/lib/unitConversion';

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
  dc: 'DC Fast',
};

interface ChartDatum extends ChartDataRow {
  label: string;
  energy: number;
  type: string;
}

export default function ChargeSessionChartWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { formatDateShort } = useDateFormat();

  const { data: sessions, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['charging', id, 'session-chart-10'],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${id}&limit=10`),
    enabled: id > 0,
    staleTime: 60_000,
  });

  const chartData = useMemo<ChartDatum[]>(() =>
    (sessions ?? [])
      .map((s, i) => ({
        label: s.started_at
          ? formatDateShort(s.started_at)
          : `#${i + 1}`,
        energy: safe(convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh')),
        type: classifyChargerType(s),
      }))
      .reverse(),
    [sessions, formatDateShort],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const tick = isWide ? axisTick : axisTickSm;

  const stats: ChartSummaryStat[] = useMemo(() => {
    if (!hasData) return [];
    const total = chartData.reduce((sum, d) => sum + d.energy, 0);
    const avg = total / chartData.length;
    return [
      { label: t('widget.chargeSessionChart.total', 'Total'), value: fmt(total, 1), unit: 'kWh' },
      { label: t('widget.chargeSessionChart.avg', 'Avg'), value: fmt(avg, 1), unit: 'kWh' },
      { label: t('widget.chargeSessionChart.sessions', 'Sessions'), value: String(chartData.length) },
    ];
  }, [chartData, hasData, t]);

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
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
      title={t('widget.chargeSessionChart.title', 'Charge Sessions')}
      icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
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
              title={t('widget.chargeSessionChart.title', 'Charge Sessions')}
              ariaLabel={t(
                'widget.chargeSessionChart.chartLabel',
                'Bar chart of energy added per charge session',
              )}
              data={chartData}
              dataColumns={[
                { key: 'label', label: t('widget.chargeSessionChart.session', 'Session') },
                { key: 'energy', label: t('widget.chargeSessionChart.energyKwh', 'Energy (kWh)') },
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
                      `${fmt(value, 1)} kWh`,
                      CHARGER_TYPE_LABEL[props.payload?.type ?? ''] ?? props.payload?.type ?? '',
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
            <div className="flex items-center justify-center gap-3 pb-1">
              {(['home', 'supercharger', 'dc'] as const).map((type) => (
                <div key={type} className="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: CHARGER_COLORS[type] }}
                  />
                  <span className="text-2xs text-[var(--text-secondary)]">
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
