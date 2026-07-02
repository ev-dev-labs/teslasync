import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Circle, Line as SwatchLine } from '@visx/shape'
import { useChartHiddenSeries } from './ChartHiddenSeriesContext'
import type { ChartLegendState } from './useChartLegendState'
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries'
// `CHART_COLORS` is imported from `lib/colors` — the exact constant `chartUtils`
// re-exports — rather than from `chartUtils` itself: `chartUtils` still
// instantiates a recharts `<CartesianGrid>` at module load, and this component
// is now visx-only. Pulling the palette from its source keeps recharts out of
// this module's import graph while preserving identical colour tokens.
import { CHART_COLORS } from '../../lib/colors'
import { cn } from '@/lib/cn'

/**
 * A single legend row. When `<ChartLegend>` is used inside a recharts chart it is
 * auto-detected as the chart's legend (see the `displayName = 'Legend'` note at
 * the bottom of this file) and recharts injects this payload — one entry per
 * `<Line|Area|Bar>` — carrying the derived series `value` (name), `color`,
 * `type`, and `dataKey`. The shape is intentionally permissive so the component
 * keeps working when a future visx/uPlot chart host feeds it the same payload.
 */
interface LegendPayloadEntry {
  value: string
  type?: string
  color?: string
  /** recharts sets this when the series has `hide` toggled on. */
  inactive?: boolean
  dataKey?: unknown
  payload?: { dataKey?: unknown; strokeDasharray?: string | number }
}

/**
 * Recharts' payload uses its `DataKey<any>` type (string | number | function),
 * but for our toggle UX we only care about the string/number forms (function
 * dataKeys are computed accessors and lack a stable identity for persistence).
 */
function pickKey(entry: LegendPayloadEntry, fallback: string): string {
  const top = entry.dataKey
  if (typeof top === 'string' || typeof top === 'number') return String(top)
  const inner = entry.payload?.dataKey
  if (typeof inner === 'string' || typeof inner === 'number') return String(inner)
  return fallback
}

/**
 * The minimum surface `<ChartLegend>` needs from a state container. Both
 * `ChartLegendState` (localStorage) and `HiddenSeriesState` (URL) satisfy this,
 * so the legend works with either.
 */
export type ChartLegendToggleSource = Pick<
  ChartLegendState | HiddenSeriesState,
  'toggle' | 'isHidden'
>

export interface ChartLegendProps {
  /**
   * Optional toggle source. When omitted, the legend pulls state from the
   * surrounding `<ChartContainer chartKey="…">` via {@link useChartHiddenSeries}.
   * When neither a `state` prop nor a context provider is present, the legend
   * renders passively (no click-to-hide UX, no dimming).
   */
  state?: ChartLegendToggleSource
  /** Wrapper-style override (font size, colour, explicit position, margin, …). */
  wrapperStyle?: CSSProperties
  /** Vertical placement of the legend within the chart. */
  verticalAlign?: 'top' | 'middle' | 'bottom'
  /** Horizontal placement of the legend within the chart. */
  align?: 'left' | 'center' | 'right'
}

/**
 * Props recharts injects when it clones `<ChartLegend>` as the chart's legend.
 * All optional so the component also renders correctly when hosted outside
 * recharts (a future visx/uPlot chart) or in isolation.
 */
interface InjectedLegendProps {
  payload?: LegendPayloadEntry[]
  layout?: 'horizontal' | 'vertical'
  margin?: { top?: number; right?: number; bottom?: number; left?: number }
  chartWidth?: number
  chartHeight?: number
  width?: number
  height?: number
  onBBoxUpdate?: (box: { width: number; height: number } | null) => void
}

type ChartLegendComponentProps = ChartLegendProps & InjectedLegendProps

// Matches recharts' `Legend` bbox-change threshold, keeping the measure→report
// loop convergent.
const EPS = 1

/**
 * Solid, paintable colour for a swatch — falls back to the shared palette when
 * the series paint is missing or is an in-SVG gradient/pattern `url(...)` ref
 * that cannot resolve inside this component's own standalone `<svg>`.
 */
function swatchColor(color: string | undefined, index: number): string {
  if (!color || color.startsWith('url(')) {
    return CHART_COLORS[index % CHART_COLORS.length]
  }
  return color
}

function isDashed(entry: LegendPayloadEntry): boolean {
  const d = entry.payload?.strokeDasharray
  return d != null && d !== 'none' && d !== '0' && d !== ''
}

function justifyFor(
  align: ChartLegendProps['align'],
): CSSProperties['justifyContent'] {
  if (align === 'right') return 'flex-end'
  if (align === 'left') return 'flex-start'
  return 'center'
}

/**
 * Absolute placement mirroring recharts' `Legend.getDefaultPosition`, so the
 * legend lands exactly where a native recharts `<Legend>` would (default:
 * bottom-centre), honouring caller `align`/`verticalAlign` and the chart margin.
 * Any explicit left/right/top/bottom in `wrapperStyle` wins (recharts parity).
 */
function defaultPosition(
  p: ChartLegendComponentProps,
  box: { width: number; height: number },
): CSSProperties {
  const { align, verticalAlign, layout, margin, chartWidth, chartHeight, wrapperStyle } = p
  const m = margin ?? {}
  const style: CSSProperties = {}
  const hasX = wrapperStyle != null && (wrapperStyle.left != null || wrapperStyle.right != null)
  const hasY = wrapperStyle != null && (wrapperStyle.top != null || wrapperStyle.bottom != null)
  if (!hasX) {
    if (align === 'center' && layout === 'vertical') {
      style.left = ((chartWidth ?? 0) - box.width) / 2
    } else if (align === 'right') {
      style.right = m.right ?? 0
    } else {
      style.left = m.left ?? 0
    }
  }
  if (!hasY) {
    if (verticalAlign === 'middle') {
      style.top = ((chartHeight ?? 0) - box.height) / 2
    } else if (verticalAlign === 'bottom') {
      style.bottom = m.bottom ?? 0
    } else {
      style.top = m.top ?? 0
    }
  }
  return style
}

/**
 * Series marker drawn with visx SVG primitives (`@visx/shape`): a colour-matched
 * line stroke (dashed when the series is dashed) inside a soft radial halo, plus
 * a centre disc — the same glow language as the shared chart tooltip.
 * Decorative only; the adjacent series name carries the meaning, so `aria-hidden`.
 */
function LegendSwatch({
  color,
  dashed,
  gradientId,
}: {
  color: string
  dashed: boolean
  gradientId: string
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 22 12"
      className="h-3 w-[22px] shrink-0 overflow-visible"
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity={0.5} />
          <stop offset="70%" stopColor={color} stopOpacity={0.12} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <Circle cx={11} cy={6} r={6} fill={`url(#${gradientId})`} />
      <SwatchLine
        from={{ x: 1, y: 6 }}
        to={{ x: 21, y: 6 }}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={dashed ? '4 3' : undefined}
      />
      <Circle cx={11} cy={6} r={2.75} fill={color} />
    </svg>
  )
}

function LegendItem({
  entry,
  index,
  gradientId,
  hidden,
  onToggle,
}: {
  entry: LegendPayloadEntry
  index: number
  gradientId: string
  hidden: boolean
  onToggle: ((key: string) => void) | null
}) {
  const key = pickKey(entry, entry.value)
  const color = swatchColor(entry.color, index)

  const inner: ReactNode = (
    <>
      <LegendSwatch color={color} dashed={isDashed(entry)} gradientId={gradientId} />
      <span className={cn('truncate', hidden && 'line-through')}>{entry.value}</span>
    </>
  )

  // 44px min hit-height (`min-h-11`) keeps the toggle comfortably tappable on
  // touch devices; the visible row is vertically centred within it.
  const base =
    'inline-flex min-h-11 max-w-[14rem] items-center gap-1.5 rounded-md px-2 text-xs leading-tight transition-[opacity,background-color] duration-150'

  if (!onToggle) {
    return (
      <span
        className={cn(base, hidden && 'opacity-40')}
        data-series-key={key}
        data-series-hidden={hidden ? 'true' : 'false'}
      >
        {inner}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onToggle(key)}
      aria-pressed={hidden}
      data-series-key={key}
      data-series-hidden={hidden ? 'true' : 'false'}
      className={cn(
        base,
        'cursor-pointer select-none hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
        hidden && 'opacity-40',
      )}
    >
      {inner}
    </button>
  )
}

/**
 * Legend with click/tap-to-toggle series visibility, rendered with visx SVG
 * swatches. Hidden series render dimmed (40% opacity, line-through) so users can
 * find and re-enable them later. Toggling persists through the supplied (or
 * context-resolved) state; the caller still owns hiding the rendered series via
 * `<Line hide={state.isHidden(key)} />`.
 *
 * Chart-library agnostic: it reads a standard `payload` (series list) and
 * positioning props. Recharts supplies them today via legend auto-detection (see
 * `displayName` below) — the same contract the shared `<ChartTooltip>` uses — and
 * a future visx/uPlot chart host can supply them directly.
 */
export function ChartLegend(props: ChartLegendComponentProps) {
  const { state, wrapperStyle, payload, width, height, onBBoxUpdate, layout } = props
  const contextState = useChartHiddenSeries()
  const resolved: ChartLegendToggleSource | null = state ?? contextState

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const lastBox = useRef({ width: -1, height: -1 })
  const [box, setBox] = useState({ width: 0, height: 0 })
  const baseId = useId()

  // Mirror recharts' `Legend.updateBBox`: after each render measure the rendered
  // legend and, when it changed beyond EPS, report it up so the chart reserves
  // space for the legend and re-centres middle/vertical layouts. The EPS guard
  // makes this convergent — never a render loop.
  useEffect(() => {
    const node = wrapperRef.current
    if (!node) return
    const next = { width: node.offsetWidth, height: node.offsetHeight }
    if (
      Math.abs(next.width - lastBox.current.width) > EPS ||
      Math.abs(next.height - lastBox.current.height) > EPS
    ) {
      lastBox.current = next
      setBox(next)
      onBBoxUpdate?.(next)
    }
  })

  const entries = (payload ?? []).filter((entry) => entry.type !== 'none')
  if (entries.length === 0) return null

  const onToggle = resolved ? resolved.toggle : null

  const outerStyle: CSSProperties = {
    position: 'absolute',
    width: width ?? 'auto',
    height: height ?? 'auto',
    ...defaultPosition(props, box),
    ...wrapperStyle,
  }

  return (
    <div
      ref={wrapperRef}
      data-chart-legend=""
      className="pointer-events-auto text-[var(--text-secondary)]"
      style={outerStyle}
    >
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-1 gap-y-0.5',
          layout === 'vertical' && 'flex-col items-start',
        )}
        style={{ justifyContent: justifyFor(props.align) }}
      >
        {entries.map((entry, i) => {
          const key = pickKey(entry, entry.value)
          const hidden = resolved?.isHidden(key) ?? entry.inactive ?? false
          return (
            <LegendItem
              key={`${key}-${i}`}
              entry={entry}
              index={i}
              gradientId={`${baseId}-sw-${i}`}
              hidden={hidden}
              onToggle={onToggle}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * `displayName = 'Legend'` is REQUIRED, not cosmetic. Recharts discovers a
 * chart's legend by scanning children for `child.type.displayName === 'Legend'`
 * (recharts `findChildByType`/`getLegendProps`). With it set, recharts clones
 * `<ChartLegend>` as the legend and injects the derived series `payload` plus
 * positioning props — exactly how the shared `<ChartTooltip>` receives its
 * `active`/`payload` from `<Tooltip content>`. Without it, recharts renders no
 * legend at all.
 */
ChartLegend.displayName = 'Legend'
