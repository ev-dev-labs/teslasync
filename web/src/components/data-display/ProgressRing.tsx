import { forwardRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  /** Text rendered below the ring (legacy). Prefer `centerLabel` for the
   *  primary value — it sits inside the ring and reads like a real gauge. */
  label?: string;
  /** Short text rendered inside the ring, perfectly centered. Sized
   *  proportionally to the ring so callers don't need to tune it. */
  centerLabel?: ReactNode;
  /** Optional secondary text rendered just below `centerLabel`, also
   *  inside the ring (e.g. "kWh", "of 100"). Kept smaller than the main
   *  label and respects the ring color. */
  centerSubLabel?: ReactNode;
  className?: string;
}

export const ProgressRing = forwardRef<HTMLDivElement, ProgressRingProps>(
  function ProgressRing(
    {
      value,
      max = 100,
      size = 48,
      strokeWidth = 4,
      color = '#3b82f6',
      label,
      centerLabel,
      centerSubLabel,
      className,
    },
    ref,
  ) {
    const radius = (size - strokeWidth) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(value, max));
    const offset = circumference - (clamped / max) * circumference;
    const hasCenter = centerLabel != null || centerSubLabel != null;
    const mainSize = Math.max(10, Math.round(size * 0.32));
    const subSize = Math.max(8, Math.round(size * 0.18));

    return (
      <div ref={ref} className={cn('inline-flex flex-col items-center gap-1', className)}>
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              className="text-gray-200 dark:text-gray-700"
            />
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-slow"
            />
          </svg>
          {hasCenter && (
            <div
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none"
              aria-hidden="true"
            >
              {centerLabel != null && (
                <span
                  className="font-semibold tabular-nums text-[var(--text-primary)]"
                  style={{ fontSize: `${mainSize}px` }}
                >
                  {centerLabel}
                </span>
              )}
              {centerSubLabel != null && (
                <span
                  className="mt-0.5 uppercase tracking-wide text-[var(--text-muted)]"
                  style={{ fontSize: `${subSize}px` }}
                >
                  {centerSubLabel}
                </span>
              )}
            </div>
          )}
        </div>
        {label && (
          <span className="text-xs font-medium text-[var(--text-muted)] dark:text-[var(--text-muted)]">{label}</span>
        )}
      </div>
    );
  },
);
