import { memo } from 'react';

/**
 * ChartGradient — the shared vertical area-fill gradient definition for the
 * visx-based charts toolkit.
 *
 * A chart's "area under the curve" fill is drawn by pointing an SVG shape's
 * `fill` at a `<linearGradient>` via `fill="url(#id)"`. This component emits
 * exactly that definition: one top-to-bottom `<linearGradient>` that fades the
 * given colour from `opacity` at the top edge to near-transparent at the
 * baseline — the soft glow every chart in the app shares.
 *
 * It is a plain SVG primitive by design, matching the visx (D3-backed SVG)
 * charts already in this toolkit (`Sparkline`, `SmallMultiplesChart`), which
 * fill their own areas with the very same `<linearGradient>` markup rather than
 * a framework's gradient machinery. Because it renders a bare definition it
 * drops into ANY `<svg><defs>` unchanged — the recharts-hosted pages still
 * mid-migration today, and pure-visx `<svg>` surfaces afterwards — so none of
 * the 30+ call-sites need to change. Two reasons it deliberately stays free of
 * a JS/D3 colour library:
 *   1. `color` is passed through verbatim. Call-sites hand it CSS custom
 *      properties such as `var(--theme-primary)` for theme-reactive fills; a
 *      colour parser would resolve those to `null` and silently break the fill.
 *   2. A two-stop definition needs no scale, curve, or runtime — the SVG
 *      element itself is the primitive, so there is nothing to convert.
 *
 * Purely declarative and non-interactive: no hover-only affordance, no fixed
 * sizing, nothing to reflow — it composes cleanly inside a responsive chart
 * down to a 375px viewport and owns no touch handling of its own. `memo` skips
 * re-rendering when a parent chart re-renders with unchanged gradient props.
 */

// Head = top edge, tail = just shy of the baseline. Kept identical to the
// toolkit's `areaGradient()` helper so every area fill speaks one visual
// language regardless of which primitive drew it.
const HEAD_OFFSET = '0%';
const TAIL_OFFSET = '95%';
const TAIL_OPACITY = 0.02;
const DEFAULT_HEAD_OPACITY = 0.3;

export interface ChartGradientProps {
  /** Gradient id, referenced by a shape via `fill="url(#id)"`. */
  id: string;
  /**
   * Any SVG paint string — a hex/rgb value or a CSS custom property such as
   * `var(--theme-primary)`. Passed through untouched so theme-reactive fills
   * keep resolving at render time.
   */
  color: string;
  /** Opacity at the top edge; fades to near-transparent at the baseline. Default 0.3. */
  opacity?: number;
}

export function ChartGradientBase({ id, color, opacity = DEFAULT_HEAD_OPACITY }: ChartGradientProps) {
  // Null-safety: never emit a broken definition from a missing/invalid prop.
  // `color` falls back to `currentColor` (a valid inheriting SVG paint) instead
  // of `undefined`; the head opacity is coerced to a finite value and clamped
  // into the legal [0, 1] range so an out-of-range prop can't yield a bad stop.
  const stopColor = color ?? 'currentColor';
  const headOpacity = Number.isFinite(opacity)
    ? Math.min(1, Math.max(0, opacity))
    : DEFAULT_HEAD_OPACITY;

  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset={HEAD_OFFSET} stopColor={stopColor} stopOpacity={headOpacity} />
      <stop offset={TAIL_OFFSET} stopColor={stopColor} stopOpacity={TAIL_OPACITY} />
    </linearGradient>
  );
}

export const ChartGradient = memo(ChartGradientBase);
