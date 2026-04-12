import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { useDashboardStats } from '@/api/hooks/useDashboard';
import { useTranslation } from 'react-i18next';

export default function DashboardPage() {
  const { data, isLoading, error } = useDashboardStats();
  const { t } = useTranslation('dashboard');

  return (
    <PageContainer
      title={t('title', 'Dashboard')}
      subtitle={t('subtitle', 'Overview of your Tesla fleet')}
      loading={isLoading}
      error={error as Error | null}
    >
      <Grid cols={{ default: 1, sm: 2, lg: 4 }} gap={4}>
        <StatCard
          label="Total Miles"
          value={data?.totalMiles?.toFixed(0) ?? '0'}
          unit="mi"
          loading={isLoading}
        />
        <StatCard
          label="Energy Used"
          value={data?.totalEnergyKwh?.toFixed(1) ?? '0'}
          unit="kWh"
          loading={isLoading}
        />
        <StatCard
          label="Avg Efficiency"
          value={data?.avgEfficiency?.toFixed(0) ?? '0'}
          unit="Wh/mi"
          loading={isLoading}
        />
        <StatCard
          label="Charging Cost"
          value={`$${((data?.totalCostCents ?? 0) / 100).toFixed(2)}`}
          loading={isLoading}
        />
      </Grid>

      <Grid cols={{ default: 1, sm: 2 }} gap={4}>
        <StatCard
          label="Vehicles"
          value={data?.totalVehicles ?? 0}
          loading={isLoading}
        />
        <StatCard
          label="Charging Sessions"
          value={data?.totalChargingSessions ?? 0}
          loading={isLoading}
        />
      </Grid>
    </PageContainer>
  );
}
