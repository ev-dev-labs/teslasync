import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui';
import type { Vehicle } from '@/types/vehicle';

export interface ServiceVehicleSelectorProps {
  vehicleId: number | null;
  vehicles: Vehicle[];
  onChange: (vehicleId: number | null) => void;
}

export function ServiceVehicleSelector({
  vehicleId,
  vehicles,
  onChange,
}: ServiceVehicleSelectorProps) {
  const { t } = useTranslation();
  const options = vehicles.map((vehicle) => ({
    value: String(vehicle.id),
    label:
      vehicle.display_name ||
      vehicle.model ||
      t('serviceIntelligence.vehicle.fallback', 'Vehicle {{id}}', { id: vehicle.id }),
  }));

  return (
    <Select
      id="service-intelligence-vehicle"
      aria-label={t('serviceIntelligence.vehicle.select', 'Select vehicle')}
      value={vehicleId == null ? '' : String(vehicleId)}
      onChange={(event) => {
        const next = Number(event.target.value);
        onChange(Number.isFinite(next) && next > 0 ? next : null);
      }}
      options={options}
      disabled={vehicles.length === 0}
    />
  );
}
