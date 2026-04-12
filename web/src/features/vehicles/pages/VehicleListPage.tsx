import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useVehicles } from '@/api/hooks/useVehicles';
import { vehicleStates } from '@/lib/fsm';
import type { Vehicle } from '@/types/vehicle';

export default function VehicleListPage() {
  const { data: vehicles, isLoading, error } = useVehicles();

  return (
    <PageContainer
      title="Vehicles"
      subtitle="Your Tesla fleet"
      loading={isLoading}
      error={error as Error | null}
      empty={vehicles?.length === 0}
      emptyMessage="No vehicles found. Add your first vehicle to get started."
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
  const stateConfig = vehicleStates[vehicle.fsmState] ?? vehicleStates.unknown;

  return (
    <Card hover className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{vehicle.displayName}</h3>
          <p className="text-xs text-gray-500">{vehicle.model} · {vehicle.year}</p>
        </div>
        <Badge variant={stateConfig.variant} dot>{stateConfig.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-gray-500">Battery</span>
          <p className="font-medium">{vehicle.batteryLevel}%</p>
        </div>
        <div>
          <span className="text-gray-500">Range</span>
          <p className="font-medium">{vehicle.rangeMiles.toFixed(0)} mi</p>
        </div>
        <div>
          <span className="text-gray-500">Odometer</span>
          <p className="font-medium">{vehicle.odometerMiles.toFixed(0)} mi</p>
        </div>
        <div>
          <span className="text-gray-500">VIN</span>
          <p className="font-mono text-xs">{vehicle.vin.slice(-6)}</p>
        </div>
      </div>
    </Card>
  );
}
