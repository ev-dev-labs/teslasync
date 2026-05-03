import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  className?: string;
}

export const ProgressRing = forwardRef<HTMLDivElement, ProgressRingProps>(
  function ProgressRing(
    { value, max = 100, size = 48, strokeWidth = 4, color = '#3b82f6', label, className },
    ref,
  ) {
    const radius = (size - strokeWidth) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(value, max));
    const offset = circumference - (clamped / max) * circumference;

    return (
      <div ref={ref} className={cn('inline-flex flex-col items-center gap-1', className)}>
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
            className="transition-all duration-500"
          />
        </svg>
        {label && (
          <span className="text-xs font-medium text-[var(--text-muted)] dark:text-[var(--text-muted)]">{label}</span>
        )}
      </div>
    );
  },
);
