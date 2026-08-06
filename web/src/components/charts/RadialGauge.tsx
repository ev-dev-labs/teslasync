import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Text } from '@/components/ui/Typography';
import { fmtNumber, getGlobalPrecision } from '@/lib/numberFormat';

interface RadialGaugeProps {
  value: number;
  max: number;
  /**
   * Start of the scale. Defaults to 0 (a plain 0→max magnitude ring).
   *
   * Set this for **interval** scales whose zero is arbitrary — a
   * temperature in °F being the motivating case. A 0→max ring reads the
   * fill as `value / max`, which is only meaningful when zero means "none
   * of the quantity". 49 °C on a 0–150 °C ring is 33% full, but the same
   * reading in Fahrenheit (120 °F on a 0–302 °F ring) is 40% full — the
   * ring silently changed meaning with the user's unit preference.
   * Passing the converted `min` as well makes the offset cancel out of
   * `(value - min) / (max - min)` so both units draw the same arc.
   *
   * For **signed** quantities (torque, axle speed) prefer BipolarBar —
   * this gauge has no way to express direction.
   */
  min?: number;
  label: string;
  unit?: string;
  color?: string;
  size?: number;
  decimals?: number;
  className?: string;
}

const STROKE_WIDTH = 8;

/** Coerce a possibly non-finite / nullish runtime value to a finite number. */
const toFinite = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * Radial progress gauge — a static SVG ring with a centred numeric readout and
 * a caption below. Exposed to assistive tech as an ARIA `meter` (the same
 * pattern as BatteryPill / ClimatePanel) so the reading is announced with its
 * range instead of as bare, context-free digits.
 */
export const RadialGauge = forwardRef<HTMLDivElement, RadialGaugeProps>(
  function RadialGauge(
    { value, max, min = 0, label, unit, color = '#3b82f6', size = 120, decimals, className },
    ref,
  ) {
    const radius = (size - STROKE_WIDTH) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;

    // Null-safety: callers routinely forward optional API values (e.g.
    // `state.battery_level`) that can be undefined / null / NaN at runtime
    // despite the `number` type. Sanitising here keeps the arc geometry finite —
    // an unguarded NaN value, a NaN `max`, or a zero `max` (0 / 0) previously
    // produced `strokeDashoffset={NaN}`, blanking the ring.
    const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
    // A `min` at or above the top of the scale would invert the range, so it
    // falls back to 0 (the default 0→max behaviour) rather than producing a
    // negative span and an arc that grows the wrong way.
    const safeMin = Number.isFinite(min) && min < safeMax ? min : 0;
    const span = safeMax - safeMin;
    const clamped = Math.max(safeMin, Math.min(toFinite(value), safeMax));
    const ratio = span > 0 ? (clamped - safeMin) / span : 0;
    const offset = circumference - ratio * circumference;
    const d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision());
    const display = fmtNumber(clamped, d);

    // A round cap adds half a stroke width of length at each end, so on a
    // near-zero arc the cap IS the entire mark and the gauge renders a
    // floating dot that reads as a position marker rather than a magnitude
    // (a 0.6% brake reading looked like a pip pinned to the top of the ring).
    // Below that length the arc is drawn butt-capped so a tiny value looks
    // like a tiny sliver.
    const arcLength = ratio * circumference;
    const cap = arcLength >= STROKE_WIDTH ? 'round' : 'butt';

    return (
      <div
        ref={ref}
        role="meter"
        aria-label={label || undefined}
        aria-valuenow={clamped}
        aria-valuemin={safeMin}
        aria-valuemax={safeMax}
        aria-valuetext={unit ? `${display}${unit}` : display}
        className={cn('inline-flex flex-col items-center gap-1', className)}
      >
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={STROKE_WIDTH}
              className="text-[var(--border-strong)]"
            />
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap={cap}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-slow"
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Text as="span" size="lg" weight="bold" color="primary">
              {display}
              {unit && (
                <Text as="span" size="xs" weight="regular" color="muted">
                  {unit}
                </Text>
              )}
            </Text>
          </div>
        </div>

        <Text as="span" size="xs" weight="medium" color="muted">
          {label}
        </Text>
      </div>
    );
  },
);
