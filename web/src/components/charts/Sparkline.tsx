import { Fragment, useId, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Slider } from '../ui/Slider'
import { Caption, Text } from '../ui/Typography'

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
  /** Opt in where the plot has room for a persistent reading and a scrubber. */
  inspect?: boolean
  /** Format an original observation (not a coordinate or an interpolated value). */
  formatValue?: (value: number) => string
}

type PlotPoint = { x: number; y: number; value: number; timestamp?: number }
type Selection = { index: number; timestamp?: number; value: number }
const INSPECT_PADDING = 6
const MAX_VISIBLE_OBSERVATION_MARKERS = 24

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
  inspect = false,
  formatValue = String,
}: SparklineProps) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<Selection | null>(null)
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
      const result: PlotPoint[][] = []
      let segment: PlotPoint[] | null = null
      for (const point of samples) {
        if (!Number.isFinite(point.timestamp) || point.value == null || !Number.isFinite(point.value)) {
          segment = null
          continue
        }
        if (!segment) {
          segment = []
          result.push(segment)
        }
        segment.push({
          x: span > 0 ? ((point.timestamp - start) / span) * width : width / 2,
          y: max === min ? height / 2 : yFor(point.value),
          value: point.value,
          timestamp: point.timestamp,
        })
      }
      return result
    }

    if (clean.length === 1) {
      return [[{ x: width / 2, y: yFor(clean[0]), value: clean[0] }]]
    }

    const denom = clean.length - 1
    return [clean.map((value, i) => ({ x: (i / denom) * width, y: yFor(value), value }))]
  }, [data, samples, height, width])
  const observations = useMemo(() => inspect ? segments?.flat() ?? [] : [], [inspect, segments])

  const label = ariaLabel ?? t('sparkline.ariaLabel', 'Trend sparkline')

  if (!segments) return null

  const count = observations.length
  let retainedIndex = -1
  if (selection && selection.timestamp === undefined && !samples) {
    retainedIndex = Math.min(selection.index, count - 1)
  } else if (selection?.timestamp !== undefined && samples) {
    const sameTime = (point: PlotPoint) => point.timestamp === selection.timestamp
    const previous = observations[selection.index]
    retainedIndex = previous && sameTime(previous) && previous.value === selection.value
      ? selection.index
      : observations.findIndex(point => sameTime(point) && point.value === selection.value)
    if (retainedIndex < 0) retainedIndex = observations.findIndex(sameTime)
  }
  const selectedIndex = retainedIndex < 0 ? count - 1 : retainedIndex
  const selected = observations[selectedIndex]
  const canScrub = count > 1
  const showObservationMarkers = selected && count <= MAX_VISIBLE_OBSERVATION_MARKERS
  const select = (index: number) => {
    const point = observations[index]
    if (point) setSelection({ index, timestamp: point.timestamp, value: point.value })
  }

  const inspectPlot = (event: MouseEvent<SVGSVGElement>) => {
    const svg = event.currentTarget
    const transform = svg.getScreenCTM()
    if (!transform) return
    const pointer = svg.createSVGPoint()
    pointer.x = event.clientX
    pointer.y = event.clientY
    const { x, y } = pointer.matrixTransform(transform.inverse())
    let best = 0
    for (let i = 1; i < count; i++) {
      const dx = Math.abs(observations[i].x - x)
      const bestDx = Math.abs(observations[best].x - x)
      if (dx < bestDx || (dx === bestDx && Math.abs(observations[i].y - y) < Math.abs(observations[best].y - y))) best = i
    }
    select(best)
  }

  // Fluid: width/height stay as the design size (and the viewBox ratio) but
  // the SVG shrinks to fit narrower containers instead of overflowing them.
  const padding = selected ? INSPECT_PADDING : 0
  const plot = (
    <svg data-app-part="chart chart-plot" data-chart-family="sparkline"
      viewBox={`${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`}
      width={width} height={height}
      className={canScrub ? 'h-auto w-full max-w-full cursor-crosshair overflow-hidden'
        : selected ? 'h-auto w-full max-w-full overflow-hidden' : 'h-auto max-w-full overflow-hidden'}
      role="img" aria-label={label} onClick={canScrub ? inspectPlot : undefined}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {selected && [0, height / 2, height].map((y, index) => (
        <line key={index} x1={0} x2={width} y1={y} y2={y} stroke="var(--border-default)" strokeDasharray="2 4" aria-hidden="true" />
      ))}
      {segments.map((segment, index) => {
        const first = segment[0]
        const last = segment[segment.length - 1]
        if (samples && segment.length === 1) {
          return showObservationMarkers || first === selected ? null
            : <circle key={index} cx={first.x} cy={first.y} r={1.5} fill={color} />
        }
        // Keep the decorative flat trace without inventing a second observation.
        const points = segment.length === 1 ? `0,${first.y} ${width},${first.y}`
          : segment.map(({ x, y }) => `${x},${y}`).join(' ')
        return <Fragment key={index}>
          <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
          <polyline
            points={`${segment.length === 1 ? 0 : first.x},${height} ${points} ${segment.length === 1 ? width : last.x},${height}`}
            fill={`url(#${gradientId})`} stroke="none"
          />
        </Fragment>
      })}
      {showObservationMarkers && observations.map(({ x, y }, index) => index !== selectedIndex && (
        <circle key={index} cx={x} cy={y} r={2.5} fill="var(--surface-1)" stroke={color} strokeWidth={1.5} aria-hidden="true" />
      ))}
      {selected && (
        <circle data-sparkline-selected cx={selected.x} cy={selected.y} r={4.5}
          fill={color} stroke="var(--text-primary)" strokeWidth={1.5} aria-hidden="true" />
      )}
    </svg>
  )

  if (!selected) return plot

  const reading = formatValue(selected.value)
  return (
    <div data-sparkline-inspector className="min-w-0 max-w-full space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--border-subtle)] pb-1">
        <Caption className="min-w-0 [overflow-wrap:anywhere]">{label}</Caption>
        <Text as="span" variant="bodySm" weight="semibold" className="min-w-0 tabular-nums [overflow-wrap:anywhere]">
          <Caption as="span" className="me-1.5">{t('sparkline.value', 'Value')}</Caption>
          <span data-sparkline-reading>{reading}</span>
        </Text>
      </div>
      {plot}
      <Caption className="block tabular-nums">
        {t('sparkline.observation', 'Observation {{index}} / {{count}}', { index: selectedIndex + 1, count })}
      </Caption>
      {canScrub && (
        <div dir="ltr">
          <Slider min={1} max={count} value={selectedIndex + 1} showLabel={false}
            label={t('sparkline.inspect', 'Inspect observations: {{trend}}', { trend: label })}
            onChange={index => select(index - 1)}
            formatValue={index => t('sparkline.selection', 'Observation {{index}} of {{count}}, value {{value}}', { index, count, value: reading })} />
        </div>
      )}
    </div>
  )
}
