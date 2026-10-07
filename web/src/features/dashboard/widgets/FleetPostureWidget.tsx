import { useTranslation } from 'react-i18next';
import { useFleetStates, useVehicles } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { FleetOperationsBrief } from '../components/FleetOperationsBrief';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function FleetPostureWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const vehicles = vehiclesQuery.data ?? [];
  const fleetStates = useFleetStates(vehicles);
  const { vehicleId: selectedVehicleId } = useSelectedVehicle();
  const scopedId = vehicleId ?? selectedVehicleId;
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === scopedId) ?? null;

  return (
    <WidgetShell
      loading={vehiclesQuery.isPending}
      error={!vehiclesQuery.data && vehiclesQuery.error ? String(vehiclesQuery.error) : null}
      help={{
        i18nKey: 'dashboard.fleetPosture.help',
        defaultValue: 'Verified live-state coverage and evidence age across your fleet.',
      }}
      title={t('dashboard.fleetPosture.title', 'Fleet posture')}
      noPadding
    >
      <div className="h-full overflow-auto px-4 pb-4">
        <FleetOperationsBrief
          vehicles={vehicles}
          selectedVehicle={selectedVehicle}
          fleetStates={fleetStates.data}
          summary={fleetStates.summary}
          isPending={fleetStates.isPending}
          isError={fleetStates.isError}
        />
      </div>
    </WidgetShell>
  );
}
