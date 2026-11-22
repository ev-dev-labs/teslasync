import { forwardRef, useCallback, useId, useMemo } from 'react';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { Caption, Text } from './Typography';

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
 * The native control owns thumb/track geometry and keyboard handling.
 * Its mobile hit area is 44px; desktop retains the 36px form row.
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
  const endpoints = useMemo(
    () => showLabel ? [formatValue?.(min) ?? String(min), formatValue?.(max) ?? String(max)] : null,
    [formatValue, max, min, showLabel],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.currentTarget.value);
      if (!Number.isNaN(next)) onChange(next);
    },
    [onChange],
  );

  return (
    <div data-app-part="field" data-app-field-kind="range" className={cn(
      'min-w-0',
      showLabel && 'rounded-shape-sm border border-[var(--control-border)] bg-[var(--surface-1)] px-3 py-2',
      className,
    )}>
      {showLabel && (
        <div className="grid min-w-0 gap-1">
          <label
            htmlFor={inputId}
            data-app-part="field-label"
            className={cn(typography.role.subhead, 'min-w-0 break-words')}
          >
            {label}
          </label>
          <Text size="lg" weight="semibold" color="primary" className="min-w-0 break-words tabular-nums" aria-hidden="true">
            {display}
          </Text>
        </div>
      )}
      <div className="flex h-11 items-center md:h-9">
        <input
          ref={ref}
          data-app-part="field-control"
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
            'h-full min-w-11 w-full cursor-pointer appearance-auto bg-transparent',
            'accent-[var(--theme-primary)]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
      </div>
      {endpoints && (
        <div className="grid min-w-0 grid-cols-2 gap-2" aria-hidden="true">
          <Caption className="break-words tabular-nums">{endpoints[0]}</Caption>
          <Caption className="break-words text-end tabular-nums">{endpoints[1]}</Caption>
        </div>
      )}
    </div>
  );
});

Slider.displayName = 'Slider';
