import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useCostBreakdown } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function TrueCostPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const vehicleId = vehicles?.[0]?.id ?? '';

  const { data: cost, isLoading, error } = useCostBreakdown(vehicleId);

  return (
    <PageContainer
      title={t('True Cost of Ownership')}
      subtitle="Compare EV running costs against an equivalent gas vehicle"
      loading={isLoading}
      error={error as Error | null}
      empty={!cost}
      emptyMessage="No cost data available. Start charging to see your analysis."
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard
          label="Total EV Cost"
          value={`$${(cost?.totalChargingCost ?? 0).toFixed(2)}`}
        />
        <StatCard
          label="Equiv. Gas Cost"
          value={`$${(cost?.equivalentGasCost ?? 0).toFixed(2)}`}
        />
        <StatCard
          label="Total Savings"
          value={`$${(cost?.totalSavings ?? 0).toFixed(2)}`}
          trend={{ direction: 'up', value: 'vs gas', positive: true }}
        />
        <StatCard
          label="Monthly Savings"
          value={`$${(cost?.monthlySavings ?? 0).toFixed(2)}`}
        />
      </Grid>

      <Card className="mt-6">
        <CardHeader title="Cumulative Savings Over Time" subtitle="Chart placeholder" />
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          Cumulative savings area chart
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cost per Kilometer" subtitle="Chart placeholder" />
          <KVList
            items={[
              { label: 'EV Cost/km', value: `$${(cost?.costPerKmEv ?? 0).toFixed(4)}` },
              { label: 'Gas Cost/km', value: `$${(cost?.costPerKmIce ?? 0).toFixed(4)}` },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Savings Breakdown" />
          <KVList
            items={[
              { label: 'Fuel Savings', value: `$${(cost?.totalSavings ?? 0).toFixed(2)}` },
              { label: 'Maintenance Savings (Est.)', value: `$${(cost?.maintenanceSavingsEstimate ?? 0).toFixed(2)}` },
              {
                label: 'Total Estimated Savings',
                value: `$${((cost?.totalSavings ?? 0) + (cost?.maintenanceSavingsEstimate ?? 0)).toFixed(2)}`,
              },
              { label: 'Ownership Period', value: `${cost?.monthsOfOwnership ?? 0} months` },
            ]}
          />
        </Card>
      </div>
    </PageContainer>
  );
}
