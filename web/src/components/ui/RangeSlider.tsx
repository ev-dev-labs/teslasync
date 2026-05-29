import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { Caption } from './Typography';

export interface RangeSliderProps {
  /** Current `[low, high]` value. Always normalised so `low <= high`. */
  value: [number, number];
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** Step increment used by Arrow keys and drag. Defaults to 1. */
  step?: number;
  /**
   * Fired with the new `[low, high]` tuple on every change. The component
   * automatically swaps the thumbs when the user drags the low thumb past
   * the high thumb (or vice versa) so the callback always receives a
   * sorted tuple.
   */
  onChange: (range: [number, number]) => void;
  /** Visible label *and* accessible name for the range. Required. */
  label: string;
  /** Format both displayed values and aria-valuetext on each thumb. */
  formatValue?: (n: number) => string;
  /**
   * Override the auto-generated accessible name for the low thumb.
   * Defaults to the i18n string `slider.thumbMin` ("{{label}} minimum").
   */
  minThumbLabel?: string;
  /**
   * Override the auto-generated accessible name for the high thumb.
   * Defaults to the i18n string `slider.thumbMax` ("{{label}} maximum").
   */
  maxThumbLabel?: string;
  /**
   * When false, the visible label/value row is hidden. Defaults to true.
   */
  showLabel?: boolean;
  /** Disable interaction on both thumbs. */
  disabled?: boolean;
  /** Optional id prefix; auto-generated when omitted. */
  id?: string;
  /** Extra classes for the outer wrapper. */
  className?: string;
}

/**
 * Dual-thumb range slider primitive.
 *
 * Built from two stacked native `<input type="range">` elements so every
 * keyboard interaction from the WAI-ARIA APG slider pattern works on
 * each thumb (Arrow keys step by `step`, PageUp/Down by ~10%, Home → min,
 * End → max), and so screen readers announce each thumb individually
 * via `aria-valuetext`.
 *
 * Thumb-swap: if the user drags the low thumb past the high thumb (or
 * vice versa), the callback receives a sorted `[low, high]` tuple and
 * the focused input remains the *new* low or high. This matches the
 * APG-recommended behaviour for range sliders.
 *
 * Stacking trick: each input has `pointer-events: none` on its track and
 * `pointer-events: auto` on its thumb (via `[&::-webkit-slider-thumb]:`
 * and `[&::-moz-range-thumb]:` arbitrary variants), so both thumbs are
 * grabbable even though the inputs overlap. The thumb closer to the
 * far end gets a higher `z-index` so it is always reachable when the
 * thumbs sit on top of each other.
 */
export function RangeSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  formatValue,
  minThumbLabel,
  maxThumbLabel,
  showLabel = true,
  disabled,
  id,
  className,
}: RangeSliderProps) {
  const { t } = useTranslation();
  const reactId = useId();
  const baseId = id ?? `range-${reactId}`;
  const lowId = `${baseId}-low`;
  const highId = `${baseId}-high`;

  const [low, high] = value;

  const displayLow = useMemo(
    () => (formatValue ? formatValue(low) : String(low)),
    [formatValue, low],
  );
  const displayHigh = useMemo(
    () => (formatValue ? formatValue(high) : String(high)),
    [formatValue, high],
  );

  const ariaLow = minThumbLabel ?? t('slider.thumbMin', '{{label}} minimum', { label });
  const ariaHigh = maxThumbLabel ?? t('slider.thumbMax', '{{label}} maximum', { label });

  /**
   * Thumb-swap is enforced by sorting the resulting tuple. When the user
   * drags the low thumb past the high thumb, the callback receives
   * `[high, newLow]` so the high thumb effectively becomes the new low
   * value. The browser keeps focus on the input that initiated the
   * change, so after a swap the focused input is now the *high* thumb.
   */
  const handleLowChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.currentTarget.value);
      if (Number.isNaN(next)) return;
      if (next > high) onChange([high, next]);
      else onChange([next, high]);
    },
    [high, onChange],
  );

  const handleHighChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.currentTarget.value);
      if (Number.isNaN(next)) return;
      if (next < low) onChange([next, low]);
      else onChange([low, next]);
    },
    [low, onChange],
  );

  // Decorative fill positions — kept hidden in forced-colors mode so the
  // native browser-rendered thumbs stand alone.
  const range = max - min;
  const lowPct = range > 0 ? Math.max(0, Math.min(100, ((low - min) / range) * 100)) : 0;
  const highPct = range > 0 ? Math.max(0, Math.min(100, ((high - min) / range) * 100)) : 100;

  // When the low thumb is past the midpoint, render it on top so the
  // user can still grab it when the two thumbs collide near the right
  // edge. Symmetrical for the high thumb near the left edge.
  const lowOnTop = lowPct > 50;

  const inputClasses = cn(
    'pointer-events-none absolute inset-0 h-full w-full appearance-none bg-transparent',
    'accent-cyan-500',
    '[&::-webkit-slider-thumb]:pointer-events-auto',
    '[&::-moz-range-thumb]:pointer-events-auto',
    'focus-visible:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
  );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {showLabel && (
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn(typography.role.label)}>{label}</span>
          <Caption className="tabular-nums">
            {displayLow}
            {' – '}
            {displayHigh}
          </Caption>
        </div>
      )}
      <div className="relative h-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--surface-2)] forced-colors:hidden"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-cyan-500/60 forced-colors:hidden"
          style={{
            left: `${Math.min(lowPct, highPct)}%`,
            right: `${100 - Math.max(lowPct, highPct)}%`,
          }}
        />
        <input
          id={lowId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={low}
          disabled={disabled}
          onChange={handleLowChange}
          aria-label={ariaLow}
          aria-valuetext={displayLow}
          className={cn(inputClasses, lowOnTop ? 'z-20' : 'z-10')}
        />
        <input
          id={highId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={high}
          disabled={disabled}
          onChange={handleHighChange}
          aria-label={ariaHigh}
          aria-valuetext={displayHigh}
          className={cn(inputClasses, lowOnTop ? 'z-10' : 'z-20')}
        />
      </div>
    </div>
  );
}

RangeSlider.displayName = 'RangeSlider';
