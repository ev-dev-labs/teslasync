import { CartesianGrid } from 'recharts'
import { fmtNumber } from '../../lib/numberFormat'
import { chartTokens } from '../../lib/tokens'

export { CHART_COLORS, CHART_COLORS_NEON as NEON_COLORS } from '../../lib/colors'

export const axisTick = { fill: chartTokens.axisStroke, fontSize: 11 }
export const axisTickSm = { fill: chartTokens.axisStroke, fontSize: 10 }

export const chartGrid = <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />

export const safe = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
export const fmt = (v: unknown, decimals = 1): string => fmtNumber(v, decimals)

export const chartAnimation = {
  animationDuration: 800,
  animationEasing: 'ease-out' as const,
}

export const chartMargin = { top: 10, right: 10, left: 0, bottom: 0 }
export const chartMarginLabeled = { top: 10, right: 20, left: 10, bottom: 5 }
