import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Text } from '@/components/ui/Typography';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface BipolarBarProps {
  /**
   * Signed reading. Negative values fill leftwards from the zero rule.
   * Missing or nonfinite readings show a placeholder without a meter or fill.
   */
  value?: number | null;
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
  /** Unit-bearing values default to measurements; use count for counted units. */
  kind?: 'measurement' | 'count';
  className?: string;
}

/**
 * Zero-centred horizontal bar for a **signed** measurement.
 *
 * A single-direction gauge cannot express sign — it clamps at zero, so regenerative
 * braking (negative torque) and reverse (negative axle speed) render exactly
 * like a stationary car. This renders the sign as direction: the fill grows
 * right of the zero rule when positive and left of it when negative, so the
 * two states are never confusable.
 *
 * Use this for any quantity whose sign carries meaning (torque, axle speed,
 * longitudinal/lateral acceleration, net power). Keep {@link LinearGauge} for
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
      kind,
      className,
    },
    ref,
  ) {
    const posSpan = Number.isFinite(max) && max > 0 ? max : 0;
    const negSpanRaw = min === undefined ? posSpan : min;
    const negSpan = Number.isFinite(negSpanRaw) && negSpanRaw > 0 ? negSpanRaw : 0;
    const span = posSpan + negSpan;

    // Named rather than inlined as `-negSpan`: jsx-a11y/aria-proptypes
    // statically evaluates ARIA numeric props and cannot resolve a unary
    // expression, and the signed lower bound reads better with a name.
    const lowerBound = -negSpan;

    const clamped = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(lowerBound, Math.min(value, posSpan))
      : undefined;

    // Fraction of the full track occupied by the negative half, i.e. where the
    // zero rule sits. A zero-width scale collapses the rule to the left edge
    // rather than dividing by zero.
    const zeroPct = span > 0 ? (negSpan / span) * 100 : 0;
    const magnitudePct = clamped !== undefined && span > 0
      ? (Math.abs(clamped) / span) * 100 : 0;

    const isNegative = clamped !== undefined && clamped < 0;
    const color = isNegative ? negativeColor : positiveColor;
    const { fmtNumber, fmtInt } = useNumberFormatting();
    const isCount = kind === 'count' || (kind == null && !unit && Number.isInteger(clamped));
    const display = clamped === undefined ? '—' : decimals == null && isCount
      ? fmtInt(clamped) : fmtNumber(clamped, decimals);

    return (
      <div
        ref={ref}
        role={clamped === undefined ? 'group' : 'meter'}
        aria-label={label || undefined}
        aria-valuenow={clamped}
        aria-valuemin={clamped === undefined ? undefined : lowerBound}
        aria-valuemax={clamped === undefined ? undefined : posSpan}
        aria-valuetext={clamped === undefined ? undefined : unit ? `${display}${unit}` : display}
        className={cn('flex w-full flex-col gap-1.5', className)}
      >
        <div className="flex items-baseline justify-between gap-2">
          <Text as="span" size="xs" weight="medium" color="muted">
            {label}
          </Text>
          <Text as="span" size="lg" weight="bold" color="primary">
            {display}
            {clamped !== undefined && unit && (
              <Text as="span" size="xs" weight="regular" color="muted">
                {unit}
              </Text>
            )}
          </Text>
        </div>

        <div data-bipolar-track className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)] forced-colors:[outline-style:solid] forced-colors:outline-1 forced-colors:outline-[CanvasText] forced-colors:!bg-[Canvas] forced-colors:[forced-color-adjust:none]">
          {clamped !== undefined && <div
            data-bipolar-fill
            className="absolute inset-y-0 rounded-full transition-all duration-slow forced-colors:!bg-[Highlight] forced-colors:!bg-none forced-colors:[forced-color-adjust:none]"
            style={{
              // Anchor the fill at the zero rule and grow it outwards. A
              // negative reading starts `magnitudePct` to the LEFT of zero;
              // a positive one starts at zero.
              left: `${isNegative ? zeroPct - magnitudePct : zeroPct}%`,
              width: `${magnitudePct}%`,
              background: `linear-gradient(90deg, ${color}99, ${color})`,
            }}
          />}
          <div
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-[var(--border-strong)] forced-colors:!bg-[CanvasText] forced-colors:[forced-color-adjust:none]"
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
