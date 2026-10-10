import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { AreaChartWrapper } from '@/components/charts';
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

  const stats: ChartSummaryStat[] = useMemo(() => {
    if (!hasData) return [];
    const total = sumKnown(chartData.map(d => d.energy));
    const avg = averageKnown(chartData.map(d => d.energy));
    return [
      { label: t('widget.chargeHistory.total', 'Total'), value: total == null ? null : fmt(total), unit: unitPrefs.energy },
      { label: t('widget.chargeHistory.avg', 'Avg'), value: avg == null ? null : fmt(avg), unit: unitPrefs.energy },
    ];
  }, [chartData, hasData, t, unitPrefs.energy, fmt]);

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
      icon={<BarChart3 className="h-3.5 w-3.5 text-emerald-300" />}
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
        chart={
          <AreaChartWrapper
            data={chartData}
            xKey="started_at"
            xFormatter={(value) => formatDateTime(value)}
            series={[{ key: 'energy', label: unitPrefs.energy, color: '#10b981' }]}
            height={200}
            yFormatter={(v) => `${v} ${unitPrefs.energy}`}
            ariaLabel={t(
              'widget.chargeHistory.chartLabel',
              'Energy added per recent charge session, in kilowatt-hours',
            )}
          />
        }
      />
    </WidgetShell>
  );
}
