/** Tiny inline SVG line chart for showing trends in a compact space. */
export function Sparkline({ data, color = '#00f0ff', height = 30, width = 100 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (!data.length) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`).join(' ')

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      <polyline points={`0,${height} ${points} ${width},${height}`} fill={`url(#sg-${color.replace('#', '')})`} stroke="none" />
    </svg>
  )
}
