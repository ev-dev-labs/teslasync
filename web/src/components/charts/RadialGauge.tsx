import { forwardRef } from 'react';
import { scaleLinear } from '@visx/scale';
import { Circle } from '@visx/shape';
import { cn } from '@/lib/cn';
import { fmtNumber, getGlobalPrecision, safeNumber } from '@/lib/numberFormat';

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

/**
 * Circular gauge/dial (battery %, efficiency score, etc.) rendered with visx
 * (D3-backed SVG primitives from `@visx/shape` + `@visx/scale`) — the same
 * visx language the other migrated chart primitives use.
 *
 * Visuals are byte-faithful to the original hand-rolled SVG: a theme-aware
 * track ring, a colour-matched progress ring drawn with the standard
 * stroke-dash technique (rounded cap), and the reading rendered as HTML text
 * centred over the ring so it keeps the app's theme-aware typography. The
 * progress ring keeps the original `transition-all duration-slow` sweep, which
 * already collapses to 0ms under `prefers-reduced-motion` (see index.css), so
 * motion stays smooth without any hover-only affordance.
 *
 * `@visx/scale`'s `scaleLinear` maps the clamped reading onto the ring's arc
 * length; the untouched remainder is the animated dash offset. The SVG is
 * decorative (`aria-hidden`) because the whole widget is exposed to assistive
 * tech as a single labelled `img`, and it reflows within narrow (mobile)
 * containers via a `viewBox` + `max-w-full`.
 */
export const RadialGauge = forwardRef<HTMLDivElement, RadialGaugeProps>(
  function RadialGauge({ value, max, label, unit, color = '#3b82f6', size = 120, decimals, className }, ref) {
    const radius = (size - STROKE_WIDTH) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;

    // Null/NaN-safe: several call-sites feed live telemetry that can momentarily
    // be absent, and a zero/negative max must never divide into the geometry —
    // that would push NaN into the SVG and blank the ring.
    const safeValue = safeNumber(value);
    const safeMax = safeNumber(max);
    const clamped = safeMax > 0 ? Math.max(0, Math.min(safeValue, safeMax)) : 0;

    // Domain upper bound is guarded to 1 so a zero max never yields a
    // degenerate scale; `clamped` is already 0 in that case, so filled → 0.
    const fillScale = scaleLinear<number>({
      domain: [0, safeMax > 0 ? safeMax : 1],
      range: [0, circumference],
    });
    const offset = circumference - fillScale(clamped);

    const d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision());
    const valueText = fmtNumber(clamped, d);
    const ariaLabel = `${label ?? '—'}: ${valueText}${unit ?? ''}`;

    return (
      <div
        ref={ref}
        role="img"
        aria-label={ariaLabel}
        className={cn('inline-flex flex-col items-center gap-1', className)}
      >
        <div className="relative" style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            aria-hidden="true"
            className="-rotate-90 max-w-full"
          >
            <Circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={STROKE_WIDTH}
              className="text-gray-200 dark:text-gray-700"
            />
            <Circle
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
            <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {valueText}
              {unit && <span className="text-xs font-normal text-gray-500">{unit}</span>}
            </span>
          </div>
        </div>

        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      </div>
    );
  },
);
