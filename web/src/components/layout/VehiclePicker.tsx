import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';
import { Select } from '@/components/ui';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { cn } from '@/lib/cn';

/**
 * VehiclePicker — Phase 40 / Prompt 16.
 *
 * Persistent, app-wide vehicle selector mounted in the sidebar header.
 * Hides itself for single-vehicle owners (and while the fleet is still
 * loading) so it doesn't add noise for the common case.
 *
 * Reads & writes via {@link useSelectedVehicle}, which keeps the store in
 * sync with `/vehicles/:id` and `?vehicle_id=N` URLs.
 */
export interface VehiclePickerProps {
  className?: string;
}

export function VehiclePicker({ className }: VehiclePickerProps) {
  const { t } = useTranslation();
  const { vehicleId, setVehicleId, vehicles } = useSelectedVehicle();

  const options = useMemo(
    () =>
      vehicles.map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin || `Vehicle ${v.id}`,
      })),
    [vehicles],
  );

  // Hide for fleets of 0 or 1 vehicle — there's nothing meaningful to pick.
  if (vehicles.length <= 1) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 lg:px-4 lg:py-2 border-b border-[var(--glass-border)] shrink-0',
        className,
      )}
    >
      <Car
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
      />
      <Select
        aria-label={t('vehiclePicker.aria', 'Select vehicle')}
        className="flex-1 !py-1.5 text-xs"
        value={vehicleId != null ? String(vehicleId) : ''}
        onChange={(e) => {
          const next = Number(e.target.value);
          setVehicleId(Number.isFinite(next) && next > 0 ? next : null);
        }}
        options={options}
      />
    </div>
  );
}
