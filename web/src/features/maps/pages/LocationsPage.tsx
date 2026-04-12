import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { useLocations } from '@/api/hooks/useLocations';
import type { Location } from '@/types/location';

export default function LocationsPage() {
  const { t } = useTranslation();
  const { data: locations, isLoading, error } = useLocations();

  const totalVisits = locations?.reduce((s: number, l: Location) => s + l.visitCount, 0) ?? 0;
  const totalHours = locations
    ? Math.round(locations.reduce((s: number, l: Location) => s + l.totalDurationMin, 0) / 60)
    : 0;
  const topLocation = locations?.[0];

  return (
    <PageContainer
      title={t('Visited Locations')}
      subtitle="Places you've been — ranked by frequency"
      loading={isLoading}
      error={error as Error | null}
      empty={locations?.length === 0}
      emptyMessage="No visited locations recorded yet."
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label="Unique Places" value={locations?.length ?? 0} />
        <StatCard label="Total Visits" value={totalVisits} />
        <StatCard label="Total Time" value={totalHours} unit="hours" />
        <StatCard label="Most Visited" value={topLocation?.addressName ?? '—'} />
      </Grid>

      <Card className="mt-6">
        <CardHeader title="Top Locations by Visits" subtitle="Chart placeholder" />
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">
          Horizontal bar chart of top locations
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="All Locations" />
        {locations && locations.length > 0 ? (
          <div className="space-y-2">
            {locations.map((loc: Location, i: number) => (
              <div
                key={loc.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 dark:border-gray-700"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400">#{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{loc.addressName}</p>
                    <p className="text-xs text-gray-500">
                      {loc.visitCount} visits · {Math.round(loc.totalDurationMin / 60)}h total
                      {loc.lastVisited && ` · Last: ${new Date(loc.lastVisited).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
                <span className="text-xs font-medium text-gray-500">{loc.visitCount}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-gray-400">No locations</p>
        )}
      </Card>
    </PageContainer>
  );
}
