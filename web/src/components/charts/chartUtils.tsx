import type { ReactElement } from 'react'
import { Line } from '@visx/shape'
import { fmtNumber } from '../../lib/numberFormat'
import { chartTokens } from '../../lib/tokens'

export { CHART_COLORS, CHART_COLORS_NEON as NEON_COLORS } from '../../lib/colors'

export const axisTick = { fill: chartTokens.axisStroke, fontSize: 11 }
export const axisTickSm = { fill: chartTokens.axisStroke, fontSize: 10 }

export const safe = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
export const fmt = (v: unknown, decimals = 1): string => fmtNumber(v, decimals)

export const chartAnimation = {
  animationDuration: 800,
  animationEasing: 'ease-out' as const,
}

export const chartMargin = { top: 10, right: 10, left: 0, bottom: 0 }
export const chartMarginLabeled = { top: 10, right: 20, left: 10, bottom: 5 }

/* ── Cartesian grid (visx, no recharts) ─────────────────────────────────────
 *
 * `chartGrid` used to be a recharts `<CartesianGrid>` element. recharts' grid
 * reads the plot geometry + axis scales from React context via hooks recharts
 * does NOT export, so a pure-visx grid cannot mirror it through the same
 * `displayName='CartesianGrid'` slot. Instead we use the ONE child handler that
 * hands geometry to a plain element as PROPS — `renderReferenceElement`, reached
 * by `displayName='ReferenceArea'` — the same displayName-contract technique the
 * shared visx `<ChartBrush>` ('Brush') and `<ChartLegend>` ('Legend') already
 * use. recharts clones our element with `{ xAxis, yAxis, viewBox }`, each axis
 * carrying a live d3 `scale`, and we draw tick-aligned lines with visx `<Line>`.
 * A prop-less "area" never extends an axis domain, so this is inert beyond the
 * grid it paints. Every branch is null-safe: it renders nothing until recharts
 * supplies geometry and never throws.
 */

/**
 * Structural view of the d3 scale recharts stores on each axis. Called
 * positionally (`scale(value)` → pixel); the band/tick helpers are optional and
 * always feature-detected before use.
 */
interface AxisScale {
  (value: unknown): number
  bandwidth?: () => number
  ticks?: (count?: number) => unknown[]
  domain: () => unknown[]
}

/** The slice of a recharts axis-map entry we read to place grid lines. */
interface InjectedAxis {
  scale?: AxisScale
  ticks?: unknown[]
  niceTicks?: unknown[]
  type?: 'number' | 'category'
  realScaleType?: string
  tickCount?: number
  duplicateDomain?: unknown[]
}

interface InjectedViewBox {
  x?: number
  y?: number
  width?: number
  height?: number
}

/** Props recharts injects when it clones a `displayName='ReferenceArea'` child. */
interface InjectedGridProps {
  xAxis?: InjectedAxis
  yAxis?: InjectedAxis
  viewBox?: InjectedViewBox
  /** Authored on the element so recharts resolves the default (id `0`) axes. */
  xAxisId?: number | string
  yAxisId?: number | string
}

const GRID_LINE = {
  stroke: chartTokens.gridStroke,
  strokeOpacity: 0.4,
  strokeDasharray: '3 3',
} as const

/**
 * Tick values for grid lines — prefers recharts' precomputed ticks (exact
 * alignment with the rendered axis), then the scale's own ticks, then its
 * domain. Always returns an array so callers can iterate safely.
 */
function tickValues(axis: InjectedAxis): unknown[] {
  if (axis.ticks && axis.ticks.length) return axis.ticks
  if (axis.niceTicks && axis.niceTicks.length) return axis.niceTicks
  const scale = axis.scale
  if (scale && typeof scale.ticks === 'function') return scale.ticks(axis.tickCount ?? 5) ?? []
  return scale ? scale.domain() : []
}

/** Band-centering nudge, ported from recharts' getTicksOfAxis grid branch. */
function bandOffset(axis: InjectedAxis): number {
  const scale = axis.scale
  if (!scale || axis.type !== 'category' || typeof scale.bandwidth !== 'function') return 0
  const bandwidth = scale.bandwidth()
  const offsetForBand = axis.realScaleType === 'scaleBand' ? bandwidth / 2 : 2
  return offsetForBand === 0 ? 0 : bandwidth / offsetForBand
}

/** Pixel coordinates of one axis' grid lines (finite values only). */
function axisGridCoords(axis: InjectedAxis | undefined): number[] {
  const scale = axis?.scale
  if (!axis || !scale) return []
  const offset = bandOffset(axis)
  const duplicateDomain = axis.duplicateDomain
  const coords: number[] = []
  for (const value of tickValues(axis)) {
    const input = duplicateDomain ? duplicateDomain.indexOf(value) : value
    const coordinate = scale(input) + offset
    if (Number.isFinite(coordinate)) coords.push(coordinate)
  }
  return coords
}

/** Drop near-identical coordinates (2-dp) so shared tick/edge lines don't double-draw. */
function dedupeCoords(values: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    const key = Math.round(value * 100) / 100
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function VisxCartesianGrid({ xAxis, yAxis, viewBox }: InjectedGridProps): ReactElement | null {
  const x = safe(viewBox?.x)
  const y = safe(viewBox?.y)
  const width = safe(viewBox?.width)
  const height = safe(viewBox?.height)
  if (width <= 0 || height <= 0) return null

  const right = x + width
  const bottom = y + height
  // recharts' default grid (syncWithTicks=false) also draws the plot edges.
  const horizontal = dedupeCoords([...axisGridCoords(yAxis), y, bottom])
  const vertical = dedupeCoords([...axisGridCoords(xAxis), x, right])

  return (
    <g className="recharts-cartesian-grid" aria-hidden="true" pointerEvents="none">
      {horizontal.map((cy) => (
        <Line key={`h-${cy}`} from={{ x, y: cy }} to={{ x: right, y: cy }} {...GRID_LINE} />
      ))}
      {vertical.map((cx) => (
        <Line key={`v-${cx}`} from={{ x: cx, y }} to={{ x: cx, y: bottom }} {...GRID_LINE} />
      ))}
    </g>
  )
}
// recharts discovers cartesian cosmetics by `type.displayName`. 'ReferenceArea'
// routes this element through `renderReferenceElement` — the only child handler
// that injects { xAxis, yAxis, viewBox } as props (the 'CartesianGrid' handler
// reads them from context instead). See the block comment above `chartGrid`.
VisxCartesianGrid.displayName = 'ReferenceArea'

/**
 * Shared cartesian grid. Consumers still render `{chartGrid}` inside a recharts
 * chart exactly as before. The explicit axis ids let recharts resolve the
 * default x/y axes when it clones the element (React 19 dropped function-
 * component `defaultProps`, so they can't be defaulted on the component itself).
 */
export const chartGrid = <VisxCartesianGrid xAxisId={0} yAxisId={0} />
