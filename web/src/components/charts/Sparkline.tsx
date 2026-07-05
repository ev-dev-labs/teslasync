import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export interface SparklineProps {
  /** Ordered series of numeric samples. Non-finite values are ignored. */
  data: number[]
  color?: string
  height?: number
  width?: number
  /**
   * Accessible label announced by screen readers (the SVG is exposed as an
   * image). Defaults to a generic i18n trend description; pass a
   * metric-specific label (e.g. "Speed over time") where the caller knows it.
   */
  ariaLabel?: string
}

/** Tiny inline SVG line chart for showing trends in a compact space. */
export function Sparkline({
  data,
  color = '#00f0ff',
  height = 30,
  width = 100,
  ariaLabel,
}: SparklineProps) {
  const { t } = useTranslation()
  // A per-instance id keeps every gradient <defs> unique and CSS-URL-safe
  // regardless of the `color` string. Deriving the id from `color` (the
  // previous approach) produced invalid `url(#sg-rgb(0, 0, 0))` references
  // for non-hex colors and silently shared gradients between same-colour
  // sparklines.
  const gradientId = `sg-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  const points = useMemo(() => {
    // Drop non-finite samples (NaN / ±Infinity) before any maths — a single
    // poisoned value otherwise propagates through Math.min/Math.max into
    // every coordinate as NaN and produces an unrenderable polyline.
    const clean = (data ?? []).filter((v) => Number.isFinite(v))
    if (clean.length === 0) return null

    const max = Math.max(...clean)
    const min = Math.min(...clean)
    const range = max - min || 1
    const yFor = (v: number) => height - ((v - min) / range) * height

    // A lone sample has no interval to interpolate across
    // (i / (n - 1) === 0 / 0 === NaN), so draw a flat line across the full
    // width instead of emitting a broken coordinate.
    if (clean.length === 1) {
      const y = yFor(clean[0])
      return `0,${y} ${width},${y}`
    }

    const denom = clean.length - 1
    return clean.map((v, i) => `${(i / denom) * width},${yFor(v)}`).join(' ')
  }, [data, height, width])

  const label = ariaLabel ?? t('sparkline.ariaLabel', 'Trend sparkline')

  if (!points) return null

  return (
    <svg width={width} height={height} className="overflow-visible" role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />
      <polyline
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#${gradientId})`}
        stroke="none"
      />
    </svg>
  )
}
