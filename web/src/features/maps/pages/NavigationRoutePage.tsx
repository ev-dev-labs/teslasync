import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function NavigationRoutePage() {
  const { t } = useTranslation();
  const { data: vehicles, isLoading, error } = useVehicles();

  const vehicle = vehicles?.[0];

  return (
    <PageContainer
      title={t('Navigation & Route')}
      subtitle="Live location tracking and navigation status"
      loading={isLoading}
      error={error as Error | null}
      empty={!vehicle}
      emptyMessage="No vehicle data available for navigation."
    >
      {vehicle && (
        <>
          <Grid cols={{ default: 2, lg: 4 }} gap={4}>
            <StatCard label="Current Vehicle" value={vehicle.displayName} />
            <StatCard label="Battery" value={vehicle.batteryLevel} unit="%" />
            <StatCard label="Range" value={vehicle.rangeMiles} unit="mi" />
            <StatCard label="Odometer" value={vehicle.odometerMiles.toLocaleString()} unit="mi" />
          </Grid>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Live Position" subtitle="Map placeholder" />
              <div className="flex h-64 items-center justify-center text-sm text-gray-400">
                Live map with vehicle marker
              </div>
            </Card>

            <Card>
              <CardHeader title="Location Details" />
              <KVList
                items={[
                  { label: 'Latitude', value: vehicle.latitude.toFixed(6) },
                  { label: 'Longitude', value: vehicle.longitude.toFixed(6) },
                  { label: 'Last Updated', value: new Date(vehicle.updatedAt).toLocaleString() },
                  { label: 'State', value: vehicle.fsmState },
                ]}
              />
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader title="Recent Location History" subtitle="Chart placeholder" />
            <div className="flex h-48 items-center justify-center text-sm text-gray-400">
              Location history trail on map
            </div>
          </Card>
        </>
      )}
    </PageContainer>
  );
}
