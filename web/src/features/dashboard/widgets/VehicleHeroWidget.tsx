import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { Skeleton } from '@/components/feedback';
import { VehicleHero } from '../components/VehicleHero';
import type { WidgetProps } from './types';
import type { Vehicle, VehicleState } from '../types';

export default function VehicleHeroWidget({ vehicleId }: WidgetProps) {
  const { data: vehicles } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];

  const id = vehicle?.id ?? 0;
  const { data: stateData } = useVehicleState(id);
  const { state: live } = useVehicleLive(vehicle?.id);
  const {
    convertDistance, convertSpeed, convertTemp,
    isFahrenheit, distanceUnit, speedUnit, tempUnit,
  } = useSettings();

  const firmwareVersion =
    live.version || live.swUpdateVersion || stateData?.state?.software_version || '—';

  if (!vehicle) return <Skeleton className="h-full w-full rounded-xl" />;

  return (
    <VehicleHero
      vehicle={vehicle as unknown as Vehicle}
      state={(stateData?.state ?? null) as VehicleState | null}
      firmwareVersion={firmwareVersion}
      convertDistance={convertDistance}
      convertSpeed={convertSpeed}
      convertTemp={convertTemp}
      isFahrenheit={isFahrenheit}
      distanceUnit={distanceUnit}
      speedUnit={speedUnit}
      tempUnit={tempUnit}
    />
  );
}
