import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { StatCard } from '@/components/data-display/StatCard';
import { useAnalyticsSummary } from '@/api/hooks/useAnalytics';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'driving', label: 'Driving' },
  { key: 'charging', label: 'Charging' },
  { key: 'battery', label: 'Battery' },
];

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');
  const { data, isLoading, error } = useAnalyticsSummary();

  return (
    <PageContainer
      title={t('Analytics')}
      subtitle="Fleet-wide analytics across all vehicles"
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage="No analytics data available yet."
    >
      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'overview' && (
        <>
          <Grid cols={{ default: 2, md: 3, lg: 4 }} gap={4} className="mt-4">
            <StatCard label="Vehicles" value={data?.totalVehicles ?? 0} />
            <StatCard label="Total Drives" value={data?.totalDrives ?? 0} />
            <StatCard label="Charges" value={data?.totalChargingSessions ?? 0} />
            <StatCard label="Energy" value={data?.totalEnergyKwh ?? 0} unit="kWh" />
            <StatCard label="Distance" value={Math.round(data?.totalDistanceKm ?? 0)} unit="km" />
            <StatCard label="Total Cost" value={`$${(data?.totalCost ?? 0).toFixed(0)}`} />
            <StatCard label="Avg Efficiency" value={Math.round(data?.avgEfficiencyWhKm ?? 0)} unit="Wh/km" />
            <StatCard label="CO₂ Saved" value={Math.round(data?.co2SavedKg ?? 0)} unit="kg" />
          </Grid>

          <Card className="mt-6">
            <CardHeader title="Vehicle Comparison" subtitle="Chart placeholder" />
            <div className="flex h-64 items-center justify-center text-sm text-gray-400">
              Vehicle comparison bar chart
            </div>
          </Card>
        </>
      )}

      {activeTab === 'driving' && (
        <Card className="mt-4">
          <CardHeader title="Driving Analytics" subtitle="Distance and efficiency trends" />
          <div className="flex h-64 items-center justify-center text-sm text-gray-400">
            Driving analytics charts placeholder
          </div>
        </Card>
      )}

      {activeTab === 'charging' && (
        <Card className="mt-4">
          <CardHeader title="Charging Analytics" subtitle="Monthly charging trends" />
          <div className="flex h-64 items-center justify-center text-sm text-gray-400">
            Monthly charging trend chart placeholder
          </div>
        </Card>
      )}

      {activeTab === 'battery' && (
        <Card className="mt-4">
          <CardHeader title="Battery Analytics" subtitle="Health and degradation overview" />
          <div className="flex h-64 items-center justify-center text-sm text-gray-400">
            Battery health radial chart placeholder
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
