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

  // Placeholder + one option per vehicle. Memoised because the page polls the
  // live snapshot every second, so the parent re-renders constantly; without
  // this the option list (and every `<option>`) is rebuilt on each tick even
  // when the fleet is unchanged. `vehicles ?? []` guards the `.map` so a
  // not-yet-resolved vehicles query can never crash the header.
  const options = useMemo<SelectOption[]>(
    () => [
      {
        value: '',
        label: t('admin.liveSignals.controls.selectVehicle', 'Select vehicle…'),
      },
      ...(vehicles ?? []).map((v) => ({
        value: String(v.id),
        label:
          v.display_name ||
          v.vin ||
          `${t('common.vehicle', 'Vehicle')} ${v.id}`,
      })),
    ],
    [vehicles, t],
  );

  // An empty value is the placeholder (→ `null`); any other value is a real
  // vehicle id. Comparing against `''` rather than truthiness keeps id `0`
  // (a valid, if unusual, primary key) distinct from "no selection".
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
