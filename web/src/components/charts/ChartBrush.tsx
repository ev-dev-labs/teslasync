import { Brush } from 'recharts'
import { chartTokens } from '../../lib/tokens'

export interface ChartBrushProps {
  /** Data key for the X-axis being brushed (matches the chart's XAxis dataKey). */
  dataKey?: string
  /** Optional initial start index. */
  startIndex?: number
  /** Optional initial end index. */
  endIndex?: number
  /** Brush height in px. Defaults to the token value (28px). */
  height?: number
  /** Optional change callback — recharts passes `{startIndex, endIndex}`. */
  onChange?: (range: { startIndex?: number; endIndex?: number }) => void
}

/**
 * Themed wrapper around recharts' `<Brush>` for consistent zoom-controls
 * across the app. Pass it as a child of an `<AreaChart>` / `<LineChart>` /
 * `<ComposedChart>` — recharts will render it below the X-axis.
 *
 * When the parent chart is inside a `<ChartTimeRangeProvider>` AND shares the
 * same dataset+`syncId` as siblings, dragging the brush automatically zooms
 * every synced chart (recharts handles this natively — no extra wiring).
 *
 * Note: this component is intentionally a thin presentational wrapper. The
 * `<Brush>` element MUST be rendered inside a recharts chart container for
 * recharts to wire it up; mounting it standalone is a no-op and a unit-test
 * antipattern.
 */
export function ChartBrush({
  dataKey = 'time',
  startIndex,
  endIndex,
  height = chartTokens.brush.height,
  onChange,
}: ChartBrushProps) {
  return (
    <Brush
      dataKey={dataKey}
      height={height}
      stroke={chartTokens.brush.stroke}
      fill={chartTokens.brush.fill}
      travellerWidth={chartTokens.brush.travellerWidth}
      startIndex={startIndex}
      endIndex={endIndex}
      onChange={onChange}
    />
  )
}
