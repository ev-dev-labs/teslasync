import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Text } from '@/components/ui/Typography';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { gaugeTone } from '@/lib/tokens';

export interface BipolarBarProps {
  /**
   * Signed reading. Negative values fill leftwards from the zero rule.
   * Missing or nonfinite readings show a placeholder without a meter or fill.
   * Readouts retain the raw value; only fill geometry is bounded to the scale.
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
  /** Fill colour for value > 0. */
  positiveColor?: string;
  /** Fill colour for value < 0. */
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
      positiveColor = gaugeTone.info,
      negativeColor = gaugeTone.neutral,
      negativeLabel,
      positiveLabel,
      decimals,
      kind,
      className,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const posSpan = Number.isFinite(max) && max > 0 ? max : 0;
    const negSpanRaw = min === undefined ? posSpan : min;
    const negSpan = Number.isFinite(negSpanRaw) && negSpanRaw > 0 ? negSpanRaw : 0;
    const span = posSpan + negSpan;

    // Named rather than inlined as `-negSpan`: jsx-a11y/aria-proptypes
    // statically evaluates ARIA numeric props and cannot resolve a unary
    // expression, and the signed lower bound reads better with a name.
    const lowerBound = -negSpan;

    const reading = typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
    const geometryValue = reading === undefined
      ? undefined : Math.max(lowerBound, Math.min(reading, posSpan));
    const validScale = posSpan > 0 && negSpan > 0 && Number.isFinite(span);
    const outsideScale = reading !== undefined && validScale &&
      (reading < lowerBound || reading > posSpan);
    const hasMeter = reading !== undefined && validScale && !outsideScale;

    // Fraction of the full track occupied by the negative half, i.e. where the
    // zero rule sits. A zero-width scale collapses the rule to the left edge
    // rather than dividing by zero.
    const zeroPct = span > 0 && Number.isFinite(span) ? (negSpan / span) * 100 : 0;
    const magnitudePct = geometryValue !== undefined && span > 0 && Number.isFinite(span)
      ? (Math.abs(geometryValue) / span) * 100 : 0;

    const isNegative = reading !== undefined && reading < 0;
    const color = isNegative ? negativeColor : positiveColor;
    const displayUnit = unit?.trim();
    const { fmtNumber, fmtInt } = useNumberFormatting();
    const isCount = kind === 'count' || (kind == null && !unit && Number.isInteger(reading));
    const display = reading === undefined ? '—' : decimals == null && isCount
      ? fmtInt(reading) : fmtNumber(reading, decimals);
    const scaleContext = outsideScale ? t('widget.motorPerformance.outsideScale',
      'Reading outside displayed scale ({{min}} to {{max}} {{unit}})', {
        min: fmtNumber(lowerBound, decimals),
        max: fmtNumber(posSpan, decimals),
        unit: displayUnit ?? '',
      }) : undefined;

    return (
      <div
        ref={ref}
        role={hasMeter ? 'meter' : 'group'}
        aria-label={label || undefined}
        aria-valuenow={hasMeter ? reading : undefined}
        aria-valuemin={hasMeter ? lowerBound : undefined}
        aria-valuemax={hasMeter ? posSpan : undefined}
        aria-valuetext={hasMeter ? displayUnit ? `${display} ${displayUnit}` : display : undefined}
        aria-description={scaleContext
          ? `${display}${displayUnit ? ` ${displayUnit}` : ''} ${scaleContext}`
          : undefined}
        className={cn('flex w-full flex-col gap-1.5', className)}
      >
        <div className="flex items-baseline justify-between gap-2">
          <Text as="span" size="xs" weight="medium" color="muted">
            {label}
          </Text>
          <Text as="span" size="lg" weight="bold" color="primary">
            {display}
            {reading !== undefined && displayUnit && (
              <Text as="span" size="xs" weight="regular" color="muted">
                {' '}{displayUnit}
              </Text>
            )}
            {scaleContext && (
              <Text as="span" size="xs" weight="regular" color="muted" className="block">
                {' '}
                {scaleContext}
              </Text>
            )}
          </Text>
        </div>

        <div data-bipolar-track className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)] forced-colors:[outline-style:solid] forced-colors:outline-1 forced-colors:outline-[CanvasText] forced-colors:!bg-[Canvas] forced-colors:[forced-color-adjust:none]">
          {reading !== undefined && <div
            data-bipolar-fill
            className="absolute inset-y-0 rounded-full transition-all duration-slow forced-colors:!bg-[Highlight] forced-colors:!bg-none forced-colors:[forced-color-adjust:none]"
            style={{
              // Anchor the fill at the zero rule and grow it outwards. A
              // negative reading starts `magnitudePct` to the LEFT of zero;
              // a positive one starts at zero.
              left: `${isNegative ? zeroPct - magnitudePct : zeroPct}%`,
              width: `${magnitudePct}%`,
              backgroundColor: color,
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
