import { forwardRef } from 'react';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { cn } from '@/lib/cn';

interface MiniChartProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  className?: string;
}

/**
 * Compact inline trend line rendered with visx (D3-backed SVG primitives).
 *
 * A decorative micro-chart: every call-site (e.g. FleetStatsBar) pairs it with
 * the same value shown as text, so the SVG is marked `aria-hidden` to avoid a
 * redundant, unlabelled chart being announced by screen readers. By design it
 * exposes no hover- or pointer-only affordances (nothing to tap/hover),
 * matching the sibling `Sparkline` and keeping the component mobile-safe.
 *
 * The rendered geometry is the same as the original hand-rolled polyline —
 * 1.5px round-capped stroke, 2px inset padding, baseline-hugging flat-series
 * fallback — but it now reflows into narrow (mobile) containers via a `viewBox`
 * + `max-w-full` while keeping the stroke crisp
 * (`vectorEffect="non-scaling-stroke"`). At its intrinsic size the output is
 * pixel-identical to before.
 */
export const MiniChart = forwardRef<HTMLDivElement, MiniChartProps>(
  function MiniChart({ data, color = '#3b82f6', height = 32, width = 100, className }, ref) {
    // Null-safe: tolerate a missing `data` prop and drop non-finite samples so
    // the scales never receive NaN/Infinity. Computed inline (not memoised) so
    // the latest values are re-read on every render, matching the original.
    const series = (data ?? []).filter((v): v is number => Number.isFinite(v));

    // Preserve the original guard: a polyline needs at least two points to draw
    // a line, so render nothing when there is insufficient data.
    if (series.length < 2) return null;

    const padding = 2;
    const min = Math.min(...series);
    const max = Math.max(...series);

    const xScale = scaleLinear<number>({
      domain: [0, series.length - 1],
      range: [padding, width - padding],
    });
    // `max === min ? min + 1` mirrors the original `max - min || 1` flat-series
    // guard: when every value is equal the line hugs the baseline rather than
    // dividing by a zero-height range.
    const yScale = scaleLinear<number>({
      domain: [min, max === min ? min + 1 : max],
      range: [height - padding, padding],
    });

    const getX = (_: number, i: number) => xScale(i);
    const getY = (v: number) => yScale(v);

    return (
      <div ref={ref} className={cn('inline-block max-w-full', className)}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="max-w-full overflow-visible"
        >
          <LinePath
            data={series}
            x={getX}
            y={getY}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    );
  },
);
