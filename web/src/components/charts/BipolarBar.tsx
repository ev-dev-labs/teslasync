import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Text } from '@/components/ui/Typography';
import { fmtNumber, getGlobalPrecision } from '@/lib/numberFormat';

export interface BipolarBarProps {
  /** Signed reading. Negative values fill leftwards from the zero rule. */
  value: number;
  /** Magnitude of the positive end of the scale. Must be > 0. */
  max: number;
  /**
   * Magnitude of the negative end of the scale, as a positive number.
   * Defaults to `max` (a symmetric scale). Powertrain signals are commonly
   * asymmetric — a Model 3 puts down far more drive torque than the regen
   * limit absorbs — so the two ends scale independently and the zero rule
   * sits where the real zero is, not at the midpoint.
   */
  min?: number;
  label: string;
  unit?: string;
  /** Arc colour for value > 0. */
  positiveColor?: string;
  /** Arc colour for value < 0. */
  negativeColor?: string;
  /** Caption rendered under the bar for the negative direction. */
  negativeLabel?: string;
  /** Caption rendered under the bar for the positive direction. */
  positiveLabel?: string;
  decimals?: number;
  className?: string;
}

const toFinite = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * Zero-centred horizontal bar for a **signed** measurement.
 *
 * A radial gauge cannot express sign — it clamps at zero, so regenerative
 * braking (negative torque) and reverse (negative axle speed) render exactly
 * like a stationary car. This renders the sign as direction: the fill grows
 * right of the zero rule when positive and left of it when negative, so the
 * two states are never confusable.
 *
 * Use this for any quantity whose sign carries meaning (torque, axle speed,
 * longitudinal/lateral acceleration, net power). Keep {@link RadialGauge} for
 * quantities that are genuinely a bounded 0→max magnitude (state of charge,
 * pedal position, temperature).
 */
export const BipolarBar = forwardRef<HTMLDivElement, BipolarBarProps>(
  function BipolarBar(
    {
      value,
      max,
      min,
      label,
      unit,
      positiveColor = '#3b82f6',
      negativeColor = '#10b981',
      negativeLabel,
      positiveLabel,
      decimals,
      className,
    },
    ref,
  ) {
    // Null-safety: callers forward optional API values that can be undefined /
    // null / NaN at runtime despite the `number` type. Sanitising here keeps
    // the bar geometry finite rather than emitting `width: NaN%`.
    const posSpan = Number.isFinite(max) && max > 0 ? max : 0;
    const negSpanRaw = min === undefined ? posSpan : min;
    const negSpan = Number.isFinite(negSpanRaw) && negSpanRaw > 0 ? negSpanRaw : 0;
    const span = posSpan + negSpan;

    // Named rather than inlined as `-negSpan`: jsx-a11y/aria-proptypes
    // statically evaluates ARIA numeric props and cannot resolve a unary
    // expression, and the signed lower bound reads better with a name.
    const lowerBound = -negSpan;

    const raw = toFinite(value);
    const clamped = Math.max(lowerBound, Math.min(raw, posSpan));

    // Fraction of the full track occupied by the negative half, i.e. where the
    // zero rule sits. A zero-width scale collapses the rule to the left edge
    // rather than dividing by zero.
    const zeroPct = span > 0 ? (negSpan / span) * 100 : 0;
    const magnitudePct = span > 0 ? (Math.abs(clamped) / span) * 100 : 0;

    const isNegative = clamped < 0;
    const color = isNegative ? negativeColor : positiveColor;
    const d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision());
    const display = fmtNumber(clamped, d);

    return (
      <div
        ref={ref}
        role="meter"
        aria-label={label || undefined}
        aria-valuenow={clamped}
        aria-valuemin={lowerBound}
        aria-valuemax={posSpan}
        aria-valuetext={unit ? `${display}${unit}` : display}
        className={cn('flex w-full flex-col gap-1.5', className)}
      >
        <div className="flex items-baseline justify-between gap-2">
          <Text as="span" size="xs" weight="medium" color="muted">
            {label}
          </Text>
          <Text as="span" size="lg" weight="bold" color="primary">
            {display}
            {unit && (
              <Text as="span" size="xs" weight="regular" color="muted">
                {unit}
              </Text>
            )}
          </Text>
        </div>

        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="absolute inset-y-0 rounded-full transition-all duration-slow"
            style={{
              // Anchor the fill at the zero rule and grow it outwards. A
              // negative reading starts `magnitudePct` to the LEFT of zero;
              // a positive one starts at zero.
              left: `${isNegative ? zeroPct - magnitudePct : zeroPct}%`,
              width: `${magnitudePct}%`,
              background: `linear-gradient(90deg, ${color}99, ${color})`,
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-[var(--border-strong)]"
            style={{ left: `${zeroPct}%` }}
          />
        </div>

        {(negativeLabel || positiveLabel) && (
          <div className="flex items-center justify-between">
            <Text as="span" size="xs" color="muted">
              {negativeLabel ?? ''}
            </Text>
            <Text as="span" size="xs" color="muted">
              {positiveLabel ?? ''}
            </Text>
          </div>
        )}
      </div>
    );
  },
);
