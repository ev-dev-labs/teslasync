import { prefersReducedMotion } from '@/components/motion/ambient';

/**
 * Shared Recharts props for smoothed Area/Line charts.
 * Spread onto <Area> or <Line> components: {...AREA_DEFAULTS}
 *
 * Reduced motion (A11Y-08)
 * ------------------------
 * Recharts animates every series by default (`isAnimationActive`
 * defaults to true) and drives that animation with `requestAnimationFrame`
 * via react-smooth — so the global
 * `@media (prefers-reduced-motion: reduce)` block in `index.css` cannot
 * touch it. Every chart in the app would keep sweeping its lines and
 * growing its bars for a user who explicitly asked the OS for less
 * motion.
 *
 * The animation props below are **getters**, not literals. Object
 * spread invokes getters, so `{...AREA_DEFAULTS}` re-reads the
 * preference on every render at all ~225 call sites — no hook, no
 * context, and no edit required in the 80 files that already spread
 * these defaults.
 *
 * Charts that do NOT spread `AREA_DEFAULTS` should use
 * `chartAnimationProps()` from this module instead.
 */
export const AREA_DEFAULTS = {
  type: 'monotone' as const,
  dot: false,
  // A missing sample is information, not an interpolation request. Keeping
  // the gap visible prevents charts from implying continuity across telemetry
  // outages or explicitly unknown measurements.
  connectNulls: false,
  strokeWidth: 2,
  get animationDuration(): number {
    return prefersReducedMotion() ? 0 : DEFAULT_ANIMATION_MS;
  },
  get isAnimationActive(): boolean {
    return !prefersReducedMotion();
  },
};

/** Entry-animation duration for chart series when motion is allowed. */
export const DEFAULT_ANIMATION_MS = 300;

/**
 * Motion-aware animation props for Recharts primitives that do not
 * spread {@link AREA_DEFAULTS} — `<Bar>`, `<Pie>`, `<Radar>`,
 * `<Scatter>`, `<RadialBar>`, and friends.
 *
 * @example
 *   <Bar dataKey="wh" {...chartAnimationProps()} />
 */
export function chartAnimationProps(): {
  isAnimationActive: boolean;
  animationDuration: number;
} {
  const reduce = prefersReducedMotion();
  return {
    isAnimationActive: !reduce,
    animationDuration: reduce ? 0 : DEFAULT_ANIMATION_MS,
  };
}

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
