import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useVehicle, useRefreshVehicle } from '@/api/hooks/useVehicles';
import { vehicleStates } from '@/lib/fsm';

export default function VehicleDetailPage() {
  const { t } = useTranslation('vehicles');
  const { id } = useParams<{ id: string }>();
  const { data: vehicle, isLoading, error } = useVehicle(id!);
  const refresh = useRefreshVehicle();

  const stateConfig = vehicleStates[vehicle?.fsmState ?? 'unknown'] ?? vehicleStates.unknown;

  return (
    <PageContainer
      title={vehicle?.displayName ?? t('detail.title', 'Vehicle')}
      subtitle={vehicle ? `${vehicle.model} · ${vehicle.year} · ${vehicle.vin}` : undefined}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <Button
          variant="outline"
          loading={refresh.isPending}
          onClick={() => id && refresh.mutate(id)}
        >
          Refresh
        </Button>
      }
    >
      {vehicle && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <Badge variant={stateConfig.variant} dot>{stateConfig.label}</Badge>
          </div>

          <Grid cols={{ default: 2, lg: 4 }} gap={4}>
            <StatCard label="Battery" value={`${vehicle.batteryLevel}%`} />
            <StatCard label="Range" value={vehicle.rangeMiles.toFixed(0)} unit="mi" />
            <StatCard label="Odometer" value={vehicle.odometerMiles.toFixed(0)} unit="mi" />
            <StatCard
              label="Charging"
              value={vehicle.isCharging ? 'Yes' : 'No'}
            />
          </Grid>

          <Card className="mt-6">
            <KVList items={[
              { label: 'VIN', value: vehicle.vin },
              { label: 'Model', value: vehicle.model },
              { label: 'Year', value: String(vehicle.year) },
              { label: 'Last Updated', value: new Date(vehicle.updatedAt).toLocaleString() },
              { label: 'Location', value: `${vehicle.latitude.toFixed(4)}, ${vehicle.longitude.toFixed(4)}` },
            ]} />
          </Card>
        </>
      )}
    </PageContainer>
  );
}
