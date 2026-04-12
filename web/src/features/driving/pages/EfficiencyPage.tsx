import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useDrivingStats } from '@/api/hooks/useDriving';

export default function EfficiencyPage() {
  const { t } = useTranslation();
  const { data: stats, isLoading, error } = useDrivingStats();

  const costPerKm = stats && stats.totalDistanceKm > 0
    ? ((stats.avgEfficiencyWhKm / 1000) * 0.12).toFixed(3)
    : '—';

  const kmPerKwh = stats && stats.avgEfficiencyWhKm > 0
    ? (1000 / stats.avgEfficiencyWhKm).toFixed(1)
    : '—';

  return (
    <PageContainer
      title={t('efficiency.title', 'Efficiency')}
      subtitle={t('efficiency.subtitle', 'Energy consumption and driving efficiency analysis')}
      loading={isLoading}
      error={error as Error | null}
      empty={!stats}
      emptyMessage={t('efficiency.empty', 'No efficiency data available.')}
    >
      {stats && (
        <>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            <StatCard
              label={t('efficiency.avgConsumption', 'Avg Consumption')}
              value={Math.round(stats.avgEfficiencyWhKm)}
              unit="Wh/km"
            />
            <StatCard
              label={t('efficiency.kmPerKwh', 'Efficiency')}
              value={kmPerKwh}
              unit="km/kWh"
            />
            <StatCard
              label={t('efficiency.totalDistance', 'Total Distance')}
              value={Math.round(stats.totalDistanceKm)}
              unit="km"
            />
            <StatCard
              label={t('efficiency.co2Saved', 'CO₂ Saved')}
              value={Math.round(stats.co2SavedKg)}
              unit="kg"
            />
          </Grid>

          <Grid cols={{ default: 1, md: 2 }} gap={4}>
            <Card>
              <CardHeader title={t('efficiency.consumptionSummary', 'Consumption Summary')} />
              <KVList
                items={[
                  { label: t('efficiency.drivesAnalyzed', 'Drives Analyzed'), value: String(stats.totalDrives) },
                  { label: t('efficiency.totalDistLabel', 'Total Distance'), value: `${Math.round(stats.totalDistanceKm)} km` },
                  { label: t('efficiency.avgWhKm', 'Avg Consumption'), value: `${Math.round(stats.avgEfficiencyWhKm)} Wh/km` },
                  { label: t('efficiency.avgKmKwh', 'Avg Efficiency'), value: `${kmPerKwh} km/kWh` },
                ]}
              />
            </Card>

            <Card>
              <CardHeader title={t('efficiency.energySummary', 'Energy Summary')} />
              <KVList
                items={[
                  { label: t('efficiency.avgSpeed', 'Avg Speed'), value: `${Math.round(stats.avgSpeedKmh)} km/h` },
                  { label: t('efficiency.costPerKm', 'Est. Cost/km'), value: `$${costPerKm}` },
                  { label: t('efficiency.co2Label', 'CO₂ Saved vs ICE'), value: `${Math.round(stats.co2SavedKg)} kg` },
                  { label: t('efficiency.totalDuration', 'Total Drive Time'), value: `${Math.round(stats.totalDurationMin / 60)} h` },
                ]}
              />
            </Card>
          </Grid>
        </>
      )}
    </PageContainer>
  );
}
