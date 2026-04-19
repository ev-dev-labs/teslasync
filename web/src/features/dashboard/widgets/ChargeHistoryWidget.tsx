import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { AreaChartWrapper } from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import type { WidgetProps } from './types';
import type { ChargingSession } from '../types';

export default function ChargeHistoryWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { data: charges, isLoading } = useQuery({
    queryKey: ['charging', id, 'recent-10'],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${id}&limit=10`),
    enabled: id > 0,
  });

  const chartData = (charges ?? [])
    .map((s, i) => ({
      i: String(i),
      energy: s.charge_energy_added ?? 0,
    }))
    .reverse();

  return (
    <GlassPanel className="h-full flex flex-col p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
        <BarChart3 className="h-3.5 w-3.5 text-neon-green" />
        {t('widget.chargeHistory', 'Charge History')}
      </h3>
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <Skeleton className="h-full w-full" />
        ) : chartData.length > 1 ? (
          <AreaChartWrapper
            data={chartData}
            xKey="i"
            series={[{ key: 'energy', label: 'kWh', color: '#10b981' }]}
            height={200}
            yFormatter={(v) => `${v} kWh`}
          />
        ) : (
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            message={t('widget.noChargeHistory', 'No charge sessions yet')}
            className="py-4"
          />
        )}
      </div>
    </GlassPanel>
  );
}
