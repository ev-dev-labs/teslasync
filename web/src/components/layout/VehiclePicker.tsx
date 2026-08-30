import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';
import { Select } from '@/components/ui/runtime';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePinned } from '@/api/hooks/usePinned';
import { cn } from '@/lib/cn';

/**
 * Persistent app-wide vehicle selector mounted in the sidebar header.
 *
 * Hides itself for single-vehicle owners (and while the fleet is still
 * loading) so it doesn't add noise for the common case.
 *
 * Reads & writes via {@link useSelectedVehicle}, which keeps the store in
 * sync with `/vehicles/:id` and `?vehicle_id=N` URLs.
 *
 * Pin-aware ordering: vehicles the user has pinned
 * float to the top in pin position order, then the rest follow in their
 * original API order.
 */
export interface VehiclePickerProps {
  className?: string;
  /** Hide when there is no meaningful choice. The header keeps one vehicle visible as context. */
  hideWhenSingle?: boolean;
}

export function VehiclePicker({
  className,
  hideWhenSingle = true,
}: VehiclePickerProps) {
  const { t } = useTranslation();
  const { vehicleId, setVehicleId, vehicles } = useSelectedVehicle();
  const { data: pins = [] } = usePinned('vehicle');

  const sorted = useMemo(() => {
    if (pins.length === 0) return vehicles;
    const order = new Map<string, number>();
    pins.forEach((p) => order.set(String(p.item_id), p.position));
    return [...vehicles].sort((a, b) => {
      const ap = order.get(String(a.id));
      const bp = order.get(String(b.id));
      if (ap != null && bp != null) return ap - bp;
      if (ap != null) return -1;
      if (bp != null) return 1;
      return 0;
    });
  }, [vehicles, pins]);

  const options = useMemo(
    () =>
      sorted.map((v) => {
        const isPinned = pins.some((p) => String(p.item_id) === String(v.id));
        const base =
          v.display_name ||
          v.vin ||
          t('vehiclePicker.fallbackName', 'Vehicle {{id}}', { id: v.id });
        return {
          value: String(v.id),
          label: isPinned ? `📌 ${base}` : base,
        };
      }),
    [sorted, pins, t],
  );

  if (vehicles.length === 0 || (hideWhenSingle && vehicles.length === 1)) {
    return null;
  }

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
