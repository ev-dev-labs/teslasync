/**
 * Live Signal Inspector — header toolbar.
 *
 * Renders the vehicle picker that drives the whole page. Lives in the
 * `PageContainer` `actions` slot so the page follows the same header rhythm as
 * every other data-heavy screen (picker + freshness chip + refresh).
 */
import { useCallback, useMemo, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Select, type SelectOption } from '@/components/ui';
import type { Vehicle } from '@/types/vehicle';

interface LiveSignalToolbarProps {
  vehicles: Vehicle[];
  vehicleId: number | null;
  onChange: (id: number | null) => void;
}

export function LiveSignalToolbar({
  vehicles,
  vehicleId,
  onChange,
}: LiveSignalToolbarProps) {
  const { t } = useTranslation();

  // Show the placeholder only for an empty fleet. Once vehicles exist the
  // canonical selection always resolves one, so a clearable option would just
  // snap back to the first vehicle. Memoisation avoids rebuilding options on
  // every one-second live snapshot poll.
  const options = useMemo<SelectOption[]>(
    () => [
      ...(vehicles.length === 0
        ? [{
            value: '',
            label: t('admin.liveSignals.controls.selectVehicle', 'Select vehicle…'),
          }]
        : []),
      ...vehicles.map((v) => ({
        value: String(v.id),
        label:
          v.display_name ||
          v.vin ||
          `${t('common.vehicle', 'Vehicle')} ${v.id}`,
      })),
    ],
    [vehicles, t],
  );

  // An empty value exists only for the empty-fleet placeholder.
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const raw = e.target.value;
      onChange(raw ? Number(raw) : null);
    },
    [onChange],
  );

  return (
    <div className="w-full sm:w-56">
      <Select
        value={vehicleId !== null ? String(vehicleId) : ''}
        onChange={handleChange}
        options={options}
        aria-label={t('admin.liveSignals.controls.vehicleAria', 'Vehicle')}
      />
    </div>
  );
}
