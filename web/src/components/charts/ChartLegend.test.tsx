/**
 * ChartLegend — pure-logic, presentational + wiring cover.
 *
 * `<ChartLegend>` renders a recharts `<Legend>` whose `onClick` toggles a
 * series' visibility and whose `formatter` dims hidden series. Recharts never
 * paints its legend under jsdom (no layout engine → 0×0 → no legend items),
 * so — following the repo convention (`resolveAreaTooltip`, `ChartTooltipBase`)
 * — the branch logic is extracted into `pickKey` / `toggleFromLegend` and the
 * item chrome into `<LegendSeriesLabel>`, each asserted directly. The
 * `<ChartLegend>` wiring itself is covered by replacing recharts' `<Legend>`
 * with a prop-capturing double, then invoking the real `onClick` / `formatter`
 * closures the component wired up.
 *
 * Facets covered:
 *   1. pickKey          — dataKey precedence, nested payload fallback, name
 *                         fallback, exotic-value rejection, null-safety, the
 *                         String(undefined) fallback bug.
 *   2. toggleFromLegend — toggles the resolved key, name fallback, and the
 *                         passive / empty-key no-op branches.
 *   3. LegendSeriesLabel— dimmed vs visible vs passive rendering, a11y
 *                         (aria-pressed only when interactive), data-attrs.
 *   4. ChartLegend      — prop/align/style passthrough, click → toggle wiring,
 *                         formatter → dimming, context resolution, prop-over-
 *                         context precedence, and the fully-passive fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReactElement } from 'react'

// Replace recharts' <Legend> with a prop-capturing double so the real
// onClick / formatter closures ChartLegend builds can be invoked in isolation
// (recharts renders nothing legend-shaped under jsdom). Everything else in
// recharts is preserved via importOriginal.
const H = vi.hoisted(() => ({
  legendProps: null as Record<string, unknown> | null,
}))

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  const Legend = (props: Record<string, unknown>) => {
    H.legendProps = props
    return null
  }
  Legend.displayName = 'Legend'
  return {
    ...actual,
    Legend,
  }
})

import {
  pickKey,
  toggleFromLegend,
  LegendSeriesLabel,
  ChartLegend,
  type LegendPayloadEntry,
  type ChartLegendToggleSource,
} from './ChartLegend'
import { ChartHiddenSeriesContext } from './ChartHiddenSeriesContext'
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries'

function makeSource(hidden: string[] = []): ChartLegendToggleSource & { toggle: ReturnType<typeof vi.fn> } {
  const set = new Set(hidden)
  return {
    toggle: vi.fn(),
    isHidden: (k: string) => set.has(k),
  }
}

function makeContextState(hidden: string[] = []): HiddenSeriesState & { toggle: ReturnType<typeof vi.fn> } {
  const set = new Set(hidden)
  return {
    hidden: set,
    toggle: vi.fn(),
    isHidden: (k: string) => set.has(k),
    reset: vi.fn(),
  }
}

beforeEach(() => {
  H.legendProps = null
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('pickKey', () => {
  it('prefers a string top-level dataKey over everything else', () => {
    expect(pickKey({ dataKey: 'speed', value: 'Speed', payload: { dataKey: 'nested' } }, 'fb')).toBe('speed')
  })

  it('coerces a numeric top-level dataKey to a string', () => {
    expect(pickKey({ dataKey: 42 }, 'fb')).toBe('42')
  })

  it('falls back to the nested payload.dataKey when the top-level one is absent', () => {
    expect(pickKey({ payload: { dataKey: 'power' } }, 'fb')).toBe('power')
    expect(pickKey({ payload: { dataKey: 7 } }, 'fb')).toBe('7')
  })

  it('falls back to the string/number fallback when no dataKey is usable', () => {
    expect(pickKey({}, 'Speed')).toBe('Speed')
    expect(pickKey({}, 99)).toBe('99')
  })

  it('rejects exotic (function / object / boolean) dataKeys and uses the fallback', () => {
    expect(pickKey({ dataKey: () => 'x' }, 'fb')).toBe('fb')
    expect(pickKey({ dataKey: { a: 1 }, payload: { dataKey: true } }, 'fb')).toBe('fb')
  })

  it('returns an empty string (never undefined) when nothing usable is present', () => {
    // Regression guard: the source now passes the raw legend value (not
    // String(value)) so an undefined value falls through to '' instead of
    // becoming the literal key "undefined".
    expect(pickKey({}, undefined)).toBe('')
    expect(pickKey({})).toBe('')
    expect(pickKey({ dataKey: undefined, payload: { dataKey: null } }, undefined)).toBe('')
  })

  it('is null-safe when the entry itself is null or undefined', () => {
    expect(() => pickKey(null, 'fb')).not.toThrow()
    expect(pickKey(null, 'fb')).toBe('fb')
    expect(pickKey(undefined)).toBe('')
  })
})

describe('toggleFromLegend', () => {
  it('toggles the resolved dataKey', () => {
    const src = makeSource()
    toggleFromLegend(src, { dataKey: 'speed', value: 'Speed' })
    expect(src.toggle).toHaveBeenCalledTimes(1)
    expect(src.toggle).toHaveBeenCalledWith('speed')
  })

  it('falls back to the legend value when the entry has no dataKey', () => {
    const src = makeSource()
    toggleFromLegend(src, { value: 'Power' })
    expect(src.toggle).toHaveBeenCalledWith('Power')
  })

  it('is a no-op (no throw) when there is no resolved state', () => {
    expect(() => toggleFromLegend(null, { dataKey: 'speed' })).not.toThrow()
    expect(() => toggleFromLegend(undefined, { dataKey: 'speed' })).not.toThrow()
  })

  it('does not toggle when the entry yields no usable key', () => {
    const src = makeSource()
    toggleFromLegend(src, {})
    toggleFromLegend(src, null)
    expect(src.toggle).not.toHaveBeenCalled()
  })
})

describe('LegendSeriesLabel', () => {
  it('renders the label text and derives the series key from the dataKey', () => {
    render(<LegendSeriesLabel resolved={makeSource()} value="Speed" entry={{ dataKey: 'speed' }} />)
    const button = screen.getByRole('button', { name: 'Speed' })
    expect(button).toHaveAttribute('data-series-key', 'speed')
  })

  it('marks a hidden interactive series dimmed + pressed with line-through', () => {
    render(<LegendSeriesLabel resolved={makeSource(['speed'])} value="Speed" entry={{ dataKey: 'speed' }} />)
    const button = screen.getByRole('button', { name: 'Speed' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('data-series-hidden', 'true')
    expect(button).toHaveStyle({ opacity: '0.4', textDecoration: 'line-through', cursor: 'pointer' })
  })

  it('marks a visible interactive series un-dimmed + not pressed', () => {
    render(<LegendSeriesLabel resolved={makeSource([])} value="Speed" entry={{ dataKey: 'speed' }} />)
    const button = screen.getByRole('button', { name: 'Speed' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveAttribute('data-series-hidden', 'false')
    expect(button).toHaveStyle({ opacity: '1', cursor: 'pointer' })
  })

  it('renders passively (no aria-pressed, default cursor) when there is no toggle source', () => {
    render(<LegendSeriesLabel resolved={null} value="Speed" entry={{ dataKey: 'speed' }} />)
    const span = screen.getByText('Speed')
    expect(span).not.toHaveAttribute('aria-pressed')
    expect(span).toHaveAttribute('data-series-hidden', 'false')
    expect(span).toHaveStyle({ cursor: 'default' })
  })

  it('keys off the label when the entry carries no dataKey', () => {
    render(<LegendSeriesLabel resolved={makeSource(['Power'])} value="Power" />)
    const button = screen.getByRole('button', { name: 'Power' })
    expect(button).toHaveAttribute('data-series-key', 'Power')
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggles from the focusable legend control', () => {
    const source = makeSource()
    render(<LegendSeriesLabel resolved={source} value="Speed" entry={{ dataKey: 'speed' }} />)
    screen.getByRole('button', { name: 'Speed' }).click()
    expect(source.toggle).toHaveBeenCalledWith('speed')
  })
})

describe('ChartLegend — recharts wiring', () => {
  function legend(): {
    onClick: (data: LegendPayloadEntry, i?: number, e?: unknown) => void
    formatter: (value: unknown, entry: unknown, i?: number) => ReactElement
    wrapperStyle?: unknown
    verticalAlign?: unknown
    align?: unknown
  } {
    const p = H.legendProps
    if (!p) throw new Error('Legend was not rendered')
    return p as never
  }

  it('uses the recharts display name so categorical charts discover it', () => {
    expect(ChartLegend.displayName).toBe('Legend')
  })

  it('passes wrapperStyle / verticalAlign / align straight through to recharts <Legend>', () => {
    const style = { fontSize: 12 }
    render(<ChartLegend state={makeSource()} wrapperStyle={style} verticalAlign="top" align="right" />)
    const p = legend()
    expect(p.wrapperStyle).toBe(style)
    expect(p.verticalAlign).toBe('top')
    expect(p.align).toBe('right')
  })

  it('wires onClick to toggle the clicked series via the state prop', () => {
    const src = makeSource()
    render(<ChartLegend state={src} />)
    legend().onClick({ dataKey: 'power', value: 'Power' })
    expect(src.toggle).toHaveBeenCalledWith('power')
  })

  it('wires the formatter to dim series the state reports as hidden', () => {
    render(<ChartLegend state={makeSource(['power'])} />)
    const node = legend().formatter('Power', { dataKey: 'power' })
    render(node)
    const button = screen.getByRole('button', { name: 'Power' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('data-series-hidden', 'true')
  })

  it('resolves state from the surrounding ChartHiddenSeriesContext when no state prop is given', () => {
    const ctx = makeContextState(['soc'])
    render(
      <ChartHiddenSeriesContext.Provider value={ctx}>
        <ChartLegend />
      </ChartHiddenSeriesContext.Provider>,
    )
    // click toggles through the context source …
    legend().onClick({ dataKey: 'soc' })
    expect(ctx.toggle).toHaveBeenCalledWith('soc')
    // … and the formatter dims the context-hidden series.
    render(legend().formatter('SOC', { dataKey: 'soc' }))
    expect(screen.getByRole('button', { name: 'SOC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('prefers an explicit state prop over the context source', () => {
    const prop = makeSource()
    const ctx = makeContextState(['x'])
    render(
      <ChartHiddenSeriesContext.Provider value={ctx}>
        <ChartLegend state={prop} />
      </ChartHiddenSeriesContext.Provider>,
    )
    legend().onClick({ dataKey: 'x' })
    expect(prop.toggle).toHaveBeenCalledWith('x')
    expect(ctx.toggle).not.toHaveBeenCalled()
  })

  it('renders passively when neither a state prop nor a context provider is present', () => {
    render(<ChartLegend />)
    const p = legend()
    // onClick is a safe no-op (nothing to toggle, must not throw).
    expect(() => p.onClick({ dataKey: 'speed', value: 'Speed' })).not.toThrow()
    // formatter still renders, but the item is non-interactive (no aria-pressed).
    render(p.formatter('Speed', { dataKey: 'speed' }))
    const span = screen.getByText('Speed')
    expect(span).not.toHaveAttribute('aria-pressed')
    expect(span).toHaveStyle({ cursor: 'default' })
  })
})
