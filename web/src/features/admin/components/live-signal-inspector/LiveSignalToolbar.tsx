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
  vehicles?: Vehicle[];
  vehicleId: number | null;
  onChange: (id: number | null) => void;
}

const EMPTY_VEHICLES: Vehicle[] = [];

export function LiveSignalToolbar({
  vehicles,
  vehicleId,
  onChange,
}: LiveSignalToolbarProps) {
  const { t } = useTranslation();
  const vehicleList = vehicles ?? EMPTY_VEHICLES;

  // Keep a placeholder while canonical selection is unresolved, but remove it
  // once a vehicle is active so the local control cannot clear global scope.
  const options = useMemo<SelectOption[]>(
    () => [
      ...(vehicleId === null || vehicleList.length === 0
        ? [{
            value: '',
            label: t('admin.liveSignals.controls.selectVehicle', 'Select vehicle…'),
          }]
        : []),
      ...vehicleList.map((v) => ({
        value: String(v.id),
        label:
          v.display_name ||
          v.vin ||
          `${t('common.vehicle', 'Vehicle')} ${v.id}`,
      })),
    ],
    [vehicleId, vehicleList, t],
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
