import { useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Check, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PanelTitle, Text } from '@/components/ui/Typography';
import { Popover } from '@/components/ui/Popover';
import { Tooltip } from '@/components/ui/Tooltip';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { useStatusBarPopover } from './StatusBarContext';

/**
 * ActiveVehicleSegment.
 *
 * Footer status-bar segment showing the currently selected vehicle. Click
 * opens a small popover with a list of all vehicles — picking one routes
 * the rest of the app via the shared selectedVehicle store.
 *
 * A single vehicle has a static chip; an empty fleet is hidden to avoid
 * flashing a placeholder during the initial fleet-load.
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
    const battery = liveState.battery_level != null && Number.isFinite(liveState.battery_level)
      ? liveState.battery_level : '—';
    const ratedRangeM = liveState.rated_range;
    const range = ratedRangeM != null && Number.isFinite(ratedRangeM)
      ? Math.round(convertDistanceFromSI(ratedRangeM, distanceLabel)) : '—';
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
      className="max-h-status-options overflow-y-auto p-1"
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
              'flex h-auto min-h-11 md:min-h-9 w-full justify-start gap-2 rounded-shape-sm px-2 py-1.5 text-start',
              selected
                ? cn('bg-[var(--surface-2)]', typography.color.primary)
                : typography.color.secondary,
            )}
          >
            <Car className={cn('h-3.5 w-3.5 shrink-0', typography.color.muted)} aria-hidden />
            <Text
              as="span"
              size="xs"
              weight="medium"
              className="min-w-0 flex-1 whitespace-normal break-words text-start"
            >
              {name}
              {v.model && (
                <Text as="span" variant="caption" className="ms-1.5">
                  {v.model}
                </Text>
              )}
            </Text>
            {selected && (
              <Check className={cn('h-3.5 w-3.5 shrink-0', typography.color.secondary)} aria-hidden />
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
          <Text as="span" variant="caption" className="min-w-0 max-w-32 truncate" title={label}>
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
            'inline-flex min-w-0 items-center gap-1.5 rounded-shape-sm px-1.5 py-0.5',
            typography.size.xs,
            typography.color.secondary,
          )}
        >
          <Car className="h-3 w-3 shrink-0" aria-hidden />
          {!iconOnly && (
            <>
              <Text as="span" size="xs" weight="medium" className="truncate max-w-active-vehicle-label">{label}</Text>
              {metricsLabel && (
                <Text as="span" variant="caption" className="shrink-0">· {metricsLabel}</Text>
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
            'h-auto min-h-11 md:min-h-5 min-w-11 md:min-w-0 gap-1.5 rounded-shape-sm px-1.5 py-0',
            typography.size.xs,
            typography.color.secondary,
          )}
        >
          <Car className="h-3 w-3 shrink-0" aria-hidden />
          {!iconOnly && (
            <>
              <Text as="span" size="xs" weight="medium" className="truncate max-w-active-vehicle-compact-label">{label}</Text>
              {metricsLabel && (
                <Text as="span" variant="caption" className="shrink-0">· {metricsLabel}</Text>
              )}
              <ChevronUp className={cn('h-3 w-3 shrink-0 transition-transform duration-fast ease-standard motion-reduce:transition-none', open ? '' : 'rotate-180')} aria-hidden />
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
        className="min-w-vehicle-options"
      >
        {vehicleOptions}
      </Popover>
    </div>
  );
}
