import { memo } from 'react'

export function ChartGradientBase({ id, color, opacity = 0.3 }: { id: string; color: string; opacity?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={opacity} />
      <stop offset="95%" stopColor={color} stopOpacity={0.02} />
    </linearGradient>
  )
}

export const ChartGradient = memo(ChartGradientBase)
