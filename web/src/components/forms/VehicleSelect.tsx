import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';
import { Select } from '@/components/ui';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope';
import { cn } from '@/lib/cn';
import {
  WORKSPACE_SCOPED_CONTROL,
  type WorkspaceScopedComponent,
} from '@/lib/workspaceScope';

/**
 * VehicleSelect — canonical per-page vehicle scope picker.
 *
 * A drop-in `<Select>` wired to the global `useSelectedVehicle()` store.
 * Renders nothing when the fleet is empty (the page should already be
 * showing a `<NoVehicleSelected>` empty state in that case). Always
 * renders for fleets of ≥1 vehicle so the user has an explicit context
 * indicator even when they only own one car.
 *
 * Use this in `PageContainer.actions` BEFORE `<RangePicker>` so the
 * canonical action row reads `[Vehicle][RangePicker][...other]`.
 *
 * For multi-vehicle pickers (rule editors, alert scopes), use
 * {@link VehicleMultiSelect} instead.
 */
export interface VehicleSelectProps {
  /** Optional override for the accessible label. Defaults to t('vehicleSelect.aria'). */
  ariaLabel?: string;
  /** Optional className applied to the underlying `<Select>`. */
  className?: string;
  /** Optional id forwarded to the `<select>` element. */
  id?: string;
  /** When true, prefixes a small `Car` icon before the trigger (matches sidebar picker). */
  withIcon?: boolean;
  /** Test id forwarded to the `<select>`. Defaults to "vehicle-select". */
  'data-testid'?: string;
  /** Use "local" only when this selection is intentionally independent of the shell vehicle. */
  scope?: 'workspace' | 'local';
}

export function VehicleSelect({
  ariaLabel,
  className,
  id,
  withIcon = false,
  'data-testid': testId = 'vehicle-select',
  scope = 'workspace',
}: VehicleSelectProps) {
  const { t } = useTranslation();
  const workspaceScope = useWorkspaceScope();
  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();

  if (
    vehicles.length === 0 ||
    (scope === 'workspace' &&
      workspaceScope.managed &&
      workspaceScope.vehicle)
  ) {
    return null;
  }

  const options = vehicles.map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));

  const select = (
    <Select
      id={id}
      aria-label={ariaLabel ?? t('vehicleSelect.aria', 'Select vehicle')}
      value={vehicleId != null ? String(vehicleId) : ''}
      onChange={(e) => {
        const next = Number(e.target.value);
        setVehicleId(Number.isFinite(next) && next > 0 ? next : null);
      }}
      options={options}
      className={cn('text-sm', className)}
      data-testid={testId}
    />
  );

  if (!withIcon) return select;

  return (
    <div className="flex items-center gap-2">
      <Car aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
      {select}
    </div>
  );
}

(VehicleSelect as typeof VehicleSelect & WorkspaceScopedComponent)[
  WORKSPACE_SCOPED_CONTROL
] = 'vehicle';
