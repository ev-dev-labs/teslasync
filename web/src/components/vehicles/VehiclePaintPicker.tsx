import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useVehiclePaint } from '@/hooks/useVehiclePaint';
import { PAINT_PALETTE_LIST } from '@/lib/vehicleColors';

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

  return (
    <div
      className={cn('flex flex-wrap items-center gap-3', className)}
      role="radiogroup"
      aria-label={t('paint.pickerLabel', 'Vehicle paint color')}
    >
      <span className="text-xs uppercase tracking-wider text-white/50">
        {t('paint.label', 'Paint')}
      </span>
      <div className="flex items-center gap-2">
        {PAINT_PALETTE_LIST.map((p) => {
          const selected = p.id === paint.id;
          const label = t(p.labelKey, p.defaultLabel);
          const isInferred = p.id === inferred.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              title={isInferred ? `${label} · ${t('paint.detected', 'Auto-detected')}` : label}
              onClick={() => setPaint(p.id)}
              className={cn(
                'relative h-7 w-7 rounded-full border-2 transition-all duration-150',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
                selected
                  ? 'border-white scale-110 shadow-lg shadow-cyan-500/20'
                  : 'border-white/25 hover:border-white/60 hover:scale-105',
              )}
              style={{ background: p.swatch }}
            >
              {selected && (
                <span
                  className="absolute inset-0 flex items-center justify-center"
                  aria-hidden="true"
                >
                  <svg
                    className="h-3.5 w-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M4 8.5l2.5 2.5L12 5"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
              <span className="sr-only">{label}</span>
            </button>
          );
        })}
      </div>
      <span className="text-xs text-white/60" aria-live="polite">
        {t(paint.labelKey, paint.defaultLabel)}
      </span>
      {isOverridden && (
        <button
          type="button"
          onClick={reset}
          className="text-[11px] text-cyan-300 hover:text-cyan-200 underline-offset-4 hover:underline transition-colors"
        >
          {t('paint.reset', 'Reset to auto-detected')}
        </button>
      )}
    </div>
  );
}
