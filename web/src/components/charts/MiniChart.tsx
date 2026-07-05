import { forwardRef, useMemo } from 'react';
import { cn } from '@/lib/cn';

interface MiniChartProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  className?: string;
  /**
   * Accessible name for the trend. When provided the chart is exposed to
   * assistive tech as `role="img"`; when omitted the chart is treated as a
   * decorative flourish and hidden from screen readers so they don't announce
   * a meaningless "graphic".
   */
  label?: string;
}

const PADDING = 2;

/** Coerce a possibly non-finite value (NaN / ±Infinity / null) to a finite number. */
const toFinite = (v: number): number => (Number.isFinite(v) ? v : 0);

/** Tiny inline SVG trend line — no axes, no recharts, sized for stat cards. */
export const MiniChart = forwardRef<HTMLDivElement, MiniChartProps>(
  function MiniChart(
    { data, color = '#3b82f6', height = 32, width = 100, className, label },
    ref,
  ) {
    // Build the polyline once per data/size change. Sanitising every value up
    // front means a single stray NaN/Infinity/null can't poison min/max and
    // blank the whole line.
    const points = useMemo(() => {
      const series = (data ?? []).map(toFinite);
      // A trend needs at least two points; a single point would also divide by
      // zero below, so bail out and let the caller render its own placeholder.
      if (series.length < 2) return null;

      const min = Math.min(...series);
      const max = Math.max(...series);
      const range = max - min || 1;

      return series
        .map((v, i) => {
          const x = (i / (series.length - 1)) * (width - PADDING * 2) + PADDING;
          const y = height - PADDING - ((v - min) / range) * (height - PADDING * 2);
          return `${x},${y}`;
        })
        .join(' ');
    }, [data, height, width]);

    if (!points) return null;

    return (
      <div ref={ref} className={cn('inline-block', className)}>
        <svg
          width={width}
          height={height}
          className="overflow-visible"
          role={label ? 'img' : undefined}
          aria-label={label || undefined}
          aria-hidden={label ? undefined : true}
        >
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  },
);
