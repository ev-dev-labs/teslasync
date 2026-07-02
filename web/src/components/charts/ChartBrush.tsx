import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { scaleLinear } from '@visx/scale'
import { AreaClosed, LinePath } from '@visx/shape'
import { curveMonotoneX } from '@visx/curve'
import { NEON_COLORS } from './chartUtils'
import { chartTokens } from '../../lib/tokens'

/**
 * recharts reserves the bottom band for a brush using
 * `element.props.height || Brush.defaultProps.height` (== 40). React 19 removed
 * function-component `defaultProps`, so we can't inject a height onto the
 * element recharts inspects before our component runs. Defaulting our rendered
 * height to the SAME value recharts reserves keeps the reserved band and the
 * rendered brush aligned pixel-for-pixel (no dead gap) whether or not a
 * call-site passes an explicit `height`.
 */
const RECHARTS_RESERVED_BRUSH_HEIGHT = 40

/** Visible traveller width (grip handle), from the shared brush token. */
const TRAVELLER_WIDTH = chartTokens.brush.travellerWidth

/** Transparent hit-area width per traveller — keeps touch targets ≥44px. */
const TRAVELLER_HIT_WIDTH = 44

export interface ChartBrushProps {
  /** Data key for the X-axis being brushed (matches the chart's XAxis dataKey). */
  dataKey?: string
  /** Optional initial / controlled start index of the visible window. */
  startIndex?: number
  /** Optional initial / controlled end index of the visible window. */
  endIndex?: number
  /** Brush height in px. Defaults to recharts' reserved brush band (40px). */
  height?: number
  /** Change callback — receives `{ startIndex, endIndex }` as the window moves. */
  onChange?: (range: { startIndex?: number; endIndex?: number }) => void
}

/**
 * Props injected by the recharts parent chart when it detects this element as
 * its brush (matched by `displayName === 'Brush'`). Call-sites never pass these
 * — the parent `<AreaChart>/<LineChart>/<ComposedChart>` clones the brush
 * element and supplies the full dataset, the current window, the pixel geometry
 * of the reserved band, and a combined `onChange` that both zooms the parent and
 * fans the window out to every `syncId` sibling. Kept optional + internal so the
 * public `ChartBrushProps` contract (and all 268+ call-sites) is unchanged.
 */
interface InjectedBrushProps {
  data?: ReadonlyArray<Record<string, unknown>>
  x?: number
  y?: number
  width?: number
  updateId?: string
}

type DragMode = 'start' | 'end' | 'pan'

interface DragState {
  mode: DragMode
  pointerId: number
  /** Window snapshot at drag start — moves are computed against this, never */
  /** against possibly-lagging props, so drags never compound rounding error. */
  s0: number
  e0: number
  /** Pointer's index at drag start (used to pan by a stable index delta). */
  pointerIdx0: number
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/**
 * Auto-derive a faint overview series for the brush panorama: the first key
 * whose values are (mostly) finite numbers, excluding the x-axis `dataKey`.
 * Mirrors recharts' panorama intent (show the data's shape) without needing the
 * parent chart's series definitions, which recharts does not hand to the brush.
 * Returns `null` when nothing qualifies so the caller can degrade to a plain
 * track (never a crash, never a fabricated line).
 */
function pickOverviewSeries(
  rows: ReadonlyArray<Record<string, unknown>>,
  excludeKey: string,
): Array<number | null> | null {
  if (rows.length === 0) return null
  const keys = Object.keys(rows[0] ?? {}).filter((k) => k !== excludeKey)
  for (const key of keys) {
    let finite = 0
    for (const row of rows) {
      const v = row[key]
      if (typeof v === 'number' && Number.isFinite(v)) finite++
    }
    if (finite >= 2) {
      return rows.map((row) => {
        const v = row[key]
        return typeof v === 'number' && Number.isFinite(v) ? v : null
      })
    }
  }
  return null
}

/** Short display string for a boundary tick value (data, not a UI string). */
function formatBoundary(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1)
  return String(v)
}

/**
 * Themed zoom/pan brush for the app's charts, rendered entirely with visx
 * (D3-backed SVG primitives) — no recharts internals.
 *
 * It plugs into a recharts parent chart through the standard brush contract:
 * `displayName === 'Brush'` makes recharts reserve the bottom band and clone
 * this element with the dataset, window indices, pixel geometry, and a combined
 * `onChange`. Dragging a traveller (or panning the window) calls that
 * `onChange({ startIndex, endIndex })`, which zooms the parent and — when the
 * chart is inside a `<ChartTimeRangeProvider>` with a shared `syncId` —
 * propagates the visible window to every synced sibling.
 *
 * Interaction is pointer-based (mouse + touch unified via Pointer Events with
 * capture and `touch-action: none`), keyboard-accessible (each traveller is a
 * `role="slider"` reachable by Tab, moved with Arrow / Home / End), and
 * reflows to the width recharts hands it, so it stays usable down to 375px.
 */
export function ChartBrush({
  dataKey = 'time',
  startIndex,
  endIndex,
  height,
  onChange,
  data,
  x,
  y,
  width,
}: ChartBrushProps & InjectedBrushProps) {
  const { t } = useTranslation()
  const gradientId = useId()
  const trackRef = useRef<SVGRectElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [activeMode, setActiveMode] = useState<DragMode | null>(null)
  const [focused, setFocused] = useState<'start' | 'end' | null>(null)

  const rows = useMemo(() => data ?? [], [data])
  const n = rows.length
  const w = typeof width === 'number' && width > 0 ? width : 0
  const h = height ?? RECHARTS_RESERVED_BRUSH_HEIGHT
  const left = x ?? 0
  const top = y ?? 0

  const maxIndex = Math.max(n - 1, 0)
  const si = clamp(startIndex ?? 0, 0, maxIndex)
  const ei = Math.max(clamp(endIndex ?? maxIndex, 0, maxIndex), si)

  // Latest geometry/window mirrored into a ref so the stable pointer/keyboard
  // handlers always read current values without stale closures mid-drag.
  const stateRef = useRef({ n, w, si, ei })
  stateRef.current = { n, w, si, ei }
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const overview = useMemo(() => pickOverviewSeries(rows, dataKey), [rows, dataKey])

  const xAt = useCallback((i: number) => {
    const { n: nn, w: ww } = stateRef.current
    return nn <= 1 ? 0 : (i / (nn - 1)) * ww
  }, [])

  const indexAt = useCallback((localX: number) => {
    const { n: nn, w: ww } = stateRef.current
    if (nn <= 1 || ww <= 0) return 0
    return clamp(Math.round((localX / ww) * (nn - 1)), 0, nn - 1)
  }, [])

  const clientToLocalX = useCallback((clientX: number) => {
    const bcr = trackRef.current?.getBoundingClientRect()
    if (!bcr || bcr.width === 0) return 0
    return (clientX - bcr.left) * (stateRef.current.w / bcr.width)
  }, [])

  // Emit only when the window actually changes vs. the current (props) window —
  // this both suppresses no-op churn and dedupes rapid identical drag frames.
  const emit = useCallback((s: number, e: number) => {
    const cur = stateRef.current
    if (s === cur.si && e === cur.ei) return
    onChangeRef.current?.({ startIndex: s, endIndex: e })
  }, [])

  const beginDrag = useCallback(
    (mode: DragMode) => (e: React.PointerEvent<SVGRectElement>) => {
      const { n: nn } = stateRef.current
      if (nn < 2) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const cur = stateRef.current
      dragRef.current = {
        mode,
        pointerId: e.pointerId,
        s0: cur.si,
        e0: cur.ei,
        pointerIdx0: indexAt(clientToLocalX(e.clientX)),
      }
      setActiveMode(mode)
    },
    [clientToLocalX, indexAt],
  )

  const moveDrag = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const { n: nn } = stateRef.current
      const idx = indexAt(clientToLocalX(e.clientX))
      let s = drag.s0
      let en = drag.e0
      if (drag.mode === 'start') {
        s = clamp(idx, 0, drag.e0 - 1)
      } else if (drag.mode === 'end') {
        en = clamp(idx, drag.s0 + 1, nn - 1)
      } else {
        const span = drag.e0 - drag.s0
        const delta = idx - drag.pointerIdx0
        s = clamp(drag.s0 + delta, 0, nn - 1 - span)
        en = s + span
      }
      emit(s, en)
    },
    [clientToLocalX, emit, indexAt],
  )

  const endDrag = useCallback((e: React.PointerEvent<SVGRectElement>) => {
    const drag = dragRef.current
    if (drag && e.pointerId === drag.pointerId) {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    }
    dragRef.current = null
    setActiveMode(null)
  }, [])

  const onHandleKeyDown = useCallback(
    (which: 'start' | 'end') => (e: React.KeyboardEvent<SVGRectElement>) => {
      const { n: nn, si: s, ei: en } = stateRef.current
      if (nn < 2) return
      const step = e.shiftKey ? Math.max(1, Math.round(nn / 10)) : 1
      let ns = s
      let ne = en
      if (which === 'start') {
        if (e.key === 'ArrowLeft') ns = clamp(s - step, 0, en - 1)
        else if (e.key === 'ArrowRight') ns = clamp(s + step, 0, en - 1)
        else if (e.key === 'Home') ns = 0
        else return
      } else {
        if (e.key === 'ArrowLeft') ne = clamp(en - step, s + 1, nn - 1)
        else if (e.key === 'ArrowRight') ne = clamp(en + step, s + 1, nn - 1)
        else if (e.key === 'End') ne = nn - 1
        else return
      }
      e.preventDefault()
      emit(ns, ne)
    },
    [emit],
  )

  // Nothing to render without geometry or with a degenerate (single-point)
  // dataset — recharts only mounts the brush for real data, so this is the
  // defensive empty guard rather than a routine state.
  if (w <= 0 || n < 2) return null

  const startX = clamp(xAt(si), 0, w)
  const endX = clamp(xAt(ei), 0, w)
  const thw = TRAVELLER_WIDTH / 2
  const showLabels = activeMode !== null || focused !== null
  const overviewColor = NEON_COLORS[0]

  // Single-pass min/max — never `Math.min(...arr)`, which overflows the call
  // stack on the multi-thousand-point telemetry series a drive brush can hold.
  let vMin = Infinity
  let vMax = -Infinity
  if (overview) {
    for (const v of overview) {
      if (v == null) continue
      if (v < vMin) vMin = v
      if (v > vMax) vMax = v
    }
  }
  if (!Number.isFinite(vMin)) {
    vMin = 0
    vMax = 1
  }
  const vMaxAdj = vMax === vMin ? vMin + 1 : vMax
  const vPad = 3
  const xScale = scaleLinear<number>({ domain: [0, Math.max(n - 1, 1)], range: [0, w] })
  const valueScale = scaleLinear<number>({ domain: [vMin, vMaxAdj], range: [h - vPad, vPad] })

  const renderTraveller = (which: 'start' | 'end', px: number) => {
    const idx = which === 'start' ? si : ei
    const isFocused = focused === which
    const labelAnchor = which === 'start' ? 'start' : 'end'
    const labelX = which === 'start' ? px + thw + 4 : px - thw - 4
    return (
      <g key={which}>
        {isFocused && (
          <rect
            x={px - thw - 2}
            y={-2}
            width={TRAVELLER_WIDTH + 4}
            height={h + 4}
            rx={3}
            fill="none"
            stroke={chartTokens.brush.stroke}
            strokeWidth={1.5}
            strokeOpacity={0.9}
            pointerEvents="none"
          />
        )}
        <rect
          x={px - thw}
          y={0}
          width={TRAVELLER_WIDTH}
          height={h}
          rx={2}
          fill="rgba(255,255,255,0.14)"
          stroke={chartTokens.brush.stroke}
          strokeWidth={1}
          pointerEvents="none"
        />
        <line
          x1={px - 1.5}
          y1={h / 2 - 4}
          x2={px - 1.5}
          y2={h / 2 + 4}
          stroke={chartTokens.brush.stroke}
          strokeWidth={1}
          pointerEvents="none"
        />
        <line
          x1={px + 1.5}
          y1={h / 2 - 4}
          x2={px + 1.5}
          y2={h / 2 + 4}
          stroke={chartTokens.brush.stroke}
          strokeWidth={1}
          pointerEvents="none"
        />
        {showLabels && (
          <text
            x={clamp(labelX, 2, w - 2)}
            y={h / 2}
            textAnchor={labelAnchor}
            dominantBaseline="central"
            fontSize={10}
            fill={chartTokens.tooltipText}
            pointerEvents="none"
          >
            {formatBoundary(rows[idx]?.[dataKey])}
          </text>
        )}
        <rect
          x={px - TRAVELLER_HIT_WIDTH / 2}
          y={-2}
          width={TRAVELLER_HIT_WIDTH}
          height={h + 4}
          fill="transparent"
          className="cursor-ew-resize touch-none outline-none"
          role="slider"
          tabIndex={0}
          aria-label={
            which === 'start'
              ? t('chart.brush.startHandle', 'Start of visible range')
              : t('chart.brush.endHandle', 'End of visible range')
          }
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={idx}
          aria-valuetext={formatBoundary(rows[idx]?.[dataKey])}
          onPointerDown={beginDrag(which)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onHandleKeyDown(which)}
          onFocus={() => setFocused(which)}
          onBlur={() => setFocused((f) => (f === which ? null : f))}
        />
      </g>
    )
  }

  return (
    <g transform={`translate(${left}, ${top})`} data-testid="chart-brush">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={overviewColor} stopOpacity={0.28} />
          <stop offset="100%" stopColor={overviewColor} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Track background — also the geometry reference for pointer math. */}
      <rect
        ref={trackRef}
        x={0}
        y={0}
        width={w}
        height={h}
        rx={4}
        fill={chartTokens.brush.fill}
        stroke="rgba(255,255,255,0.10)"
        strokeWidth={1}
      />

      {/* Faint overview panorama of the data's shape (decorative). */}
      {overview && (
        <g aria-hidden="true" pointerEvents="none">
          <AreaClosed<number | null>
            data={overview}
            x={(_d, i) => xScale(i)}
            y={(d) => valueScale(d ?? vMin)}
            yScale={valueScale}
            defined={(d) => d != null}
            curve={curveMonotoneX}
            fill={`url(#${gradientId})`}
            stroke="none"
          />
          <LinePath<number | null>
            data={overview}
            x={(_d, i) => xScale(i)}
            y={(d) => valueScale(d ?? vMin)}
            defined={(d) => d != null}
            curve={curveMonotoneX}
            fill="none"
            stroke={overviewColor}
            strokeWidth={1.25}
            strokeOpacity={0.85}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}

      {/* Dim the regions outside the selected window. */}
      {startX > 0 && (
        <rect x={0} y={0} width={startX} height={h} fill="rgba(0,0,0,0.38)" pointerEvents="none" />
      )}
      {endX < w && (
        <rect x={endX} y={0} width={w - endX} height={h} fill="rgba(0,0,0,0.38)" pointerEvents="none" />
      )}

      {/* Selection outline + pan surface. */}
      <rect
        x={startX}
        y={0.5}
        width={Math.max(endX - startX, 0)}
        height={h - 1}
        rx={2}
        fill="transparent"
        stroke={chartTokens.brush.stroke}
        strokeWidth={1}
        strokeOpacity={0.55}
        pointerEvents="none"
      />
      {endX - startX > TRAVELLER_WIDTH && (
        <rect
          x={startX + thw}
          y={0}
          width={endX - startX - TRAVELLER_WIDTH}
          height={h}
          fill="transparent"
          className={activeMode === 'pan' ? 'cursor-grabbing touch-none' : 'cursor-grab touch-none'}
          aria-hidden="true"
          onPointerDown={beginDrag('pan')}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}

      {renderTraveller('start', startX)}
      {renderTraveller('end', endX)}
    </g>
  )
}

// CRITICAL: recharts locates the brush among a chart's children by matching
// `type.displayName === 'Brush'`. This makes the parent reserve the bottom band
// and clone this element with data/geometry/onChange (see InjectedBrushProps).
// Without it the brush silently renders nothing.
ChartBrush.displayName = 'Brush'
