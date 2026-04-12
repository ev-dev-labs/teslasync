import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useGeofences } from '@/api/hooks/useLocations';
import type { Geofence } from '@/types/location';

export default function GeofencesPage() {
  const { t } = useTranslation();
  const { data: geofences, isLoading, error } = useGeofences();

  const avgRadius = geofences?.length
    ? Math.round(geofences.reduce((s: number, g: Geofence) => s + g.radius, 0) / geofences.length)
    : 0;
  const withCost = geofences?.filter((g: Geofence) => g.costPerKwh !== null).length ?? 0;

  return (
    <PageContainer
      title={t('Geofences')}
      subtitle="Define locations for contextual tracking and automation"
      loading={isLoading}
      error={error as Error | null}
      actions={<Button variant="primary">Add Geofence</Button>}
    >
      {geofences && geofences.length > 0 ? (
        <>
          <Grid cols={{ default: 2, lg: 4 }} gap={4}>
            <StatCard label="Total Zones" value={geofences.length} />
            <StatCard label="Avg Radius" value={avgRadius} unit="m" />
            <StatCard label="With Cost Rate" value={withCost} />
            <StatCard label="Large Zones (500m+)" value={geofences.filter((g: Geofence) => g.radius >= 500).length} />
          </Grid>

          <Card className="mt-6">
            <CardHeader title="Map View" subtitle="Map placeholder — geofence circles" />
            <div className="flex h-72 items-center justify-center text-sm text-gray-400">
              Map with geofence circles will render here
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader title="Geofence List" />
            <div className="space-y-2">
              {geofences.map((g: Geofence) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 dark:border-gray-700"
                >
                  <div>
                    <p className="text-sm font-medium">{g.name}</p>
                    <p className="text-xs text-gray-500">
                      {(g.latitude ?? 0).toFixed(4)}, {(g.longitude ?? 0).toFixed(4)} · {g.radius}m
                      {g.costPerKwh !== null && ` · $${(g.costPerKwh ?? 0).toFixed(2)}/kWh`}
                    </p>
                  </div>
                  <KVList
                    items={[{ label: 'Radius', value: `${g.radius}m` }]}
                    className="text-xs"
                  />
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <EmptyState
          title="No geofences defined"
          message="Add a geofence to track when your vehicle arrives or leaves a location."
        />
      )}
    </PageContainer>
  );
}
