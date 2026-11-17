import { Fragment, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export interface SparklineSample {
  timestamp: number
  value: number | null
}

interface SparklineOptions {
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

export type SparklineProps = SparklineOptions & (
  /** Untimed series retain the original uniformly spaced, finite-only behaviour. */
  { data: readonly number[]; samples?: never }
  /** Epoch milliseconds preserve elapsed time and explicit gaps, without interpolation. */
  | { samples: readonly SparklineSample[]; data?: never }
)

/** Tiny inline SVG line chart for showing trends in a compact space. */
export function Sparkline({
  data,
  samples,
  color = 'var(--theme-primary)',
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

  const segments = useMemo(() => {
    // Drop non-finite samples (NaN / ±Infinity) before any maths — a single
    // poisoned value otherwise propagates through Math.min/Math.max into
    // every coordinate as NaN and produces an unrenderable polyline.
    const clean = samples
      ? samples.filter(point => Number.isFinite(point.timestamp) && point.value != null && Number.isFinite(point.value))
        .map(point => point.value as number)
      : (data ?? []).filter((v) => Number.isFinite(v))
    if (clean.length === 0) return null

    const max = Math.max(...clean)
    const min = Math.min(...clean)
    const range = max - min || 1
    const yFor = (v: number) => height - ((v - min) / range) * height

    if (samples) {
      const times = samples.map(point => point.timestamp).filter(Number.isFinite)
      const start = Math.min(...times)
      const span = Math.max(...times) - start
      const result: Array<Array<[number, number]>> = []
      let segment: Array<[number, number]> | null = null
      for (const point of samples) {
        if (!Number.isFinite(point.timestamp) || point.value == null || !Number.isFinite(point.value)) {
          segment = null
          continue
        }
        if (!segment) {
          segment = []
          result.push(segment)
        }
        segment.push([
          span > 0 ? ((point.timestamp - start) / span) * width : width / 2,
          max === min ? height / 2 : yFor(point.value),
        ])
      }
      return result
    }

    // A lone sample has no interval to interpolate across
    // (i / (n - 1) === 0 / 0 === NaN), so draw a flat line across the full
    // width instead of emitting a broken coordinate.
    if (clean.length === 1) {
      const y = yFor(clean[0])
      return [[[0, y], [width, y]]]
    }

    const denom = clean.length - 1
    return [clean.map((v, i) => [(i / denom) * width, yFor(v)])]
  }, [data, samples, height, width])

  const label = ariaLabel ?? t('sparkline.ariaLabel', 'Trend sparkline')

  if (!segments) return null

  // Fluid: width/height stay as the design size (and the viewBox ratio) but
  // the SVG shrinks to fit narrower containers instead of overflowing them.
  return (
    <svg data-app-part="chart chart-plot" data-chart-family="sparkline" viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="h-auto max-w-full overflow-hidden" role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {segments.map((segment, index) => {
        if (segment.length === 1) return <circle key={index}
          cx={segment[0][0]} cy={segment[0][1]} r={1.5} fill={color} />
        const points = segment.map(point => point.join(',')).join(' ')
        return <Fragment key={index}>
          <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
          <polyline
            points={`${segment[0][0]},${height} ${points} ${segment[segment.length - 1][0]},${height}`}
            fill={`url(#${gradientId})`} stroke="none"
          />
        </Fragment>
      })}
    </svg>
  )
}
