import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useAnalyticsSummary } from '@/api/hooks/useAnalytics';

export default function StatisticsPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useAnalyticsSummary(365);

  return (
    <PageContainer
      title={t('Statistics')}
      subtitle="Comprehensive lifetime statistics dashboard"
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage="No statistics data available."
    >
      <Grid cols={{ default: 2, md: 4 }} gap={4}>
        <StatCard label="Vehicles" value={data?.totalVehicles ?? 0} />
        <StatCard label="Total Distance" value={Math.round(data?.totalDistanceKm ?? 0)} unit="km" />
        <StatCard label="Total Drives" value={data?.totalDrives ?? 0} />
        <StatCard label="Charges" value={data?.totalChargingSessions ?? 0} />
        <StatCard label="Energy" value={Math.round(data?.totalEnergyKwh ?? 0)} unit="kWh" />
        <StatCard label="Total Cost" value={`$${(data?.totalCost ?? 0).toFixed(0)}`} />
        <StatCard label="Avg Efficiency" value={Math.round(data?.avgEfficiencyWhKm ?? 0)} unit="Wh/km" />
        <StatCard label="CO₂ Saved" value={Math.round(data?.co2SavedKg ?? 0)} unit="kg" />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Battery Health" subtitle="Radial chart placeholder" />
          <div className="flex h-48 items-center justify-center text-sm text-gray-400">
            Battery health radial gauge
          </div>
        </Card>

        <Card>
          <CardHeader title="State Distribution" subtitle="Pie chart placeholder" />
          <div className="flex h-48 items-center justify-center text-sm text-gray-400">
            Driving / Charging / Sleeping pie chart
          </div>
        </Card>

        <Card>
          <CardHeader title="Mileage Summary" />
          <KVList
            items={[
              { label: 'Total Distance', value: `${Math.round(data?.totalDistanceKm ?? 0)} km` },
              { label: 'Total Energy', value: `${Math.round(data?.totalEnergyKwh ?? 0)} kWh` },
              { label: 'Total Drives', value: String(data?.totalDrives ?? 0) },
            ]}
          />
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Monthly Charging Trend" subtitle="Chart placeholder" />
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          Monthly bar chart — energy, cost, gas savings
        </div>
      </Card>
    </PageContainer>
  );
}
