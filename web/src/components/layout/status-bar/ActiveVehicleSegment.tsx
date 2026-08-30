import { useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Check, ChevronUp } from 'lucide-react';
import { Button, PanelTitle, Popover, Text, Tooltip } from '@/components/ui/runtime';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { cn } from '@/lib/cn';
import { useStatusBarPopover } from './StatusBarContext';

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
  embedded?: boolean;
  onSelect?: () => void;
}

export function ActiveVehicleSegment({
  iconOnly = false,
  embedded = false,
  onSelect,
}: ActiveVehicleSegmentProps) {
  const { t } = useTranslation();
  const { vehicle, vehicles, vehicleId, setVehicleId } = useSelectedVehicle();
  const { open, toggle, close } = useStatusBarPopover('vehicle');
  const triggerRef = useRef<HTMLButtonElement | null>(null);

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

  const pick = useCallback(
    (id: number) => {
      setVehicleId(id);
      close();
      onSelect?.();
    },
    [close, onSelect, setVehicleId],
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

  const vehicleOptions = (
    <div
      className="max-h-[280px] overflow-y-auto p-1"
    >
      {vehicles.map((v) => {
        const selected = v.id === vehicleId;
        const name =
          v.display_name ||
          v.vin ||
          `${t('statusBar.vehicle.fallback', 'Vehicle')} ${v.id}`;
        return (
          <Button
            key={v.id}
            type="button"
            aria-current={selected ? 'true' : undefined}
            variant="ghost"
            size="sm"
            onClick={() => pick(v.id)}
            className={cn(
              'flex h-auto min-h-9 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left',
              selected
                ? 'bg-[var(--surface-2)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)]',
            )}
          >
            <Car className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
            <Text
              as="span"
              size="xs"
              weight="medium"
              className="min-w-0 flex-1 truncate text-left"
            >
              {name}
              {v.model && (
                <Text as="span" size="2xs" color="muted" className="ml-1.5">
                  {v.model}
                </Text>
              )}
            </Text>
            {selected && (
              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
            )}
          </Button>
        );
      })}
    </div>
  );

  if (embedded) {
    return (
      <section
        className="border-b border-[var(--border-subtle)] last:border-b-0"
        data-testid="status-bar-vehicle-embedded"
      >
        <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
          <PanelTitle>{t('statusBar.vehicle.switch', 'Switch vehicle')}</PanelTitle>
          <Text as="span" size="2xs" color="muted" className="max-w-32 truncate">
            {label}
          </Text>
        </div>
        {vehicleOptions}
      </section>
    );
  }

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
    <div className="relative inline-flex">
      <Tooltip content={tooltip} side="top">
        <Button
          type="button"
          ref={triggerRef}
          variant="ghost"
          size="sm"
          aria-label={`${t('statusBar.vehicle.switch', 'Switch vehicle')} (${label})`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            'h-5 min-h-0 gap-1.5 rounded px-1.5 py-0 text-xs leading-none',
            'text-[var(--text-secondary)]',
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
        </Button>
      </Tooltip>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        side="top"
        align="end"
        ariaLabel={t('statusBar.vehicle.switch', 'Switch vehicle')}
        className="min-w-[220px]"
      >
        {vehicleOptions}
      </Popover>
    </div>
  );
}
