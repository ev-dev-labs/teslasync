import { useId } from 'react';
import { scaleLinear } from '@visx/scale';
import { AreaClosed, LinePath } from '@visx/shape';

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
}

/**
 * Tiny inline trend chart, rendered with visx (D3-backed SVG primitives).
 *
 * Draws a glowing trend line over a soft vertical gradient fill inside a
 * compact fixed box — the same visual language the original hand-rolled SVG
 * produced (1.5px line, colour-matched glow, 0.3 -> 0 vertical fill).
 *
 * Decorative by design: every call-site pairs it with the same value shown as
 * text, so the SVG is marked `aria-hidden` to avoid a redundant, unlabelled
 * micro-chart being announced by screen readers. It reflows down to fit narrow
 * (mobile) containers via `max-w-full` + a `viewBox` while keeping the stroke
 * crisp (`vectorEffect="non-scaling-stroke"`), and never exposes hover-only
 * affordances.
 */
export function Sparkline({ data, color = '#00f0ff', height = 30, width = 100 }: SparklineProps) {
  // Stable, collision-free gradient id per instance — two sparklines sharing a
  // colour previously emitted duplicate DOM ids from `sg-${color}`.
  const gradientId = useId();

  // Null-safe: tolerate a missing `data` prop and drop non-finite samples so
  // the scales never receive NaN/Infinity. Computed inline (not memoised) so
  // the latest values are re-read on every render, matching the original —
  // some call-sites feed a ref-backed rolling buffer.
  const series = (data ?? []).filter((v): v is number => Number.isFinite(v));

  if (series.length === 0) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);

  const xScale = scaleLinear<number>({
    domain: [0, Math.max(series.length - 1, 1)],
    range: [0, width],
  });
  // `max === min ? min + 1` mirrors the original `max - min || 1` flat-series
  // guard: when every value is equal the line hugs the baseline rather than
  // dividing by a zero-height range.
  const yScale = scaleLinear<number>({
    domain: [min, max === min ? min + 1 : max],
    range: [height, 0],
  });

  const getX = (_: number, i: number) => xScale(i);
  const getY = (v: number) => yScale(v);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="max-w-full overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <AreaClosed
        data={series}
        x={getX}
        y={getY}
        yScale={yScale}
        fill={`url(#${gradientId})`}
        stroke="none"
      />
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
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  );
}
