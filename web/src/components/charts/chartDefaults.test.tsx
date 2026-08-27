import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AreaChart, Area } from 'recharts'
import { AREA_DEFAULTS, areaGradient } from './chartDefaults'

// areaGradient returns SVG <defs> content, which only renders meaningfully
// inside an <svg> host. Mount it there and hand back the container so tests
// can inspect the resulting DOM.
function mount(node: ReturnType<typeof areaGradient>) {
  const { container } = render(<svg>{node}</svg>)
  return container
}

describe('AREA_DEFAULTS', () => {
  it('exposes the exact smoothing/animation contract callers spread onto <Area>', () => {
    expect(AREA_DEFAULTS).toEqual({
      type: 'monotone',
      dot: false,
      connectNulls: false,
      strokeWidth: 2,
      animationDuration: 300,
    })
  })

  it('pins each individual default so a silent field drift is caught', () => {
    expect(AREA_DEFAULTS.type).toBe('monotone')
    expect(AREA_DEFAULTS.dot).toBe(false)
    expect(AREA_DEFAULTS.connectNulls).toBe(false)
    expect(AREA_DEFAULTS.strokeWidth).toBe(2)
    expect(AREA_DEFAULTS.animationDuration).toBe(300)
  })

  it('is a valid props bag that renders when spread onto a recharts <Area>', () => {
    const { container } = render(
      <AreaChart width={320} height={160} data={[{ x: 0, y: 1 }, { x: 1, y: 3 }]}>
        {areaGradient('areaDefaultsGrad', '#3b82f6', 0.4)}
        <Area {...AREA_DEFAULTS} dataKey="y" stroke="#3b82f6" fill="url(#areaDefaultsGrad)" />
      </AreaChart>,
    )
    // Our gradient def and the recharts-rendered area path both exist.
    expect(container.querySelector('#areaDefaultsGrad')).not.toBeNull()
    expect(container.querySelector('path')).not.toBeNull()
  })
})

describe('areaGradient', () => {
  it('renders a <defs> wrapping a vertical <linearGradient> with the given id', () => {
    const c = mount(areaGradient('speedGrad', '#00f0ff'))
    const gradient = c.querySelector('#speedGrad')
    expect(gradient).not.toBeNull()
    expect(gradient?.parentElement?.tagName.toLowerCase()).toBe('defs')
    // Vertical top→bottom gradient.
    expect(gradient?.getAttribute('x1')).toBe('0')
    expect(gradient?.getAttribute('y1')).toBe('0')
    expect(gradient?.getAttribute('x2')).toBe('0')
    expect(gradient?.getAttribute('y2')).toBe('1')
  })

  it('emits exactly two stops anchored at 0% and 95%', () => {
    const c = mount(areaGradient('twoStops', '#10b981'))
    const stops = c.querySelectorAll('#twoStops stop')
    expect(stops).toHaveLength(2)
    expect(stops[0].getAttribute('offset')).toBe('0%')
    expect(stops[1].getAttribute('offset')).toBe('95%')
  })

  it('defaults the top stop opacity to 0.3 and keeps the tail near-transparent at 0.02', () => {
    const c = mount(areaGradient('defaultOpacity', '#f59e0b'))
    const stops = c.querySelectorAll('#defaultOpacity stop')
    expect(stops[0].getAttribute('stop-opacity')).toBe('0.3')
    expect(stops[1].getAttribute('stop-opacity')).toBe('0.02')
  })

  it('honors a custom top opacity while leaving the tail fixed', () => {
    const c = mount(areaGradient('customOpacity', '#a855f7', 0.15))
    const stops = c.querySelectorAll('#customOpacity stop')
    expect(stops[0].getAttribute('stop-opacity')).toBe('0.15')
    expect(stops[1].getAttribute('stop-opacity')).toBe('0.02')
  })

  it('paints both stops with the same color', () => {
    const c = mount(areaGradient('sameColor', '#ef4444', 0.25))
    const stops = c.querySelectorAll('#sameColor stop')
    expect(stops[0].getAttribute('stop-color')).toBe('#ef4444')
    expect(stops[1].getAttribute('stop-color')).toBe('#ef4444')
  })

  it('clamps an over-range opacity down to the SVG maximum of 1', () => {
    const c = mount(areaGradient('overRange', '#3b82f6', 5))
    const stops = c.querySelectorAll('#overRange stop')
    expect(stops[0].getAttribute('stop-opacity')).toBe('1')
  })

  it('clamps a negative opacity up to the SVG minimum of 0', () => {
    const c = mount(areaGradient('underRange', '#3b82f6', -2))
    const stops = c.querySelectorAll('#underRange stop')
    expect(stops[0].getAttribute('stop-opacity')).toBe('0')
  })

  it('falls back to the 0.3 default when opacity is NaN (never emits an invalid stop-opacity)', () => {
    const c = mount(areaGradient('nanOpacity', '#3b82f6', Number.NaN))
    const stops = c.querySelectorAll('#nanOpacity stop')
    expect(stops[0].getAttribute('stop-opacity')).toBe('0.3')
    expect(stops[0].getAttribute('stop-opacity')).not.toBe('NaN')
  })

  it('falls back to the 0.3 default when opacity is Infinity', () => {
    const c = mount(areaGradient('infOpacity', '#3b82f6', Number.POSITIVE_INFINITY))
    const stops = c.querySelectorAll('#infOpacity stop')
    expect(stops[0].getAttribute('stop-opacity')).toBe('0.3')
  })

  it('falls back to currentColor when handed an empty color (e.g. palette[0] on an empty palette)', () => {
    const c = mount(areaGradient('emptyColor', ''))
    const stops = c.querySelectorAll('#emptyColor stop')
    expect(stops[0].getAttribute('stop-color')).toBe('currentColor')
    expect(stops[1].getAttribute('stop-color')).toBe('currentColor')
  })

  it('falls back to currentColor when the color is undefined at runtime', () => {
    const c = mount(areaGradient('undefColor', undefined as unknown as string))
    const stops = c.querySelectorAll('#undefColor stop')
    expect(stops[0].getAttribute('stop-color')).toBe('currentColor')
  })

  it('keeps distinct ids isolated so multiple gradients in one chart never collide', () => {
    const { container } = render(
      <svg>
        {areaGradient('gradA', '#111111', 0.2)}
        {areaGradient('gradB', '#222222', 0.6)}
      </svg>,
    )
    expect(container.querySelector('#gradA')).not.toBeNull()
    expect(container.querySelector('#gradB')).not.toBeNull()
    expect(container.querySelectorAll('linearGradient')).toHaveLength(2)
    expect(container.querySelector('#gradA stop')?.getAttribute('stop-color')).toBe('#111111')
    expect(container.querySelector('#gradB stop')?.getAttribute('stop-color')).toBe('#222222')
  })
})
