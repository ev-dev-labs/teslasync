/**
 * Multi-vehicle picker for the Alert Studio.
 *
 * Discriminated-union value shape modeling the editor invariant:
 *
 *   { kind: 'all_sticky' }                              — applies to fleet (current + future)
 *   { kind: 'specific', vehicle_ids: number[] }         — explicit subset
 *
 * The "All vehicles (current + future)" sentinel is mutually
 * exclusive with per-vehicle selection. Toggling it ON moves to
 * `all_sticky` and remembers the previous specific selection so a
 * subsequent toggle OFF restores it.
 *
 * Implementation notes:
 * - Option items render as `<button role="checkbox" aria-checked>`,
 *   NOT raw `<input type="checkbox">` — no `Checkbox` primitive
 *   exists in `@/components/ui`.
 * - The trigger is a custom button + popover (Tailwind only), NOT
 *   the native `<select>` primitive.
 * - All visible strings flow through `t()` from i18next.
 *
 * Unknown vehicle IDs (selected on a server-stored rule but not in
 * the current `useVehicles()` result, e.g. deleted/re-VINed vehicles)
 * are preserved in the selection and rendered with an "Unknown" badge
 * at the bottom of the list — they are never silently
 * dropped from the payload.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { Vehicle } from '@/types/vehicle';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';

export type VehicleSelection =
  | { kind: 'all_sticky' }
  | { kind: 'specific'; vehicle_ids: number[] };

export interface VehicleMultiSelectProps {
  value: VehicleSelection;
  onChange: (next: VehicleSelection) => void;
  vehicles: Vehicle[];
  /**
   * Inline error key resolved by i18n. When set, the trigger gets a
   * danger-coloured border and the error text appears below.
   */
  errorKey?: string | null;
  disabled?: boolean;
  /** Optional id forwarded to the trigger button for label association. */
  id?: string;
  className?: string;
}

const SENTINEL_ID = 'all_sticky_sentinel';

function lastFourVin(vin: string | undefined | null): string | null {
  if (!vin || vin.length < 4) return null;
  return vin.slice(-4);
}

function vehicleLabel(v: Vehicle): string {
  const last4 = lastFourVin(v.vin);
  const base = v.display_name || v.model || `Vehicle #${v.id}`;
  if (!last4) return v.model ? `${base} — ${v.model}` : base;
  if (!v.model || v.display_name === v.model) return `${base} (VIN ...${last4})`;
  return `${base} — ${v.model} (VIN ...${last4})`;
}

function dedupSort(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (id > 0 && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

export function VehicleMultiSelect({
  value,
  onChange,
  vehicles,
  errorKey,
  disabled,
  id,
  className,
}: VehicleMultiSelectProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const popoverId = `${triggerId}-popover`;
  const errorId = `${triggerId}-error`;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const previousSpecificRef = useRef<number[]>(
    value.kind === 'specific' ? value.vehicle_ids : [],
  );
  useEffect(() => {
    if (value.kind === 'specific') {
      previousSpecificRef.current = value.vehicle_ids;
    }
  }, [value]);

  const knownIds = useMemo(() => new Set(vehicles.map((v) => v.id)), [vehicles]);
  const selectedIds = value.kind === 'specific' ? value.vehicle_ids : [];
  const unknownIds = useMemo(
    () => selectedIds.filter((id) => !knownIds.has(id)),
    [selectedIds, knownIds],
  );

  const isFleetEmpty = vehicles.length === 0;

  const triggerSummary = useMemo(() => {
    if (value.kind === 'all_sticky') {
      return t(
        'notifications.alertStudio.editor.vehiclesSummaryAll',
        'All vehicles',
      );
    }
    const total = vehicles.length;
    const count = selectedIds.length;
    if (count === 0) {
      return t(
        'notifications.alertStudio.editor.vehiclesSummaryNone',
        'No vehicles selected',
      );
    }
    if (count === 1) {
      const veh = vehicles.find((v) => v.id === selectedIds[0]);
      const name = veh
        ? veh.display_name || veh.model || `Vehicle #${selectedIds[0]}`
        : `Vehicle #${selectedIds[0]}`;
      return t(
        'notifications.alertStudio.editor.vehiclesSummaryOne',
        '{{name}}',
        { name },
      );
    }
    if (total > 0 && count < total) {
      return t(
        'notifications.alertStudio.editor.vehiclesSummaryPartial',
        '{{count}} of {{total}} vehicles',
        { count, total },
      );
    }
    return t(
      'notifications.alertStudio.editor.vehiclesSummaryCount',
      '{{count}} vehicles',
      { count },
    );
  }, [value, selectedIds, vehicles, t]);

  // Outside-click + escape close.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleToggleAll = useCallback(() => {
    if (value.kind === 'all_sticky') {
      // Restore the previous specific selection (D13). Empty if none.
      onChange({ kind: 'specific', vehicle_ids: previousSpecificRef.current });
      return;
    }
    onChange({ kind: 'all_sticky' });
  }, [value, onChange]);

  const handleToggleVehicle = useCallback(
    (vehicleId: number) => {
      const current = value.kind === 'specific' ? value.vehicle_ids : [];
      const isSelected = current.includes(vehicleId);
      const next = isSelected
        ? current.filter((id) => id !== vehicleId)
        : dedupSort([...current, vehicleId]);
      onChange({ kind: 'specific', vehicle_ids: next });
    },
    [value, onChange],
  );

  const handleTriggerKey = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
    },
    [],
  );

  const errorText = errorKey ? t(errorKey) : null;
  const hasError = Boolean(errorText);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled || isFleetEmpty}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-describedby={hasError ? errorId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKey}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors',
          hasError
            ? 'border-[var(--danger)] focus-visible:ring-[var(--danger)]'
            : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)] focus-visible:ring-[var(--accent)]',
          'focus-visible:outline-none focus-visible:ring-2',
          (disabled || isFleetEmpty) && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <Badge variant="neutral" size="sm">
            {triggerSummary}
          </Badge>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {isFleetEmpty && (
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          {t(
            'notifications.alertStudio.editor.vehiclesEmptyFleetHelp',
            'Add a vehicle in Settings → Vehicles to use this rule.',
          )}
        </p>
      )}

      {hasError && (
        <p id={errorId} role="alert" className="mt-1 text-[11px] text-[var(--danger)]">
          {errorText}
        </p>
      )}

      {open && !isFleetEmpty && (
        <div
          id={popoverId}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={triggerId}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-1 shadow-lg"
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={value.kind === 'all_sticky'}
            onClick={handleToggleAll}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-3)]',
              value.kind === 'all_sticky' &&
                'bg-[var(--surface-3)] text-[var(--text-primary)]',
            )}
            data-testid={`vehicle-multiselect-option-${SENTINEL_ID}`}
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded border',
                  value.kind === 'all_sticky'
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                    : 'border-[var(--border-strong)]',
                )}
              >
                {value.kind === 'all_sticky' && (
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path d="M3 8l3 3 7-7" />
                  </svg>
                )}
              </span>
              <span className="font-medium">
                {t(
                  'notifications.alertStudio.editor.vehiclesAllOption',
                  'All vehicles (current + future)',
                )}
              </span>
            </span>
          </button>

          <div className="my-1 h-px bg-[var(--border-subtle)]" aria-hidden />

          {vehicles.map((v) => {
            const checked =
              value.kind === 'specific' && value.vehicle_ids.includes(v.id);
            return (
              <button
                key={v.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => handleToggleVehicle(v.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-3)]',
                  checked && 'bg-[var(--surface-3)]',
                )}
                data-testid={`vehicle-multiselect-option-${v.id}`}
              >
                <span className="flex items-center gap-2 truncate">
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded border',
                      checked
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                        : 'border-[var(--border-strong)]',
                    )}
                  >
                    {checked && (
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path d="M3 8l3 3 7-7" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate">{vehicleLabel(v)}</span>
                </span>
              </button>
            );
          })}

          {unknownIds.length > 0 && (
            <>
              <div className="my-1 h-px bg-[var(--border-subtle)]" aria-hidden />
              {unknownIds.map((id) => (
                <button
                  key={`unknown-${id}`}
                  type="button"
                  role="checkbox"
                  aria-checked={true}
                  onClick={() => handleToggleVehicle(id)}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[var(--surface-3)]"
                  data-testid={`vehicle-multiselect-option-unknown-${id}`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span
                      aria-hidden
                      className="flex h-4 w-4 items-center justify-center rounded border border-[var(--accent)] bg-[var(--accent)] text-white"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path d="M3 8l3 3 7-7" />
                      </svg>
                    </span>
                    <span className="truncate text-[var(--text-muted)]">
                      {t(
                        'notifications.alertStudio.editor.vehiclesUnknownLabel',
                        'Vehicle #{{id}}',
                        { id },
                      )}
                    </span>
                  </span>
                  <Badge variant="warning" size="sm">
                    {t(
                      'notifications.alertStudio.editor.vehiclesUnknownBadge',
                      'Unknown',
                    )}
                  </Badge>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Convert a server-stored {@link AlertRule} into the editor's
 * {@link VehicleSelection}. Honours the new `all_vehicles` flag when
 * present and falls back to the legacy `vehicle_id` for transitional
 * compat (Decision D12).
 */
export function hydrateVehicleSelection(rule: {
  all_vehicles?: boolean;
  vehicle_ids?: number[];
  vehicle_id?: number | null;
}): VehicleSelection {
  if (typeof rule.all_vehicles === 'boolean') {
    if (rule.all_vehicles) return { kind: 'all_sticky' };
    return {
      kind: 'specific',
      vehicle_ids: dedupSort(rule.vehicle_ids ?? []),
    };
  }
  return rule.vehicle_id == null
    ? { kind: 'all_sticky' }
    : { kind: 'specific', vehicle_ids: [rule.vehicle_id] };
}

/**
 * Convert a {@link VehicleSelection} into the wire-shape sub-payload
 * for `AlertRuleInput`. Always emits BOTH `all_vehicles` and
 * `vehicle_ids`; never emits the legacy `vehicle_id` (Decision D11).
 * Vehicle IDs are deduped + sorted (Decision D14).
 */
export function buildVehiclePayload(sel: VehicleSelection): {
  all_vehicles: boolean;
  vehicle_ids: number[];
} {
  if (sel.kind === 'all_sticky') {
    return { all_vehicles: true, vehicle_ids: [] };
  }
  return { all_vehicles: false, vehicle_ids: dedupSort(sel.vehicle_ids) };
}
