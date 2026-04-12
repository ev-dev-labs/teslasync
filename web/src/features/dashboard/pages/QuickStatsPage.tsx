import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDashboardStats } from '@/api/hooks/useDashboard';

export default function QuickStatsPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const { data: stats, isLoading, error } = useDashboardStats();
  const vehicle = vehicles?.[0];

  return (
    <PageContainer
      title={t('Quick Stats')}
      subtitle={t('Key vehicle metrics at a glance')}
      loading={isLoading}
      error={error as Error | null}
      empty={!stats}
      emptyMessage={t('No stats available.')}
    >
      {vehicle && (
        <Card>
          <CardHeader
            title={vehicle.display_name || vehicle.vin}
            subtitle={vehicle.model}
          />
        </Card>
      )}

      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Distance Driven')} value={stats?.totalMiles?.toLocaleString() ?? '0'} unit="mi" />
        <StatCard label={t('Total Drives')} value={stats?.totalTrips ?? 0} />
        <StatCard label={t('Energy Used')} value={`${stats?.totalEnergyKwh?.toFixed(1) ?? '0'}`} unit="kWh" />
        <StatCard label={t('Total Cost')} value={`$${((stats?.totalCostCents ?? 0) / 100).toFixed(2)}`} />
      </Grid>

      <Grid cols={{ default: 2 }} gap={4}>
        <StatCard label={t('Charging Sessions')} value={stats?.totalChargingSessions ?? 0} />
        <StatCard label={t('Avg Efficiency')} value={`${stats?.avgEfficiency?.toFixed(1) ?? '0'}`} unit="Wh/mi" />
      </Grid>
    </PageContainer>
  );
}
