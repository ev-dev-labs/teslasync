import { Legend } from 'recharts'
import type { ChartLegendState } from './useChartLegendState'

/**
 * Recharts' Legend payload uses its `DataKey<any>` type (string | number |
 * function), but for our toggle UX we only care about the string/number forms
 * (function dataKeys are computed accessors and don't have a stable identity
 * for localStorage persistence).
 */
interface LegendPayloadEntry {
  value: string
  type?: string
  color?: string
  dataKey?: unknown
  payload?: { dataKey?: unknown }
}

function pickKey(entry: LegendPayloadEntry, fallback: string): string {
  const top = entry.dataKey
  if (typeof top === 'string' || typeof top === 'number') return String(top)
  const inner = entry.payload?.dataKey
  if (typeof inner === 'string' || typeof inner === 'number') return String(inner)
  return fallback
}

export interface ChartLegendProps {
  /** Persistent legend state from `useChartLegendState(chartId)`. */
  state: ChartLegendState
  /** Recharts wrapper-style override (font size, margin, etc.). */
  wrapperStyle?: React.CSSProperties
  /** Vertical alignment passed through to recharts. */
  verticalAlign?: 'top' | 'middle' | 'bottom'
  /** Horizontal alignment passed through to recharts. */
  align?: 'left' | 'center' | 'right'
}

/**
 * Recharts `<Legend>` wrapper that toggles series visibility on click and
 * persists the hidden set to localStorage via {@link useChartLegendState}.
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
  return (
    <Legend
      wrapperStyle={wrapperStyle}
      verticalAlign={verticalAlign}
      align={align}
      onClick={(data) => {
        const key = pickKey(data as LegendPayloadEntry, (data as LegendPayloadEntry).value)
        if (key) state.toggle(key)
      }}
      formatter={(value, entry) => {
        const key = pickKey(entry as LegendPayloadEntry, String(value))
        const dimmed = state.isHidden(key)
        return (
          <span
            style={{
              opacity: dimmed ? 0.4 : 1,
              textDecoration: dimmed ? 'line-through' : 'none',
              cursor: 'pointer',
            }}
          >
            {value}
          </span>
        )
      }}
    />
  )
}
