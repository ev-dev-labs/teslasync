/**
 * Live Signal Inspector — header toolbar.
 *
 * Renders the vehicle picker that drives the whole page. Lives in the
 * `PageContainer` `actions` slot so the page follows the same header rhythm as
 * every other data-heavy screen (picker + freshness chip + refresh).
 */
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

  const options: SelectOption[] = [
    {
      value: '',
      label: t('admin.liveSignals.controls.selectVehicle', 'Select vehicle…'),
    },
    ...vehicles.map((v) => ({
      value: String(v.id),
      label:
        v.display_name ||
        v.vin ||
        `${t('common.vehicle', 'Vehicle')} ${v.id}`,
    })),
  ];

  return (
    <div className="w-full sm:w-56">
      <Select
        value={vehicleId !== null ? String(vehicleId) : ''}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw ? Number(raw) : null);
        }}
        options={options}
        aria-label={t('admin.liveSignals.controls.vehicleAria', 'Vehicle')}
      />
    </div>
  );
}
