import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Text } from '@/components/ui/Typography';
import { fmtNumber, getGlobalPrecision } from '@/lib/numberFormat';
import { resolveGaugeColor, type GaugeTone } from '@/lib/tokens';

export interface LinearGaugeProps {
  value: number;
  max: number;
  /**
   * Start of the scale. Defaults to 0 (a plain 0→max magnitude bar).
   *
   * Set this for **interval** scales whose zero is arbitrary — temperature in
   * °F being the motivating case. A 0→max bar reads the fill as `value / max`,
   * which is only meaningful when zero means "none of the quantity". 49 °C on a
   * 0–150 °C scale is 33% full, but the same reading in Fahrenheit (120 °F on a
   * 0–302 °F scale) is 40% full — the fill silently changed meaning with the
   * user's unit preference. Passing the converted `min` too makes the offset
   * cancel out of `(value - min) / (max - min)` so both units draw the same bar.
   *
   * For **signed** quantities (torque, axle speed) prefer BipolarBar — this
   * gauge has no way to express direction.
   */
  min?: number;
  label: string;
  /**
   * Accessible name for the meter when {@link label} is intentionally blank —
   * e.g. a gauge inside a tile that already carries a visible heading. Without
   * it such a meter is announced as bare, context-free digits.
   */
  ariaLabel?: string;
  unit?: string;
  /**
   * Semantic fill colour, resolved through the central `gaugeTone` map in
   * `@/lib/tokens`.
   *
   * Prefer this over {@link color} for anything that carries MEANING —
   * `success` / `warning` / `danger` for status readings, `primary` /
   * `accent` for headline brand gauges. The theme tones resolve through the
   * CSS variables the ThemeProvider rewrites, so warm / light / custom presets
   * re-tint the bar instead of leaving a hardcoded blue behind.
   *
   * Takes precedence over {@link color} when both are supplied.
   */
  tone?: GaugeTone;
  /**
   * Raw CSS colour escape hatch, kept for genuinely caller-defined series
   * colours (a per-series bar matching its chart line) and for backwards
   * compatibility. Ignored when {@link tone} is set.
   */
  color?: string;
  /**
   * Visual weight, carried over from the radial gauge this replaced, where it
   * was a pixel diameter. A bar has no diameter, so it maps to the readout size
   * and track thickness instead — call sites keep their existing `size={140}`
   * and still get a proportionally prominent gauge.
   */
  size?: number;
  decimals?: number;
  /**
   * Suppress the printed scale caption for callers that already state the
   * ceiling themselves (e.g. a badge reading "7/9 enabled" beside the gauge).
   */
  hideScale?: boolean;
  /**
   * Draw a reference tick at this value on the track — a target, limit or
   * threshold the reading is meant to be compared against (e.g. the configured
   * charge limit behind a battery level). Ignored when non-finite or outside
   * the scale.
   */
  marker?: number;
  /** Accessible description of {@link marker}, surfaced as its tooltip. */
  markerLabel?: string;
  className?: string;
}

/** Coerce a possibly non-finite / nullish runtime value to a finite number. */
const toFinite = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * A reading drawn against a scale you can actually see.
 *
 * This replaced the app's radial gauges. A ring encodes magnitude as arc
 * length around a circle whose end is invisible: the reader sees three-quarters
 * of a circle and cannot tell whether the whole is 250 kW, 150 °C or 1500
 * cycles, because that ceiling lived only in `aria-valuemax`. Worse, the
 * circle has no landmarks, so two readings 40% apart look similar and four
 * tyres at slightly different pressures looked identical.
 *
 * A horizontal track fixes both problems structurally rather than cosmetically:
 * the far edge is a visible boundary, the fill is directly comparable between
 * stacked gauges, and the numeric ends of the scale are printed beneath it. The
 * bar is only used where a full track is a real, reachable state — for readings
 * with no meaningful maximum use MetricTile, and for readings whose meaning is
 * qualitative (safe / low / critical) use ThresholdBar.
 *
 * Exposed to assistive tech as an ARIA `meter` so the reading is announced with
 * its range instead of as bare, context-free digits.
 */
export const LinearGauge = forwardRef<HTMLDivElement, LinearGaugeProps>(
  function LinearGauge(
    { value, max, min = 0, label, ariaLabel, unit, tone, color, size = 120, decimals, hideScale, marker, markerLabel, className },
    ref,
  ) {
    // Semantic tone wins over the raw colour escape hatch (see
    // `resolveGaugeColor`), and an unspecified gauge falls back to the theme
    // primary rather than a hardcoded blue.
    const fillColor = resolveGaugeColor(tone, color);
    // Null-safety: callers routinely forward optional API values (e.g.
    // `state.battery_level`) that can be undefined / null / NaN at runtime
    // despite the `number` type. Sanitising here keeps the fill geometry finite
    // — an unguarded NaN value, a NaN `max`, or a zero `max` (0 / 0) would
    // otherwise produce `width: NaN%` and blank the track.
    const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
    // A `min` at or above the top of the scale would invert the range, so it
    // falls back to 0 (the default 0→max behaviour) rather than producing a
    // negative span and a bar that grows the wrong way.
    const safeMin = Number.isFinite(min) && min < safeMax ? min : 0;
    const span = safeMax - safeMin;
    const clamped = Math.max(safeMin, Math.min(toFinite(value), safeMax));
    const ratio = span > 0 ? (clamped - safeMin) / span : 0;
    const d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision());
    const display = fmtNumber(clamped, d);

    // A percentage scale needs no caption: the reader already knows a full
    // track is "all of it". Percent-ness is a property of the UNIT, not of the
    // numbers — a 0–100 °C scale looks identical but ends at an arbitrary
    // ceiling, so it must still state its range.
    const unitText = (unit ?? '').trim();
    // Several callers signal "no reading yet" by swapping the unit for a dash
    // placeholder (`unit={temp != null ? tempUnit : '—'}`). That is the absence
    // of a unit, not a unit, so it must neither be appended to the caption
    // ("0 – 150—") nor counted as a distinguishing unit.
    const isPlaceholderUnit = unitText === '' || /^[—–-]+$/.test(unitText);
    const isFullSpan = safeMin === 0 && safeMax === 100;
    const isPercentScale = isFullSpan && (unitText === '%' || isPlaceholderUnit);
    const showScale = !hideScale && !isPercentScale && span > 0;
    const unitSuffix = isPlaceholderUnit ? '' : unit ?? '';

    const valueSize = size >= 160 ? '3xl' : size >= 110 ? '2xl' : 'lg';
    const trackHeight = size >= 160 ? 'h-3' : size >= 110 ? 'h-2.5' : 'h-2';

    // A reference tick is only drawable on a real span, and only where it would
    // actually land on the track — an out-of-range limit is dropped rather than
    // pinned to an edge, where it would read as a limit the vehicle can reach.
    const markerRatio =
      marker != null && Number.isFinite(marker) && span > 0 && marker >= safeMin && marker <= safeMax
        ? (marker - safeMin) / span
        : null;

    return (
      <div
        ref={ref}
        role="meter"
        aria-label={ariaLabel || label || undefined}
        aria-valuenow={clamped}
        aria-valuemin={safeMin}
        aria-valuemax={safeMax}
        aria-valuetext={unit ? `${display}${unit}` : display}
        className={cn('flex w-full min-w-0 flex-col gap-1.5', className)}
      >
        <div className="flex items-baseline gap-1">
          <Text as="span" size={valueSize} weight="bold" color="primary" className="tabular-nums">
            {display}
          </Text>
          {unit && (
            <Text as="span" size="sm" color="muted">
              {unit}
            </Text>
          )}
        </div>

        <div className={cn('relative w-full overflow-hidden rounded-full bg-[var(--surface-2)]', trackHeight)}>
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${ratio * 100}%`, backgroundColor: fillColor }}
          />
          {markerRatio !== null && (
            <span
              data-testid="gauge-marker"
              title={markerLabel}
              className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-[var(--text-primary)]/70"
              style={{ left: `${markerRatio * 100}%` }}
            />
          )}
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <Text as="span" size="xs" weight="medium" color="muted" className="min-w-0 truncate">
            {label}
          </Text>
          {showScale && (
            <Text as="span" size="2xs" color="muted" className="shrink-0 tabular-nums">
              {`${fmtNumber(safeMin, 0)} – ${fmtNumber(safeMax, 0)}${unitSuffix}`}
            </Text>
          )}
        </div>
      </div>
    );
  },
);
