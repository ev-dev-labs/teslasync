import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import { CHARGER_COLORS } from '@/lib/colors';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { ChargingSession } from '@/api/types';

/** Classify a charging session into a charger-type bucket for color-coding. */
function classifyChargerType(session: ChargingSession): string {
  const ft = (session.fast_charger_type ?? '').toLowerCase();
  const cable = (session.conn_charge_cable ?? '').toLowerCase();

  if (ft.includes('supercharger') || ft.includes('tesla')) return 'supercharger';
  if (ft && ft !== '<invalid>' && ft !== '') return 'dc';
  if (cable.includes('sae') || cable.includes('ccs') || cable.includes('chademo')) return 'dc';
  return 'home';
}

const CHARGER_TYPE_LABEL: Record<string, string> = {
  home: 'Home / AC',
  supercharger: 'Supercharger',
  dc: 'DC Fast',
};

interface ChartDatum {
  label: string;
  energy: number;
  type: string;
}

export default function ChargeSessionChartWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { data: sessions, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['charging', id, 'session-chart-10'],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${id}&limit=10`),
    enabled: id > 0,
    staleTime: 60_000,
  });

  const chartData = useMemo<ChartDatum[]>(() =>
    (sessions ?? [])
      .map((s, i) => ({
        label: s.start_date
          ? new Date(s.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : `#${i + 1}`,
        energy: s.charge_energy_added ?? 0,
        type: classifyChargerType(s),
      }))
      .reverse(),
    [sessions],
  );

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const showYAxis = !isCompact;
  const tick = isWide ? axisTick : axisTickSm;

  // Compact: show single summary metric
  if (isCompact) {
    const totalEnergy = chartData.reduce((sum, d) => sum + d.energy, 0);
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
        <div className="h-full flex flex-col items-center justify-center gap-0.5">
          <span className="text-2xl font-bold text-white/90">{fmt(totalEnergy, 1)}</span>
          <span className="text-[10px] text-white/40 uppercase tracking-wider">
            {t('widget.chargeSessionChart.unitKwh', 'kWh')}
          </span>
        </div>
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
      {chartData.length > 0 ? (
        <div className="h-full w-full px-2 pb-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} />
              {showYAxis && (
                <YAxis
                  tick={tick}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v: number) => `${fmt(v, 0)}`}
                />
              )}
              <Tooltip
                contentStyle={{
                  background: 'rgba(0,0,0,0.85)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
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

          {/* Legend */}
          <div className="flex items-center justify-center gap-3 pb-1">
            {(['home', 'supercharger', 'dc'] as const).map((type) => (
              <div key={type} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: CHARGER_COLORS[type] }}
                />
                <span className="text-[10px] text-white/50">
                  {t(`widget.chargeSessionChart.type.${type}`, CHARGER_TYPE_LABEL[type])}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.chargeSessionChart.empty', 'No charge sessions yet')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
