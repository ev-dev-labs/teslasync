import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import { useTranslation } from 'react-i18next';

interface Vehicle {
  id: number;
  display_name: string;
  state: string;
}

export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const online = (vehicles ?? []).filter((v) => v.state === 'online').length;
  const total = (vehicles ?? []).length;

  return (
    <PageContainer
      title={t('title', 'Dashboard')}
      subtitle={t('subtitle', 'Overview of your Tesla fleet')}
      loading={isLoading}
      empty={!isLoading && total === 0}
      emptyMessage={t('empty', 'No vehicles found. Connect your Tesla account to get started.')}
    >
      <Grid cols={{ default: 1, sm: 2, lg: 4 }} gap={4}>
        <StatCard label={t('vehicles', 'Vehicles')} value={total} loading={isLoading} />
        <StatCard
          label={t('online', 'Online')}
          value={online}
          loading={isLoading}
          trend={total > 0 ? { direction: 'flat' as const, value: `${total - online} offline` } : undefined}
        />
        <StatCard label={t('charging', 'Charging')} value={(vehicles ?? []).filter((v) => v.state === 'charging').length} loading={isLoading} />
        <StatCard label={t('driving', 'Driving')} value={(vehicles ?? []).filter((v) => v.state === 'driving').length} loading={isLoading} />
      </Grid>
    </PageContainer>
  );
}
