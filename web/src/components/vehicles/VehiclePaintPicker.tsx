import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useVehiclePaint } from '@/hooks/useVehiclePaint';
import { PAINT_PALETTE_LIST } from '@/lib/vehicleColors';
import { VisuallyHidden } from '@/components/a11y';
import { Button } from '@/components/ui/Button';
import { Caption, Label } from '@/components/ui/Typography';

export interface VehiclePaintPickerProps {
  vehicleId: number;
  /**
   * Tesla `exterior_color` code from the vehicle config — used to compute
   * the auto-detected paint that the "Reset" button reverts to.
   */
  exteriorColor?: string | null;
  className?: string;
}

/**
 * VehiclePaintPicker — a small swatch row letting the user override the
 * Digital Twin paint color for a specific vehicle.
 *
 * The override is browser-local (per-vehicle) and broadcast to other tabs
 * via {@link useVehiclePaint}. When the user picks the inferred color
 * explicitly, the override is cleared so the picker stays in sync with
 * any future change to the Tesla `exterior_color` field.
 */
export function VehiclePaintPicker({
  vehicleId,
  exteriorColor,
  className,
}: VehiclePaintPickerProps) {
  const { t } = useTranslation();
  const { paint, setPaint, isOverridden, reset, inferred } = useVehiclePaint(
    vehicleId,
    exteriorColor,
  );
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <div
      className={cn('flex min-w-0 flex-wrap items-center gap-3', className)}
      role="radiogroup"
      aria-label={t('paint.pickerLabel', 'Vehicle paint color')}
    >
      <Label>
        {t('paint.label', 'Paint')}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        {PAINT_PALETTE_LIST.map((p, index) => {
          const selected = p.id === paint.id;
          const label = t(p.labelKey, p.defaultLabel);
          const isInferred = p.id === inferred.id;
          return (
            <Button
              key={p.id}
              ref={(node) => { swatchRefs.current[index] = node; }}
              variant="ghost"
              type="button"
              role="radio"
              tabIndex={selected ? 0 : -1}
              aria-checked={selected}
              aria-label={label}
              title={isInferred ? `${label} · ${t('paint.detected', 'Auto-detected')}` : label}
              onClick={() => setPaint(p.id)}
              onKeyDown={(event) => {
                const rtl = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
                let nextIndex: number;
                switch (event.key) {
                  case 'ArrowRight': nextIndex = index + (rtl ? -1 : 1); break;
                  case 'ArrowLeft': nextIndex = index + (rtl ? 1 : -1); break;
                  case 'ArrowDown': nextIndex = index + 1; break;
                  case 'ArrowUp': nextIndex = index - 1; break;
                  case 'Home': nextIndex = 0; break;
                  case 'End': nextIndex = PAINT_PALETTE_LIST.length - 1; break;
                  default: return;
                }
                event.preventDefault();
                nextIndex = (nextIndex + PAINT_PALETTE_LIST.length) % PAINT_PALETTE_LIST.length;
                setPaint(PAINT_PALETTE_LIST[nextIndex].id);
                swatchRefs.current[nextIndex]?.focus();
              }}
              className={cn(
                'relative h-11 w-11 shrink-0 rounded-full border-2 p-0',
                selected
                  ? 'border-[var(--focus-ring)] forced-colors:border-[Highlight]'
                  : 'border-[var(--control-border)] hover:border-[var(--control-border-hover)]',
              )}
            >
              <span
                className="relative flex h-7 w-7 items-center justify-center rounded-full forced-colors:[forced-color-adjust:none]"
                style={{ background: p.swatch }}
                aria-hidden="true"
              >
                {selected && (
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M4 8.5l2.5 2.5L12 5"
                      stroke={p.id === 'pearl-white' ? '#000000' : '#ffffff'}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <VisuallyHidden>{label}</VisuallyHidden>
            </Button>
          );
        })}
      </div>
      <Caption className="min-w-0 break-words" aria-live="polite" aria-atomic="true">
        {t(paint.labelKey, paint.defaultLabel)}
        {!isOverridden && <> · {t('paint.detected', 'Auto-detected')}</>}
      </Caption>
      {isOverridden && (
        <Button
          variant="ghost"
          wrapLabel
          type="button"
          onClick={reset}
          className="min-h-11 max-w-full"
        >
          {t('paint.reset', 'Reset to auto-detected')}
        </Button>
      )}
    </div>
  );
}
