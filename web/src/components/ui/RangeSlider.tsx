import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { getLangDir } from '@/lib/i18nDir';
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
 * Built on Radix UI's `Slider` primitive in range mode (a `value`/
 * `onValueChange` array with two entries renders two independently
 * focusable `Slider.Thumb`s), replacing the previous two-stacked-native-
 * `<input type="range">` implementation. Radix supplies, for free,
 * everything the hand-rolled version had to build manually:
 *
 * - Full WAI-ARIA "slider" role per thumb, with `aria-valuemin`/
 *   `aria-valuenow`/`aria-valuemax` kept in sync automatically. This
 *   component layers `aria-valuetext` on top (via `formatValue`) exactly
 *   as before, since Radix doesn't know about unit-aware display text.
 * - Multi-thumb keyboard semantics per the WAI-ARIA APG "Slider (Multi-
 *   Thumb)" pattern: each thumb is its own `tabIndex=0` stop (Tab/
 *   Shift+Tab move between the two thumbs, and out of the control
 *   entirely, like any other pair of focusable elements — there is no
 *   roving tabindex and no focus trap for this pattern, same rationale
 *   as `TabNav`'s "Escape/focus-trap don't apply" note). On a focused
 *   thumb: ArrowUp/ArrowRight increment by `step`, ArrowDown/ArrowLeft
 *   decrement, Home/End jump to `min`/`max`, PageUp/PageDown jump by
 *   10×`step`. Arrow-key left/right meaning mirrors automatically in
 *   RTL because `dir` is threaded through below.
 * - Thumb-swap: Radix's internal `updateValues` re-sorts the whole
 *   values array on every change (ascending), so dragging the low thumb
 *   past the high thumb (or vice versa) already yields the same sorted
 *   `[low, high]` tuple the old manual swap logic produced — no extra
 *   sorting needed in `handleValueChange` below. Focus follows the
 *   thumb whose value actually moved, matching the previous behaviour.
 * - Pointer/touch dragging via the Pointer Events API (works uniformly
 *   across mouse, touch and pen) with `touch-none` on the root so a
 *   vertical touch-drag on the thumb can't also pan the page.
 *
 * RTL: Radix's own direction detection only reads an explicit `dir` prop
 * or a `DirectionProvider` context (never the ambient `document.dir`
 * this app sets via `applyDocumentDirection`), so `dir` is resolved from
 * the active i18n language the same way `useChartLabelAnchor` does in
 * `ChartContainer.tsx` and threaded into `Slider.Root` explicitly —
 * otherwise arrow-key direction and pointer-drag math would silently
 * stay LTR for Arabic/Hebrew/Persian/Urdu users even though the track
 * visually mirrors (flex layout mirrors for free from the inherited
 * `dir`; the slide-value *math* does not).
 *
 * Touch targets: the visual thumb stays a small 16px dot (matching the
 * original native-thumb footprint) but gets `.touch-target-overlay`
 * (see `index.css`), the same invisible ≥44px hit-area extender used by
 * `TimelineScrubber`'s marker handles, so mobile dragging doesn't
 * require pixel-perfect precision on a visually tiny target.
 *
 * Stacking: mirrors the old "closer-to-the-far-edge wins" trick via an
 * explicit `zIndex` style per thumb (Radix has no built-in equivalent)
 * so the low thumb stays reachable once it crosses the midpoint toward
 * the high thumb's side, and vice versa.
 *
 * Forced-colors (Windows High Contrast): the previous version hid its
 * decorative fill divs and let the *native* `<input>` render its own
 * high-contrast slider chrome. Since the track/range/thumb are now this
 * component's own styled elements rather than native controls, each one
 * pins an explicit system colour instead so the control stays visible
 * and legible with OS colours forced.
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
  const { t, i18n } = useTranslation();
  const dir = getLangDir(i18n.language);
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

  const handleValueChange = useCallback(
    (next: number[]) => {
      const nextLow = next[0] ?? min;
      const nextHigh = next[1] ?? max;
      onChange([nextLow, nextHigh]);
    },
    [onChange, min, max],
  );

  // When the low thumb is past the midpoint, render it on top so the
  // user can still grab it when the two thumbs collide near the right
  // edge. Symmetrical for the high thumb near the left edge.
  const range = max - min;
  const lowPct = range > 0 ? Math.max(0, Math.min(100, ((low - min) / range) * 100)) : 0;
  const lowOnTop = lowPct > 50;

  const thumbClasses = cn(
    'touch-target-overlay block h-4 w-4 rounded-full border-2 border-[var(--surface-1)] bg-cyan-500 shadow-sm transition-transform',
    'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
    'forced-colors:border-[ButtonText] forced-colors:bg-[Highlight]',
    disabled
      ? 'cursor-not-allowed opacity-50'
      : 'cursor-grab hover:scale-110 active:scale-125 active:cursor-grabbing',
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
      <SliderPrimitive.Root
        className="relative flex h-6 w-full touch-none select-none items-center"
        dir={dir}
        min={min}
        max={max}
        step={step}
        value={[low, high]}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SliderPrimitive.Track className="relative h-1 w-full grow rounded-full bg-[var(--surface-2)] forced-colors:border forced-colors:border-[CanvasText]">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-cyan-500/60 forced-colors:bg-[Highlight]" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          id={lowId}
          aria-label={ariaLow}
          aria-valuetext={displayLow}
          style={{ zIndex: lowOnTop ? 20 : 10 }}
          className={thumbClasses}
        />
        <SliderPrimitive.Thumb
          id={highId}
          aria-label={ariaHigh}
          aria-valuetext={displayHigh}
          style={{ zIndex: lowOnTop ? 10 : 20 }}
          className={thumbClasses}
        />
      </SliderPrimitive.Root>
    </div>
  );
}

RangeSlider.displayName = 'RangeSlider';
