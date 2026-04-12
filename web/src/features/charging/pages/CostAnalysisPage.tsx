import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useChargingSessions } from '@/api/hooks/useCharging';
import type { ChargingSession } from '@/types/charging';

export default function CostAnalysisPage() {
  const { t } = useTranslation();
  const { data: sessions, isLoading, error } = useChargingSessions();

  const stats = sessions ? computeCostStats(sessions) : null;

  return (
    <PageContainer
      title={t('Cost Analysis')}
      subtitle="Electricity cost trends and home vs supercharger comparison"
      loading={isLoading}
      error={error as Error | null}
      empty={sessions?.length === 0}
      emptyMessage="No charging data for cost analysis."
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label="Total Cost" value={`$${stats?.totalCost ?? '0.00'}`} loading={isLoading} />
        <StatCard label="Avg $/kWh" value={`$${stats?.avgCostPerKwh ?? '0.00'}`} loading={isLoading} />
        <StatCard label="Total Energy" value={stats?.totalKwh ?? 0} unit="kWh" loading={isLoading} />
        <StatCard label="Sessions" value={stats?.count ?? 0} loading={isLoading} />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cost per kWh Trend" subtitle="Chart placeholder" />
          <div className="flex h-48 items-center justify-center text-sm text-gray-400">
            $/kWh over time line chart
          </div>
        </Card>

        <Card>
          <CardHeader title="Home vs Supercharger" subtitle="Cost comparison" />
          <KVList
            items={[
              { label: 'Home Charging Cost', value: `$${stats?.homeCost ?? '0.00'}` },
              { label: 'Supercharger Cost', value: `$${stats?.superchargerCost ?? '0.00'}` },
              { label: 'Home Sessions', value: String(stats?.homeSessions ?? 0) },
              { label: 'Supercharger Sessions', value: String(stats?.superchargerSessions ?? 0) },
            ]}
          />
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Monthly Cost Breakdown" subtitle="Chart placeholder" />
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          Monthly stacked bar chart — EV cost vs equivalent gas cost
        </div>
      </Card>
    </PageContainer>
  );
}

function computeCostStats(sessions: ChargingSession[]) {
  const count = sessions.length;
  const totalCents = sessions.reduce((s, c) => s + c.costCents, 0);
  const totalKwh = +sessions.reduce((s, c) => s + c.energyAddedKwh, 0).toFixed(1);
  const totalCost = (totalCents / 100).toFixed(2);
  const avgCostPerKwh = totalKwh > 0 ? (totalCents / 100 / totalKwh).toFixed(2) : '0.00';

  const home = sessions.filter((s) => s.chargerType === 'home');
  const sc = sessions.filter((s) => s.chargerType === 'supercharger');
  const homeCost = (home.reduce((s, c) => s + c.costCents, 0) / 100).toFixed(2);
  const superchargerCost = (sc.reduce((s, c) => s + c.costCents, 0) / 100).toFixed(2);

  return {
    count,
    totalCost,
    totalKwh,
    avgCostPerKwh,
    homeCost,
    superchargerCost,
    homeSessions: home.length,
    superchargerSessions: sc.length,
  };
}
