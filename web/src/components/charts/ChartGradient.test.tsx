import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ChartGradient, ChartGradientBase, type ChartGradientProps } from './ChartGradient'

// ChartGradient renders an SVG <linearGradient> def, so it must be mounted
// inside an <svg><defs> the way real callers place it before <Area>/<Bar>.
function renderGradient(props: ChartGradientProps, Component = ChartGradientBase) {
  const { container } = render(
    <svg>
      <defs>
        <Component {...props} />
      </defs>
    </svg>,
  )
  const gradient = container.querySelector(`#${props.id}`)
  const stops = Array.from(container.querySelectorAll('stop'))
  return { container, gradient, stops }
}

const stopColor = (el: Element) => el.getAttribute('stop-color')
const stopOpacity = (el: Element) => el.getAttribute('stop-opacity')
const offset = (el: Element) => el.getAttribute('offset')

describe('ChartGradientBase — structure', () => {
  it('renders a top-down <linearGradient> carrying the supplied id', () => {
    const { gradient } = renderGradient({ id: 'speedGrad', color: '#3b82f6' })
    expect(gradient).not.toBeNull()
    expect(gradient?.tagName.toLowerCase()).toBe('lineargradient')
    expect(gradient?.getAttribute('id')).toBe('speedGrad')
    // Vertical (top → bottom) orientation is what makes the area fill fade down.
    expect(gradient?.getAttribute('x1')).toBe('0')
    expect(gradient?.getAttribute('y1')).toBe('0')
    expect(gradient?.getAttribute('x2')).toBe('0')
    expect(gradient?.getAttribute('y2')).toBe('1')
  })

  it('renders exactly two stops at 0% and 95%', () => {
    const { stops } = renderGradient({ id: 'g2', color: '#10b981' })
    expect(stops).toHaveLength(2)
    expect(offset(stops[0])).toBe('0%')
    expect(offset(stops[1])).toBe('95%')
  })

  it('applies the color to both stops', () => {
    const { stops } = renderGradient({ id: 'g3', color: '#f59e0b' })
    expect(stopColor(stops[0])).toBe('#f59e0b')
    expect(stopColor(stops[1])).toBe('#f59e0b')
  })

  it('supports CSS custom property colors', () => {
    const { stops } = renderGradient({ id: 'g4', color: 'var(--theme-primary)' })
    expect(stopColor(stops[0])).toBe('var(--theme-primary)')
    expect(stopColor(stops[1])).toBe('var(--theme-primary)')
  })
})

describe('ChartGradientBase — opacity', () => {
  it('defaults the top stop to 0.3 and the bottom stop to 0.02', () => {
    const { stops } = renderGradient({ id: 'gDefault', color: '#00f0ff' })
    expect(stopOpacity(stops[0])).toBe('0.3')
    expect(stopOpacity(stops[1])).toBe('0.02')
  })

  it('applies a custom top opacity while keeping the bottom at 0.02', () => {
    const { stops } = renderGradient({ id: 'gCustom', color: '#00f0ff', opacity: 0.8 })
    expect(stopOpacity(stops[0])).toBe('0.8')
    expect(stopOpacity(stops[1])).toBe('0.02')
  })

  it('clamps an out-of-range opacity above 1 down to 1', () => {
    const { stops } = renderGradient({ id: 'gHigh', color: '#00f0ff', opacity: 5 })
    expect(stopOpacity(stops[0])).toBe('1')
    expect(stopOpacity(stops[1])).toBe('0.02')
  })

  it('clamps a negative opacity up to 0, and the bottom stop follows it', () => {
    const { stops } = renderGradient({ id: 'gNeg', color: '#00f0ff', opacity: -2 })
    expect(stopOpacity(stops[0])).toBe('0')
    // Monotonic fade — the bottom can never be more opaque than the top.
    expect(stopOpacity(stops[1])).toBe('0')
  })

  it('falls back to the default when opacity is NaN', () => {
    const { stops } = renderGradient({ id: 'gNaN', color: '#00f0ff', opacity: Number.NaN })
    expect(stopOpacity(stops[0])).toBe('0.3')
    expect(stopOpacity(stops[1])).toBe('0.02')
  })

  it('falls back to the default when opacity is non-finite (Infinity)', () => {
    const { stops } = renderGradient({ id: 'gInf', color: '#00f0ff', opacity: Number.POSITIVE_INFINITY })
    expect(stopOpacity(stops[0])).toBe('0.3')
  })

  it('keeps the fade monotonic when opacity is below the base bottom opacity', () => {
    const { stops } = renderGradient({ id: 'gTiny', color: '#00f0ff', opacity: 0.01 })
    // Without the guard the bottom (0.02) would out-shine the top (0.01) and
    // invert the gradient; the bottom must clamp down to the top value.
    expect(stopOpacity(stops[0])).toBe('0.01')
    expect(stopOpacity(stops[1])).toBe('0.01')
  })
})

describe('ChartGradient — memoized wrapper', () => {
  it('is a distinct React.memo wrapper around the base component', () => {
    expect(ChartGradient).not.toBe(ChartGradientBase)
    const memoWrapper = ChartGradient as unknown as { $$typeof: symbol; type: unknown }
    expect(memoWrapper.$$typeof).toBe(Symbol.for('react.memo'))
    expect(memoWrapper.type).toBe(ChartGradientBase)
  })

  it('renders identical markup to the base component', () => {
    const props: ChartGradientProps = { id: 'gMemo', color: '#a855f7', opacity: 0.15 }
    const { stops } = renderGradient(props, ChartGradient)
    expect(stops).toHaveLength(2)
    expect(stopColor(stops[0])).toBe('#a855f7')
    expect(stopOpacity(stops[0])).toBe('0.15')
    expect(stopOpacity(stops[1])).toBe('0.02')
  })
})
