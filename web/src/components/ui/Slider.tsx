import { forwardRef, useCallback, useId, useMemo } from 'react';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { Caption } from './Typography';

export interface SliderProps {
  /** Current numeric value. */
  value: number;
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** Step increment used by Arrow keys and drag. Defaults to 1. */
  step?: number;
  /** Fired with the new numeric value on every change. */
  onChange: (value: number) => void;
  /** Visible label *and* accessible name for the slider. Required. */
  label: string;
  /**
   * Format the live displayed value and the `aria-valuetext` attribute.
   * Use this for unit-aware screen-reader copy (e.g. "32 percent",
   * "175 km/h", "12.5 kWh"). When omitted, the raw number is used.
   */
  formatValue?: (n: number) => string;
  /**
   * When false, the visible label row is hidden and only the
   * accessible name is exposed via `aria-label`. Defaults to true.
   */
  showLabel?: boolean;
  /** Disable interaction. */
  disabled?: boolean;
  /** Optional id; auto-generated when omitted. */
  id?: string;
  /** Extra classes for the outer wrapper. */
  className?: string;
}

/**
 * Single-thumb slider primitive.
 *
 * Wraps native `<input type="range">` so all keyboard semantics from the
 * WAI-ARIA APG slider pattern work out of the box: ArrowLeft/Right step
 * by `step`, ArrowUp/Down step by `step`, PageUp/Down by ~10% of the
 * range, and Home/End jump to `min`/`max`. The browser also handles
 * touch + drag.
 *
 * Use `formatValue` for unit-aware screen-reader copy — the formatted
 * string is announced via `aria-valuetext`, and the raw number remains
 * in `aria-valuenow` for assistive tech that prefers it.
 *
 * Phase-46 / Prompt 23.
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  {
    value,
    min,
    max,
    step = 1,
    onChange,
    label,
    formatValue,
    showLabel = true,
    disabled,
    id,
    className,
  },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `slider-${reactId}`;

  const display = useMemo(
    () => (formatValue ? formatValue(value) : String(value)),
    [formatValue, value],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.currentTarget.value);
      if (!Number.isNaN(next)) onChange(next);
    },
    [onChange],
  );

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {showLabel && (
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={inputId} className={cn(typography.role.label)}>
            {label}
          </label>
          <Caption className="tabular-nums">{display}</Caption>
        </div>
      )}
      <input
        ref={ref}
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        aria-label={showLabel ? undefined : label}
        aria-valuetext={display}
        className={cn(
          'h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--surface-2)]',
          'accent-cyan-500',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
    </div>
  );
});

Slider.displayName = 'Slider';
