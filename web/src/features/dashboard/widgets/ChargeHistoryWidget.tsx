import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import {
  Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  ChartTooltip, EmbeddedChart, axisTickSm, chartAnimation, chartGrid, chartMargin,
  useMeasuredAxisWidth, useThemeChartPalette,
} from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import { averageKnown, deriveDataState, knownNumber, sumKnown } from '@/api/dataState';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { ChargingSession } from '../types';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';

export default function ChargeHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const { data: vehicles } = vehiclesQuery;
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const { formatDateTime } = useDateFormat();
  const palette = useThemeChartPalette();

  const query = useQuery({
    queryKey: ['charging', id, 'recent-10'],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${id}&limit=10`),
    enabled: id > 0,
  });
  const { data: charges, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;

  const chartData = useMemo(
    () =>
      // The API returns newest-first; copy before reversing the cached rows.
      (charges ?? [])
        .slice()
        .reverse()
        .map((s) => ({
          started_at: s.started_at,
          energy: knownNumber(s.total_energy_added_wh) == null ? null : convertEnergyFromSI(s.total_energy_added_wh, unitPrefs.energy),
        })),
    [charges, unitPrefs.energy],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1;
  const sourceState = deriveDataState({
    ...query,
    data: charges ?? (isLoading || isError || error ? undefined : null),
  }, { provenance: 'historical', unavailable: !hasData, partial: chartData.some(d => d.energy == null) });
  const dataState = id > 0 ? sourceState : deriveDataState(vehiclesQuery);
  const handleRefresh = () => { if (id > 0) void refetch(); else void vehiclesQuery.refetch(); };

  const axisWidth = useMeasuredAxisWidth({
    labels: chartData.map(d => (d.energy == null ? '—' : `${fmt(d.energy)} ${unitPrefs.energy}`)),
    fontSize: 10, minWidth: 40, padding: 20, enabled: !isCompact,
  });

  // After card: one headline total over the session bars; Avg removed so
  // no value competes with the total. Measured zero stays zero, missing
  // stays null (sumKnown/averageKnown skip nulls).
  const stats: ChartSummaryStat[] = useMemo(() => {
    if (!hasData) return [];
    const total = sumKnown(chartData.map(d => d.energy));
    const avg = averageKnown(chartData.map(d => d.energy));
    return isCompact
      ? [
          { label: t('widget.chargeHistory.total', 'Total'), value: total == null ? null : fmt(total), unit: unitPrefs.energy },
          { label: t('widget.chargeHistory.avg', 'Avg'), value: avg == null ? null : fmt(avg), unit: unitPrefs.energy },
        ]
      : [
          { label: t('widget.chargeHistory.total', 'Total'), value: total == null ? null : fmt(total), unit: unitPrefs.energy },
        ];
  }, [chartData, hasData, t, unitPrefs.energy, fmt, isCompact]);

  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.chargeHistory.title', 'Charge history')}
        loading={isLoading && !charges}
        error={!charges && error ? String(error) : null}
        dataState={dataState}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.noChargeHistory', 'No charge sessions yet')}
          emptyIcon={<BarChart3 className="h-5 w-5" />}
          stats={stats}
          chart={null}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.chargeHistory.title', 'Charge history')}
      icon={<BarChart3 className="h-3.5 w-3.5" />}
      loading={isLoading && !charges}
      error={!charges && error ? String(error) : null}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.noChargeHistory', 'No charge sessions yet')}
        emptyIcon={<BarChart3 className="h-5 w-5" />}
        stats={stats}
        yAxisLabel={t('widget.chargeHistory.lastSessions', 'Last {{count}} sessions · {{unit}}', { count: chartData.length, unit: unitPrefs.energy })}
        chart={
          <EmbeddedChart
            title={t('widget.chargeHistory.title', 'Charge history')}
            ariaLabel={t(
              'widget.chargeHistory.chartLabel',
              'Energy added per recent charge session, in kilowatt-hours',
            )}
            data={chartData}
            dataColumns={[
              { key: 'started_at', label: t('widget.chargeHistory.title', 'Charge history'), format: (v) => formatDateTime(typeof v === 'string' ? v : null) },
              { key: 'energy', label: unitPrefs.energy, format: (v) => (knownNumber(v) == null ? '—' : `${fmt(knownNumber(v) as number)} ${unitPrefs.energy}`) },
            ]}
            className="h-full w-full"
            empty={!hasData}
            emptyMessage={t('widget.noChargeHistory', 'No charge sessions yet')}
          >
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="started_at" tick={axisTickSm} tickLine={false} axisLine={false} tickFormatter={(v: string) => formatDateTime(v)} />
                <YAxis tick={axisTickSm} tickLine={false} axisLine={false} width={axisWidth} tickFormatter={(v: number) => `${fmt(v)} ${unitPrefs.energy}`} />
                <Tooltip content={<ChartTooltip />} formatter={(value: number) => [knownNumber(value) == null ? '—' : `${fmt(value)} ${unitPrefs.energy}`, unitPrefs.energy]} cursor={{ fill: palette.neutral, fillOpacity: 0.08 }} />
                <Bar dataKey="energy" name={unitPrefs.energy} fill={palette.primary} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        }
      />
    </WidgetShell>
  );
}
