import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useEnergyStats } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function EnergyPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const { data: stats, isLoading, error } = useEnergyStats(activeId);

  const savings = (stats?.gas_equivalent_cost ?? 0) - (stats?.total_cost ?? 0);

  return (
    <PageContainer
      title={t('Energy')}
      subtitle={t('Energy consumption, costs and efficiency')}
      loading={isLoading}
      error={error as Error | null}
      empty={!stats}
      emptyMessage={t('No energy data available yet.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <select
            className="rounded border px-2 py-1 text-sm"
            value={activeId ?? ''}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.displayName || v.vin}</option>
            ))}
          </select>
        ) : undefined
      }
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Total Energy')} value={stats?.total_energy_kwh?.toFixed(1) ?? '0'} unit="kWh" />
        <StatCard label={t('Total Cost')} value={`$${stats?.total_cost?.toFixed(2) ?? '0'}`} />
        <StatCard label={t('Efficiency')} value={stats?.avg_efficiency_wh_km?.toFixed(0) ?? '0'} unit="Wh/km" />
        <StatCard label={t('CO₂ Saved')} value={stats?.co2_saved_kg?.toFixed(1) ?? '0'} unit="kg" />
      </Grid>

      <Card>
        <CardHeader title={t('Cost Comparison')} subtitle={t('EV vs gasoline equivalent')} />
        <Grid cols={{ default: 1, md: 3 }} gap={4}>
          <div className="text-center">
            <p className="text-sm text-gray-500">{t('EV Cost')}</p>
            <p className="text-2xl font-bold">${stats?.total_cost?.toFixed(2) ?? '0'}</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-500">{t('Gas Equivalent')}</p>
            <p className="text-2xl font-bold">${stats?.gas_equivalent_cost?.toFixed(2) ?? '0'}</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-500">{t('Savings')}</p>
            <p className="text-2xl font-bold text-green-600">${savings.toFixed(2)}</p>
            <Badge variant="success" size="sm">{t('Less than gas')}</Badge>
          </div>
        </Grid>
      </Card>

      <Card>
        <CardHeader title={t('Daily Breakdown')} />
        {/* TODO: wrap in ChartContainer */}
      </Card>
    </PageContainer>
  );
}
