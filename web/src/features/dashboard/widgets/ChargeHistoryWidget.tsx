import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { AreaChartWrapper, fmt } from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { ChargingSession } from '../types';
import { convertEnergyFromSI } from '@/lib/unitConversion';

export default function ChargeHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { data: charges, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['charging', id, 'recent-10'],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${id}&limit=10`),
    enabled: id > 0,
  });

  const chartData = useMemo(
    () =>
      // Reverse first (the API returns newest-first) so the chart reads
      // oldest → newest left-to-right, THEN index — giving ascending x-axis
      // labels. `slice()` guards the react-query cache array from an
      // in-place `reverse()` mutation.
      (charges ?? [])
        .slice()
        .reverse()
        .map((s, i) => ({
          i: String(i),
          energy: convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh'),
        })),
    [charges],
  );

  const hasData = chartData.length > 1;
  const isCompact = size.cols <= 1;

  const stats: ChartSummaryStat[] = useMemo(() => {
    if (!hasData) return [];
    const total = chartData.reduce((sum, d) => sum + d.energy, 0);
    const avg = total / chartData.length;
    return [
      { label: t('widget.chargeHistory.total', 'Total'), value: fmt(total, 1), unit: 'kWh' },
      { label: t('widget.chargeHistory.avg', 'Avg'), value: fmt(avg, 1), unit: 'kWh' },
    ];
  }, [chartData, hasData, t]);

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
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
      title={t('widget.chargeHistory.title', 'Charge History')}
      icon={<BarChart3 className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.noChargeHistory', 'No charge sessions yet')}
        emptyIcon={<BarChart3 className="h-5 w-5" />}
        stats={stats}
        chart={
          <AreaChartWrapper
            data={chartData}
            xKey="i"
            series={[{ key: 'energy', label: 'kWh', color: '#10b981' }]}
            height={200}
            yFormatter={(v) => `${v} kWh`}
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
