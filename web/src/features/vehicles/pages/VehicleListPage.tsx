import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useVehicles } from '@/api/hooks/useVehicles';
import { vehicleStates } from '@/lib/fsm';
import type { Vehicle } from '@/types/vehicle';
import { useTranslation } from 'react-i18next';

export default function VehicleListPage() {
  const { t } = useTranslation('vehicles');
  const { data: vehicles, isLoading, error } = useVehicles();

  return (
    <PageContainer
      title={t('list.title', 'Vehicles')}
      subtitle={t('list.subtitle', 'Your Tesla fleet')}
      loading={isLoading}
      error={error as Error | null}
      empty={vehicles?.length === 0}
      emptyMessage={t('list.empty', 'No vehicles found. Add your first vehicle to get started.')}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vehicles?.map((v: Vehicle) => (
          <VehicleCard key={v.id} vehicle={v} />
        ))}
      </div>
    </PageContainer>
  );
}

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const stateConfig = vehicleStates[vehicle.state] ?? vehicleStates.unknown;

  return (
    <Card hover className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{vehicle.display_name}</h3>
          <p className="text-xs text-gray-500">{vehicle.model} · {vehicle.trim_badging}</p>
        </div>
        <Badge variant={stateConfig.variant} dot>{stateConfig.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-gray-500">State</span>
          <p className="font-medium">{vehicle.state}</p>
        </div>
        <div>
          <span className="text-gray-500">Color</span>
          <p className="font-medium">{vehicle.exterior_color}</p>
        </div>
        <div>
          <span className="text-gray-500">Wheels</span>
          <p className="font-medium">{vehicle.wheel_type}</p>
        </div>
        <div>
          <span className="text-gray-500">VIN</span>
          <p className="font-mono text-xs">{vehicle.vin.slice(-6)}</p>
        </div>
      </div>
    </Card>
  );
}
