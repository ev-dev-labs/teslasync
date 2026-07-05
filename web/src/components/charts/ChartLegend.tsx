import { Legend } from 'recharts'
import { useChartHiddenSeries } from './ChartHiddenSeriesContext'
import type { ChartLegendState } from './useChartLegendState'
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries'

/**
 * Recharts' Legend payload uses its `DataKey<any>` type (string | number |
 * function), but for our toggle UX we only care about the string/number forms
 * (function dataKeys are computed accessors and don't have a stable identity
 * for localStorage persistence).
 *
 * Every field is optional because recharts populates the payload lazily —
 * a legend entry for a series that has not yet resolved its accessor can
 * arrive with neither a `dataKey` nor a `value`, so consumers must treat the
 * whole shape as best-effort.
 */
export interface LegendPayloadEntry {
  value?: string | number
  type?: string
  color?: string
  dataKey?: unknown
  payload?: { dataKey?: unknown }
}

/**
 * Resolve the stable series identity from a legend payload entry.
 *
 * Prefers the top-level `dataKey`, then the nested `payload.dataKey`, and
 * finally the supplied `fallback` (usually the human-readable series name).
 * Only string/number identities are accepted — function dataKeys and any
 * other exotic value are ignored because they have no stable identity to
 * persist. Returns `''` (never `undefined`) when nothing usable is present,
 * so callers can guard with a simple truthiness check.
 *
 * Fully null-safe: a missing `entry` or `fallback` yields `''` rather than
 * throwing, guarding against recharts handing us a partially-populated
 * payload during the first paint.
 */
export function pickKey(
  entry: LegendPayloadEntry | null | undefined,
  fallback?: unknown,
): string {
  const top = entry?.dataKey
  if (typeof top === 'string' || typeof top === 'number') return String(top)
  const inner = entry?.payload?.dataKey
  if (typeof inner === 'string' || typeof inner === 'number') return String(inner)
  if (typeof fallback === 'string' || typeof fallback === 'number') return String(fallback)
  return ''
}

/**
 * The minimum surface `<ChartLegend>` needs from a state container. Both
 * `ChartLegendState` (localStorage) and `HiddenSeriesState` (URL) satisfy
 * this, so the legend works with either.
 */
export type ChartLegendToggleSource = Pick<
  ChartLegendState | HiddenSeriesState,
  'toggle' | 'isHidden'
>

/**
 * Toggle a series' visibility from a recharts legend click.
 *
 * A no-op when there is no resolved state (passive legend) or when the entry
 * carries no stable key — extracted so the branch logic is unit-testable
 * without mounting a recharts chart (jsdom has no layout, so a real legend
 * click never fires the handler).
 */
export function toggleFromLegend(
  resolved: ChartLegendToggleSource | null | undefined,
  entry: LegendPayloadEntry | null | undefined,
): void {
  if (!resolved) return
  const key = pickKey(entry, entry?.value)
  if (key) resolved.toggle(key)
}

export interface LegendSeriesLabelProps {
  /** Resolved toggle source, or `null` when the legend is passive. */
  resolved: ChartLegendToggleSource | null
  /** The legend's display value (series name), rendered as the label text. */
  value: React.ReactNode
  /** The recharts payload entry backing this legend item. */
  entry?: LegendPayloadEntry
}

/**
 * The rendered contents of a single legend item. Extracted from the recharts
 * `formatter` so its dimming / a11y branches can be asserted directly in
 * jsdom (recharts never paints its legend without a layout engine).
 *
 * Hidden series render dimmed (40% opacity, line-through). When a toggle
 * source is present the item advertises its pressed (hidden) state via
 * `aria-pressed`; passive legends omit it so assistive tech doesn't announce
 * a non-interactive control.
 */
export function LegendSeriesLabel({ resolved, value, entry }: LegendSeriesLabelProps) {
  const seriesKey = pickKey(entry, value)
  const interactive = resolved != null
  const dimmed = interactive ? resolved.isHidden(seriesKey) : false
  return (
    <span
      style={{
        opacity: dimmed ? 0.4 : 1,
        textDecoration: dimmed ? 'line-through' : 'none',
        cursor: interactive ? 'pointer' : 'default',
      }}
      aria-pressed={interactive ? dimmed : undefined}
      data-series-key={seriesKey}
      data-series-hidden={dimmed ? 'true' : 'false'}
    >
      {value}
    </span>
  )
}

export interface ChartLegendProps {
  /**
   * Optional toggle source. When omitted, the legend pulls state from the
   * surrounding `<ChartContainer chartKey="…">` via
   * {@link useChartHiddenSeries}. When neither a
   * `state` prop nor a context provider is present, the legend renders
   * passively (no click-to-hide UX, no dimming).
   */
  state?: ChartLegendToggleSource
  /** Recharts wrapper-style override (font size, margin, etc.). */
  wrapperStyle?: React.CSSProperties
  /** Vertical alignment passed through to recharts. */
  verticalAlign?: 'top' | 'middle' | 'bottom'
  /** Horizontal alignment passed through to recharts. */
  align?: 'left' | 'center' | 'right'
}

/**
 * Recharts `<Legend>` wrapper that toggles series visibility on click and
 * persists the hidden set via the supplied (or context-resolved) state.
 *
 * Hidden series render dimmed (40% opacity, line-through) in the legend so
 * users can find and re-enable them later.
 *
 * Note: this component does NOT hide the rendered series itself — that's the
 * caller's responsibility via `<Line hide={state.isHidden(key)} />`. We can't
 * hide the series from inside the legend because recharts doesn't pass a
 * "hide this series" callback up the tree.
 */
export function ChartLegend({
  state,
  wrapperStyle,
  verticalAlign,
  align,
}: ChartLegendProps) {
  const contextState = useChartHiddenSeries()
  const resolved: ChartLegendToggleSource | null = state ?? contextState
  return (
    <Legend
      wrapperStyle={wrapperStyle}
      verticalAlign={verticalAlign}
      align={align}
      onClick={(data) => toggleFromLegend(resolved, data as LegendPayloadEntry)}
      formatter={(value, entry) => (
        <LegendSeriesLabel
          resolved={resolved}
          value={value}
          entry={entry as LegendPayloadEntry}
        />
      )}
    />
  )
}
