import { useTranslation } from 'react-i18next';
import { useFleetStates, useVehicles } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS } from '@/lib/constants';
import { FleetOperationsBrief } from '../components/FleetOperationsBrief';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function FleetPostureWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const vehicles = safeArray(vehiclesQuery.data);
  const fleetStates = useFleetStates(vehicles);
  const { vehicleId: selectedVehicleId } = useSelectedVehicle();
  const scopedId = vehicleId ?? selectedVehicleId;
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === scopedId) ?? null;
  const discoveryState = useDataState(vehiclesQuery);
  const entries = safeArray(fleetStates.data);
  const fleetState = useDataState(
    vehicles.length === 0 && discoveryState.hasData
      ? { ...fleetStates, data: [] }
      : fleetStates,
    {
      provenance: entries.every((entry) => entry.freshness === 'fresh') ? 'live' : 'cached',
      partial: vehicles.length > 0 && (entries.length < vehicles.length || entries.some((entry) => entry.state == null || entry.stale)),
      unavailable: vehicles.length === 0 && discoveryState.hasData,
    },
  );
  const states = vehicles.length > 0 ? [discoveryState, fleetState] : [discoveryState];
  const retry = () => {
    void vehiclesQuery.refetch();
    if (vehicles.length > 0) void fleetStates.refetch();
  };
  const dataState = {
    ...combineDataStates(states),
    data: vehiclesQuery.data,
    hasData: states.some((state) => state.hasData),
    retry,
  };

  return (
    <WidgetShell
      dataState={dataState}
      updatedAt={fleetStates.dataUpdatedAt ?? 0}
      isFetching={vehiclesQuery.isFetching || fleetStates.isFetching}
      isStale={vehiclesQuery.isStale || fleetStates.isStale || entries.some((entry) => entry.stale)}
      isError={vehiclesQuery.isError || fleetStates.isError}
      refreshIntervalMs={INTERVALS.STANDARD}
      onRefresh={retry}
      help={{
        i18nKey: 'dashboard.fleetPosture.help',
        defaultValue: 'Verified live-state coverage and evidence age across your fleet.',
      }}
      title={t('dashboard.fleetPosture.title', 'Fleet posture')}
      noPadding
    >
      <div className="px-4 pb-4">
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
