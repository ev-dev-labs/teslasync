import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { useChargingSessions } from '@/api/hooks/useCharging';
import type { ChargingSession } from '@/types/charging';

export default function ChargingHeatmapPage() {
  const { t } = useTranslation();
  const { data: sessions, isLoading, error } = useChargingSessions();

  const stats = sessions ? computeHeatmapStats(sessions) : null;

  return (
    <PageContainer
      title={t('Charging Heatmap')}
      subtitle="When and where you charge — patterns by day and hour"
      loading={isLoading}
      error={error as Error | null}
      empty={sessions?.length === 0}
      emptyMessage="No charging data for heatmap."
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard
          label="Total Sessions"
          value={stats?.totalSessions ?? 0}
          loading={isLoading}
        />
        <StatCard
          label="Total Energy"
          value={stats?.totalEnergyKwh ?? 0}
          unit="kWh"
          loading={isLoading}
        />
        <StatCard
          label="Total Cost"
          value={`$${stats?.totalCost ?? '0.00'}`}
          loading={isLoading}
        />
        <StatCard
          label="Avg Energy/Session"
          value={stats?.avgEnergyPerSession ?? 0}
          unit="kWh"
          loading={isLoading}
        />
      </Grid>

      <Card className="mt-6">
        <CardHeader
          title="Weekly Charging Heatmap"
          subtitle="Heatmap placeholder — day-of-week × hour-of-day grid"
        />
        <div className="flex h-72 items-center justify-center text-sm text-gray-400">
          7 × 24 heatmap grid will render here
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Top Charging Locations"
          subtitle="Chart placeholder — sessions by location"
        />
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          Horizontal bar chart of top locations
        </div>
      </Card>
    </PageContainer>
  );
}

function computeHeatmapStats(sessions: ChargingSession[]) {
  const totalSessions = sessions.length;
  const totalEnergyKwh = +sessions
    .reduce((sum, s) => sum + s.energyAddedKwh, 0)
    .toFixed(1);
  const totalCost = (
    sessions.reduce((sum, s) => sum + s.costCents, 0) / 100
  ).toFixed(2);
  const avgEnergyPerSession =
    totalSessions > 0 ? +(totalEnergyKwh / totalSessions).toFixed(1) : 0;

  return { totalSessions, totalEnergyKwh, totalCost, avgEnergyPerSession };
}
