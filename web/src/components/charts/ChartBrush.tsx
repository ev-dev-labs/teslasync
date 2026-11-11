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
 * Themed native-element factory for consistent zoom controls. Compose it as
 * `{ChartBrush({ dataKey: 'time' })}` directly inside the chart. Recharts parses
 * its children before React renders wrappers: `<ChartBrush />` is not a native
 * Brush child and cannot supply its geometry or range to that parser.
 *
 * When the parent chart is inside a `<ChartTimeRangeProvider>` AND shares the
 * same dataset+`syncId` as siblings, dragging the brush automatically zooms
 * every synced chart (recharts handles this natively — no extra wiring).
 *
 * The returned `<Brush>` must be a direct child of the Recharts chart. Keep
 * this factory hook-free; adding another React wrapper would lose that identity.
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
