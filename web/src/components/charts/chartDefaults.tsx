/**
 * Shared Recharts props for smoothed Area/Line charts.
 * Spread onto <Area> or <Line> components: {...AREA_DEFAULTS}
 */
export const AREA_DEFAULTS = {
  type: 'monotone' as const,
  dot: false,
  connectNulls: true,
  strokeWidth: 2,
  animationDuration: 300,
} as const;

/** Opacity used for the top stop when a caller passes none. */
const DEFAULT_TOP_OPACITY = 0.3;
/** Near-transparent tail so the fill fades out toward the axis. */
const BOTTOM_OPACITY = 0.02;

/**
 * Clamp a caller-supplied opacity into SVG's valid [0, 1] range, falling back
 * to {@link DEFAULT_TOP_OPACITY} for non-finite input (NaN / ±Infinity that
 * slips in from a computed value). SVG treats an out-of-range or NaN
 * `stop-opacity` as its own default of 1, which silently renders a
 * fully-opaque fill instead of the intended translucent gradient.
 */
function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TOP_OPACITY;
  return Math.min(1, Math.max(0, value));
}

/**
 * Returns a <defs> + <linearGradient> element pair for Recharts area fills.
 * Place inside <AreaChart> before <Area> components.
 *
 * @param id      Unique gradient ID (use per-chart to avoid SVG ID collisions)
 * @param color   Hex color string (e.g., '#3b82f6'). Falls back to
 *                `currentColor` when a caller passes an empty / undefined value
 *                (e.g., `palette[0]` on an empty palette) so the stop never
 *                collapses to opaque black.
 * @param opacity Top opacity for the gradient (default 0.3); clamped to [0, 1].
 */
export function areaGradient(id: string, color: string, opacity = DEFAULT_TOP_OPACITY) {
  const safeColor = color || 'currentColor';
  const topOpacity = clampOpacity(opacity);
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={safeColor} stopOpacity={topOpacity} />
        <stop offset="95%" stopColor={safeColor} stopOpacity={BOTTOM_OPACITY} />
      </linearGradient>
    </defs>
  );
}
