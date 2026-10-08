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
 * - Options use Button with checkbox roles inside a labelled group,
 *   not listbox options, so native Enter/Space toggling remains available.
 * - The trigger is a Button + popover (Tailwind only), NOT
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
import { Button } from '@/components/ui/Button';
import { HelperText, ErrorText, Text } from '@/components/ui/Typography';
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
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled || vehicles.length === 0) {
      setOpen(false);
      return;
    }
    if (open) popoverRef.current?.querySelector<HTMLButtonElement>('[role="checkbox"]')?.focus();
  }, [open, disabled, vehicles.length]);

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

  const handleOptionKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const options = Array.from(popoverRef.current?.querySelectorAll<HTMLButtonElement>('[role="checkbox"]') ?? []);
    const index = options.findIndex((option) => option === document.activeElement);
    let next: number;
    if (e.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    options[next]?.focus();
  };

  const errorText = errorKey ? t(errorKey) : null;
  const hasError = Boolean(errorText);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Button
        variant="secondary"
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled || isFleetEmpty}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-describedby={hasError ? errorId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKey}
        className={cn(
          'h-auto min-h-11 w-full justify-between px-3 py-2 text-start',
          hasError && 'border-[var(--semantic-danger)]',
        )}
      >
        <Text variant="body" className="min-w-0 break-words">
            {triggerSummary}
        </Text>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </Button>

      {isFleetEmpty && (
        <HelperText className="mt-1">
          {t(
            'notifications.alertStudio.editor.vehiclesEmptyFleetHelp',
            'Add a vehicle in Settings → Vehicles to use this rule.',
          )}
        </HelperText>
      )}

      {hasError && (
        <ErrorText id={errorId} className="mt-1">
          {errorText}
        </ErrorText>
      )}

      {open && !isFleetEmpty && !disabled && (
        <div
          id={popoverId}
          ref={popoverRef}
          role="group"
          aria-labelledby={triggerId}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-shape-sm border border-[var(--border-default)] bg-[var(--surface-2)] p-1 shadow-e2"
        >
          <Button variant="ghost"
            type="button"
            role="checkbox"
            aria-checked={value.kind === 'all_sticky'}
            onKeyDown={handleOptionKey}
            onClick={handleToggleAll}
            className={cn(
              'h-auto min-h-11 w-full justify-between px-2 py-2 text-start',
              value.kind === 'all_sticky' &&
                'bg-[var(--surface-3)] text-[var(--text-primary)]',
            )}
            data-testid={`vehicle-multiselect-option-${SENTINEL_ID}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  value.kind === 'all_sticky'
                    ? 'border-[var(--focus-ring)] bg-[var(--surface-3)] text-[var(--text-primary)]'
                    : 'border-[var(--border-strong)]',
                )}
              >
                {value.kind === 'all_sticky' && (
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path d="M3 8l3 3 7-7" />
                  </svg>
                )}
              </span>
              <Text variant="body" className="min-w-0 break-words">
                {t(
                  'notifications.alertStudio.editor.vehiclesAllOption',
                  'All vehicles (current + future)',
                )}
              </Text>
            </span>
          </Button>

          <div className="my-1 h-px bg-[var(--border-subtle)]" aria-hidden />

          {vehicles.map((v) => {
            const checked =
              value.kind === 'specific' && value.vehicle_ids.includes(v.id);
            return (
              <Button variant="ghost"
                key={v.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onKeyDown={handleOptionKey}
                onClick={() => handleToggleVehicle(v.id)}
                className={cn(
                  'h-auto min-h-11 w-full justify-between px-2 py-2 text-start',
                  checked && 'bg-[var(--surface-3)]',
                )}
                data-testid={`vehicle-multiselect-option-${v.id}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked
                        ? 'border-[var(--focus-ring)] bg-[var(--surface-3)] text-[var(--text-primary)]'
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
                  <Text variant="body" className="min-w-0 break-words">{vehicleLabel(v)}</Text>
                </span>
              </Button>
            );
          })}

          {unknownIds.length > 0 && (
            <>
              <div className="my-1 h-px bg-[var(--border-subtle)]" aria-hidden />
              {unknownIds.map((id) => (
                <Button variant="ghost"
                  key={`unknown-${id}`}
                  type="button"
                  role="checkbox"
                  aria-checked={true}
                  onKeyDown={handleOptionKey}
                  onClick={() => handleToggleVehicle(id)}
                  className="h-auto min-h-11 w-full justify-between px-2 py-2 text-start"
                  data-testid={`vehicle-multiselect-option-unknown-${id}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--focus-ring)] bg-[var(--surface-3)] text-[var(--text-primary)]"
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
                    <Text variant="bodySm" className="min-w-0 break-words">
                      {t(
                        'notifications.alertStudio.editor.vehiclesUnknownLabel',
                        'Vehicle #{{id}}',
                        { id },
                      )}
                    </Text>
                  </span>
                  <Badge variant="warning" size="sm">
                    {t(
                      'notifications.alertStudio.editor.vehiclesUnknownBadge',
                      'Unknown',
                    )}
                  </Badge>
                </Button>
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
