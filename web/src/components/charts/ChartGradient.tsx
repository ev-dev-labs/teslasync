import { memo } from 'react'

/** Top-of-gradient opacity used when the caller omits `opacity`. */
const DEFAULT_TOP_OPACITY = 0.3
/** Bottom stop opacity — the fill fades to (near) transparent at the baseline. */
const BASE_BOTTOM_OPACITY = 0.02

export interface ChartGradientProps {
  /** Unique gradient id; consumers reference it via `fill="url(#id)"`. */
  id: string
  /** Stop color — a hex (`#3b82f6`) or a CSS custom property (`var(--theme-primary)`). */
  color: string
  /** Top-of-gradient opacity, clamped to the SVG-valid [0, 1] range. Defaults to 0.3. */
  opacity?: number
}

/** Clamp to the SVG-valid [0, 1] range, falling back to `fallback` on non-finite input. */
function clampOpacity(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

/**
 * Vertical `<linearGradient>` for Recharts area/bar fills: fades from `color`
 * at `opacity` (top) down to (near) transparent (bottom). Render it inside a
 * `<defs>` and point the shape's `fill` at `url(#id)`.
 */
export function ChartGradientBase({ id, color, opacity }: ChartGradientProps) {
  const topOpacity = clampOpacity(opacity, DEFAULT_TOP_OPACITY)
  // Keep the fade monotonic: the bottom stop must never be more opaque than the
  // top, otherwise a very low `opacity` would visually invert the gradient.
  const bottomOpacity = Math.min(BASE_BOTTOM_OPACITY, topOpacity)
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={topOpacity} />
      <stop offset="95%" stopColor={color} stopOpacity={bottomOpacity} />
    </linearGradient>
  )
}

export const ChartGradient = memo(ChartGradientBase)
