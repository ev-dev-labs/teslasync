import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { useMileageStats, useMonthlyMileage } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function MileagePage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const vehicleId = String(vehicles?.[0]?.id ?? '');

  const { data: stats, isLoading, error } = useMileageStats(vehicleId);
  const { data: monthly } = useMonthlyMileage(vehicleId);

  return (
    <PageContainer
      title={t('Mileage')}
      subtitle="Daily and monthly distance tracking"
      loading={isLoading}
      error={error as Error | null}
      empty={!stats}
      emptyMessage="No mileage data available."
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label="Total Distance" value={Math.round(stats?.totalDistance ?? 0)} unit="km" />
        <StatCard label="Daily Average" value={(stats?.avgDaily ?? 0).toFixed(1)} unit="km/day" />
        <StatCard label="Best Day" value={Math.round(stats?.maxDaily ?? 0)} unit="km" />
        <StatCard label="Days Tracked" value={stats?.daysTracked ?? 0} unit="days" />
      </Grid>

      <Card className="mt-6">
        <CardHeader title="Cumulative Mileage" subtitle="Chart placeholder" />
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          Cumulative distance area chart
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Daily Distance" subtitle="Chart placeholder" />
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          Daily distance area chart
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Monthly Mileage"
          subtitle={monthly ? `${monthly.length} months tracked` : 'Chart placeholder'}
        />
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          Monthly bar chart — distance per month
        </div>
      </Card>
    </PageContainer>
  );
}
