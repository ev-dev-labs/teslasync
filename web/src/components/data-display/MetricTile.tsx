import { forwardRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Text } from '@/components/ui/Typography';
import { fmtNumber, getGlobalPrecision } from '@/lib/numberFormat';

export interface MetricTileProps {
  /** The reading. Non-finite / nullish values degrade to an em-dash. */
  value: number | string | null | undefined;
  /** Unit suffix, rendered small and muted next to the value. */
  unit?: string;
  /** Caption below the value. */
  label: string;
  /** Optional second line for context (e.g. "across 42 sessions"). */
  sublabel?: ReactNode;
  /** Decimal places when `value` is numeric. Defaults to global precision. */
  decimals?: number;
  /** Tailwind text colour for the reading. Defaults to primary text. */
  accentClass?: string;
  /** Left-align instead of centring — for stacked lists rather than strips. */
  align?: 'center' | 'start';
  className?: string;
}

/**
 * A magnitude with no meaningful maximum.
 *
 * Counterpart to {@link RadialGauge}: use a ring only when 100% is a real,
 * reachable state (a full battery, a complete score). Totals, counts, costs and
 * durations have no such whole, and the codebase repeatedly papered over that
 * by deriving the ceiling from the reading itself — `max={Math.max(count, 50)}`
 * pins the ring at exactly 100% for every count above 50, and
 * `max={value * 1.5}` pins it at exactly 66.7% for every value. Both draw an
 * identical arc no matter what the number is, so the ring costs pixels and
 * attention while carrying no information.
 *
 * This renders the number as the number it is. Pair it with `<Delta>` in
 * `sublabel` when a real baseline exists, or with {@link ThresholdBar} instead
 * when the value has genuine qualitative thresholds.
 */
export const MetricTile = forwardRef<HTMLDivElement, MetricTileProps>(function MetricTile(
  { value, unit, label, sublabel, decimals, accentClass, align = 'center', className },
  ref,
) {
  const isNumeric = typeof value === 'number';
  const hasValue = isNumeric
    ? Number.isFinite(value)
    : typeof value === 'string' && value !== '';

  const display = hasValue
    ? isNumeric
      ? fmtNumber(value, decimals ?? (Number.isInteger(value) ? 0 : getGlobalPrecision()))
      : String(value)
    : '—';

  return (
    <div
      ref={ref}
      className={cn(
        'flex min-w-0 flex-col gap-1',
        align === 'center' ? 'items-center text-center' : 'items-start',
        className,
      )}
    >
      <div className="flex items-baseline gap-1">
        <Text
          as="span"
          size="2xl"
          weight="bold"
          className={cn(hasValue ? accentClass : 'text-[var(--text-muted)]')}
        >
          {display}
        </Text>
        {unit && hasValue ? (
          <Text as="span" size="xs" weight="regular" color="muted">
            {unit}
          </Text>
        ) : null}
      </div>
      <Text as="span" size="xs" weight="medium" color="muted">
        {label}
      </Text>
      {sublabel ? (
        <Text as="span" size="xs" color="muted">
          {sublabel}
        </Text>
      ) : null}
    </div>
  );
});
