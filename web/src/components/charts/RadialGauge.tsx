import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Text } from '@/components/ui/Typography';
import { fmtNumber, getGlobalPrecision } from '@/lib/numberFormat';

interface RadialGaugeProps {
  value: number;
  max: number;
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
    { value, max, label, unit, color = '#3b82f6', size = 120, decimals, className },
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
    const clamped = Math.max(0, Math.min(toFinite(value), safeMax));
    const ratio = safeMax > 0 ? clamped / safeMax : 0;
    const offset = circumference - ratio * circumference;
    const d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision());
    const display = fmtNumber(clamped, d);

    return (
      <div
        ref={ref}
        role="meter"
        aria-label={label || undefined}
        aria-valuenow={clamped}
        aria-valuemin={0}
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
              strokeLinecap="round"
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
