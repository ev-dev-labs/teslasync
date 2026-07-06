import { useEffect, useId, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Check, ChevronUp } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { cn } from '@/lib/cn';

/**
 * ActiveVehicleSegment.
 *
 * Footer status-bar segment showing the currently selected vehicle. Click
 * opens a small popover with a list of all vehicles — picking one routes
 * the rest of the app via the shared selectedVehicle store.
 *
 * Hidden when only one vehicle is on the account (nothing to switch
 * between) and during the initial fleet-load to avoid flashing a
 * placeholder.
 */

interface ActiveVehicleSegmentProps {
  iconOnly?: boolean;
}

export function ActiveVehicleSegment({ iconOnly = false }: ActiveVehicleSegmentProps) {
  const { t } = useTranslation();
  const { vehicle, vehicles, vehicleId, setVehicleId } = useSelectedVehicle();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();

  // Footer-tier polling: 60s is plenty for an always-mounted micro-segment.
  // The full-vehicle state hook is shared via TanStack Query dedup with any
  // page-tier consumer, so this just lengthens the safety-net interval.
  const { data: stateData } = useVehicleState(vehicleId ?? 0, { refetchInterval: 60_000 });
  /* state.rated_range arrives in meters, not miles. The legacy
   * useSettings.toDistanceDisplay() expected miles-in / user-unit-out and
   * blew up by 1000× on SI input. Use the SI-aware converter + label from
   * useUnits() so the value tracks the user's distance preference. */
  const { unitPrefs } = useUnits();
  const distanceLabel = unitPrefs.distance;
  const liveState = stateData?.state;
  // Compose "<battery>% · <range> <unit>" from the live snapshot. Guard every
  // numeric against non-finite input — a direct backend `state` payload can
  // carry nulls the VehicleState type does not model — so the chip can never
  // render a literal "NaN%" / "NaN km".
  const metricsLabel = useMemo<string | null>(() => {
    if (!liveState) return null;
    const battery = Number.isFinite(liveState.battery_level) ? liveState.battery_level : 0;
    const ratedRangeM = Number.isFinite(liveState.rated_range) ? liveState.rated_range : 0;
    const range = Math.round(convertDistanceFromSI(ratedRangeM, distanceLabel));
    return `${battery}% · ${range} ${distanceLabel}`;
  }, [liveState, distanceLabel]);

  // Close popover on outside click / Escape so it behaves like a real menu.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        // Escape is a keyboard dismissal — return focus to the trigger so the
        // user is not dropped onto <body> after the listbox unmounts.
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = useCallback(
    (id: number) => {
      setVehicleId(id);
      setOpen(false);
      // The chosen option button unmounts with the listbox; move focus back to
      // the trigger so keyboard users keep a sensible focus anchor.
      triggerRef.current?.focus();
    },
    [setVehicleId],
  );

  if (vehicles.length === 0) {
    return null;
  }

  const label =
    vehicle?.display_name ||
    vehicle?.vin ||
    (vehicleId != null ? `${t('statusBar.vehicle.fallback', 'Vehicle')} ${vehicleId}` : t('statusBar.vehicle.none', 'No vehicle'));
  const subLabel = vehicle?.model || '';

  const tooltip = (
    <span>
      {t('statusBar.vehicle.tooltip', 'Active vehicle')} · {label}
      {subLabel ? ` · ${subLabel}` : ''}
      {metricsLabel ? ` · ${metricsLabel}` : ''}
    </span>
  );

  // Single-vehicle owners get a static, non-interactive chip — no need
  // for a switcher when there's nothing to switch to.
  if (vehicles.length === 1) {
    return (
      <Tooltip content={tooltip} side="top">
        <span
          aria-label={`${t('statusBar.vehicle.aria', 'Active vehicle')}: ${label}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs leading-none',
            'text-[var(--text-secondary)]',
          )}
        >
          <Car className="h-3 w-3 shrink-0" aria-hidden />
          {!iconOnly && (
            <>
              <span className="font-medium truncate max-w-[160px]">{label}</span>
              {metricsLabel && (
                <span className="text-[var(--text-muted)] shrink-0">· {metricsLabel}</span>
              )}
            </>
          )}
        </span>
      </Tooltip>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      <Tooltip content={tooltip} side="top">
        <button
          type="button"
          ref={triggerRef}
          aria-label={`${t('statusBar.vehicle.switch', 'Switch vehicle')} (${label})`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs leading-none',
            'text-[var(--text-secondary)] hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]',
          )}
        >
          <Car className="h-3 w-3 shrink-0" aria-hidden />
          {!iconOnly && (
            <>
              <span className="font-medium truncate max-w-[140px]">{label}</span>
              {metricsLabel && (
                <span className="text-[var(--text-muted)] shrink-0">· {metricsLabel}</span>
              )}
              <ChevronUp className={cn('h-3 w-3 shrink-0 transition-transform', open ? '' : 'rotate-180')} aria-hidden />
            </>
          )}
        </button>
      </Tooltip>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('statusBar.vehicle.aria', 'Active vehicle')}
          className={cn(
            'absolute bottom-full right-0 mb-1 z-[120] min-w-[220px] max-h-[280px] overflow-y-auto',
            'rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] shadow-2xl backdrop-blur-xl',
            'p-1',
          )}
        >
          {vehicles.map((v) => {
            const selected = v.id === vehicleId;
            const name = v.display_name || v.vin || `${t('statusBar.vehicle.fallback', 'Vehicle')} ${v.id}`;
            return (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => pick(v.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                  'hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]',
                  selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                )}
              >
                <Car className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
                <span className="flex-1 min-w-0 truncate">
                  <span className="font-medium">{name}</span>
                  {v.model && <span className="ml-1.5 text-[var(--text-muted)]">{v.model}</span>}
                </span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
