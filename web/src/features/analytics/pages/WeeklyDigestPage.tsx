import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useWeeklyDigest } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';

function trendFor(current: number, previous: number) {
  if (current > previous) return { direction: 'up' as const, value: `+${Math.round(current - previous)}`, positive: true };
  if (current < previous) return { direction: 'down' as const, value: `${Math.round(current - previous)}`, positive: false };
  return { direction: 'flat' as const, value: 'no change' };
}

export default function WeeklyDigestPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const vehicleId = String(vehicles?.[0]?.id ?? '');

  const { data: digest, isLoading, error } = useWeeklyDigest(vehicleId);

  return (
    <PageContainer
      title={t('Weekly Digest')}
      subtitle="Your driving and charging summary for the week"
      loading={isLoading}
      error={error as Error | null}
      empty={!digest}
      emptyMessage="No weekly digest available yet."
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard
          label="Drives"
          value={digest?.drives ?? 0}
          trend={digest ? trendFor(digest.drives, digest.prevDrives) : undefined}
        />
        <StatCard
          label="Distance"
          value={Math.round(digest?.distanceKm ?? 0)}
          unit="km"
          trend={digest ? trendFor(digest.distanceKm, digest.prevDistanceKm) : undefined}
        />
        <StatCard
          label="Energy"
          value={(digest?.energyKwh ?? 0).toFixed(1)}
          unit="kWh"
          trend={digest ? trendFor(digest.energyKwh, digest.prevEnergyKwh) : undefined}
        />
        <StatCard
          label="Cost"
          value={`$${(digest?.cost ?? 0).toFixed(2)}`}
          trend={digest ? trendFor(digest.cost, digest.prevCost) : undefined}
        />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Week-over-Week Comparison" />
          <KVList
            items={[
              { label: 'Drives', value: `${digest?.drives ?? 0} (prev: ${digest?.prevDrives ?? 0})` },
              { label: 'Distance (km)', value: `${Math.round(digest?.distanceKm ?? 0)} (prev: ${Math.round(digest?.prevDistanceKm ?? 0)})` },
              { label: 'Energy (kWh)', value: `${(digest?.energyKwh ?? 0).toFixed(1)} (prev: ${(digest?.prevEnergyKwh ?? 0).toFixed(1)})` },
              { label: 'Cost ($)', value: `${(digest?.cost ?? 0).toFixed(2)} (prev: ${(digest?.prevCost ?? 0).toFixed(2)})` },
              { label: 'Efficiency (Wh/km)', value: `${Math.round(digest?.efficiency ?? 0)} (prev: ${Math.round(digest?.prevEfficiency ?? 0)})` },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Daily Breakdown" subtitle="Chart placeholder" />
          <div className="flex h-48 items-center justify-center text-sm text-gray-400">
            Daily bar chart for the week
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
