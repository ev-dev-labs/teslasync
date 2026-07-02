import { forwardRef, useCallback, useId, useMemo } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { getLangDir, type Direction } from '@/lib/i18nDir';

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
 * Single-thumb slider primitive, built on Radix UI's `Slider` primitive
 * (the WAI-ARIA slider pattern) instead of a bare `<input type="range">`.
 * Radix owns the verified `role="slider"` / `aria-value*` contract, full
 * keyboard support (ArrowLeft/Right/Up/Down step by `step`, Shift+Arrow
 * and PageUp/PageDown step by 10x `step`, Home/End jump to `min`/`max`),
 * and pointer handling for both mouse drag and touch/click-on-track —
 * this file only owns the visual layer (Radix primitives render
 * unstyled).
 *
 * Accessibility:
 * - The thumb is a real focusable `<span role="slider" tabIndex={0}>`
 *   carrying `aria-valuemin`/`aria-valuenow`/`aria-valuemax` from Radix,
 *   plus `aria-valuetext` from this component for unit-aware
 *   screen-reader copy via `formatValue` — matching the previous
 *   native-input contract exactly.
 * - The visible `label` text is a plain `<span>`, not a native `<label>`:
 *   `<label for>` only auto-associates with *labelable* HTML elements
 *   (input/select/textarea/button/etc.) per the HTML spec, and Radix's
 *   thumb renders a `<span>`, so `htmlFor` would silently do nothing.
 *   Instead the label span carries an `id` and the thumb points back to
 *   it via `aria-labelledby` — the correct pattern for ARIA widgets, and
 *   the same one this codebase's Radix-based `<Toggle>` already uses.
 * - When `showLabel` is false, the label row (and its `id`) isn't
 *   rendered at all, so the accessible name is supplied directly via
 *   `aria-label` on the thumb instead — unchanged from the previous
 *   contract.
 * - `dir` is resolved from the active i18n language (matching the
 *   `getLangDir`/`<html dir>` convention used across the app, see
 *   `@/lib/i18nDir`) and passed to Radix explicitly. Radix's own
 *   direction detection defaults to `"ltr"` unless a `dir` prop or a
 *   `DirectionProvider` ancestor is present — this app sets direction
 *   via `<html dir>` only, so without this the arrow-key and
 *   drag-from-pointer math would stay LTR-oriented even while the rest
 *   of the page mirrors for Arabic/Hebrew/Persian/Urdu.
 *
 * Mobile: `touch-none` on the root prevents the browser from hijacking
 * the drag gesture for page scroll/pinch-zoom while dragging the thumb,
 * and the thumb's hit target is invisibly expanded to the 44×44px WCAG
 * 2.5.5 / mobile tap-target minimum via a `before` pseudo element,
 * without inflating the compact 16px visual thumb size.
 *
 * Layout: matches `<Input>`/`<Select>` (md size) — same label style
 * (`text-sm text-secondary`) and same overall row height so a Slider
 * dropped into a form grid alongside other controls aligns vertically.
 */
export const Slider = forwardRef<HTMLSpanElement, SliderProps>(function Slider(
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
  const { i18n } = useTranslation();
  const dir: Direction = getLangDir(i18n.language);
  const reactId = useId();
  const inputId = id ?? `slider-${reactId}`;
  const labelId = `${inputId}-label`;

  const display = useMemo(
    () => (formatValue ? formatValue(value) : String(value)),
    [formatValue, value],
  );

  // Radix's Root supports multiple thumbs, so its value/onValueChange
  // contract works over an array even though this component only ever
  // renders a single thumb. Memoised so a fresh array isn't created on
  // every render (this feeds directly into Radix's own prop diffing).
  const sliderValue = useMemo(() => [value], [value]);

  const handleValueChange = useCallback(
    ([next]: number[]) => {
      if (next !== undefined) onChange(next);
    },
    [onChange],
  );

  return (
    <div className={cn('space-y-1', className)}>
      {showLabel && (
        <div className="flex items-baseline justify-between gap-2">
          <span
            id={labelId}
            className="text-sm font-medium text-[var(--text-secondary)]"
          >
            {label}
          </span>
          <span className="text-xs text-[var(--text-muted)] tabular-nums">
            {display}
          </span>
        </div>
      )}
      {/* Track wrapper matches the height of an md <Input>/<Select>
          (~36px, h-9) so the slider visually aligns with adjacent
          form controls in the same grid row. */}
      <div className="flex h-9 items-center">
        <SliderPrimitive.Root
          dir={dir}
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          onValueChange={handleValueChange}
          disabled={disabled}
          className={cn(
            'relative flex w-full touch-none select-none items-center',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
        >
          <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-[var(--glass-border)]">
            <SliderPrimitive.Range className="absolute h-full rounded-full bg-cyan-500" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            ref={ref}
            id={inputId}
            aria-label={showLabel ? undefined : label}
            aria-labelledby={showLabel ? labelId : undefined}
            aria-valuetext={display}
            className={cn(
              'relative block h-4 w-4 shrink-0 rounded-full bg-cyan-500 shadow-sm',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
              // Invisible 44x44 hit-slop centered on the compact 16px
              // visual thumb (WCAG 2.5.5 / mobile tap-target guidance)
              // so the drag/tap target meets the mobile minimum without
              // inflating the artwork. Mirrors <Toggle>'s hit-slop trick.
              "before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
              // Forced-colors mode flattens the cyan fill to a system
              // colour; a system-colour border keeps the thumb visible
              // and distinguishable from the track under Windows High
              // Contrast, matching <Toggle>'s thumb treatment.
              'forced-colors:border forced-colors:border-[ButtonBorder]',
              disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
            )}
          />
        </SliderPrimitive.Root>
      </div>
    </div>
  );
});

Slider.displayName = 'Slider';
