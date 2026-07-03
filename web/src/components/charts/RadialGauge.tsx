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

export const RadialGauge = forwardRef<HTMLDivElement, RadialGaugeProps>(
  function RadialGauge({ value, max, label, unit, color = '#3b82f6', size = 120, decimals, className }, ref) {
    const radius = (size - STROKE_WIDTH) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(value, max));
    const offset = circumference - (clamped / max) * circumference;
    const d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision());

    return (
      <div ref={ref} className={cn('inline-flex flex-col items-center gap-1', className)}>
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

        <div
          className="absolute flex flex-col items-center justify-center"
          style={{ width: size, height: size }}
        >
          <Text as="span" size="lg" weight="bold" color="primary">
            {fmtNumber(clamped, d)}
            {unit && <Text as="span" size="xs" weight="regular" color="muted">{unit}</Text>}
          </Text>
        </div>

        <Text as="span" size="xs" weight="medium" color="muted">{label}</Text>
      </div>
    );
  },
);
