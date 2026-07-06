import { forwardRef, type ReactNode, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  /** Accessible name announced to screen readers for the ring, which is
   *  otherwise a silent SVG (its center text is `aria-hidden`). Pass a
   *  domain-specific name for context (e.g. "Signal freshness"); when
   *  omitted it falls back to a percentage-based label. */
  ariaLabel?: string;
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
      ariaLabel,
    },
    ref,
  ) {
    const { t } = useTranslation();

    // Harden the geometry against the values that actually reach this ring:
    // a `value`/`max` that is still `undefined`, `NaN` or `Infinity` while data
    // loads, a `max` of `0` (division by zero), or a `strokeWidth` wider than
    // `size` (negative radius → invalid SVG). Any of these used to produce a
    // `NaN` stroke-dashoffset that collapses the arc.
    const safeValue = Number.isFinite(value) ? value : 0;
    const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
    const radius = Math.max(0, (size - strokeWidth) / 2);
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(safeValue, safeMax));
    const fraction = clamped / safeMax; // safeMax > 0 → always finite in [0, 1]
    const offset = circumference * (1 - fraction);
    const percent = Math.round(fraction * 100);
    const hasCenter = centerLabel != null || centerSubLabel != null;
    const mainSize = Math.max(10, Math.round(size * 0.32));
    const subSize = Math.max(8, Math.round(size * 0.18));
    const resolvedAriaLabel =
      ariaLabel ?? t('progressRing.ariaLabel', 'Progress: {{percent}}%', { percent });

    return (
      <div ref={ref} className={cn('inline-flex flex-col items-center gap-1', className)}>
        <div
          className="relative"
          style={{ width: size, height: size }}
          role="img"
          aria-label={resolvedAriaLabel}
        >
          <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              className="text-[var(--border-strong)]"
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
                  className="font-semibold tabular-nums text-[var(--text-primary)] text-[length:var(--ring-main-size)]"
                  style={{ '--ring-main-size': `${mainSize}px` } as CSSProperties}
                >
                  {centerLabel}
                </span>
              )}
              {centerSubLabel != null && (
                <span
                  className="mt-0.5 uppercase tracking-wide text-[var(--text-muted)] text-[length:var(--ring-sub-size)]"
                  style={{ '--ring-sub-size': `${subSize}px` } as CSSProperties}
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
