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

/**
 * Returns a <defs> + <linearGradient> element pair for Recharts area fills.
 * Place inside <AreaChart> before <Area> components.
 *
 * @param id    Unique gradient ID (use per-chart to avoid SVG ID collisions)
 * @param color Hex color string (e.g., '#3b82f6')
 * @param opacity Top opacity for the gradient (default 0.3)
 */
export function areaGradient(id: string, color: string, opacity = 0.3) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={opacity} />
        <stop offset="95%" stopColor={color} stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );
}
