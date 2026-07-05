/**
 * AreaChartWrapper unit tests.
 *
 * Two testable surfaces:
 *
 *  1. `resolveAreaTooltip` — the pure branch logic behind the Recharts
 *     tooltip `formatter`. jsdom has no layout, so a real hover never fires
 *     the formatter; testing the extracted function covers the label
 *     fallback + y-formatter branches directly.
 *
 *  2. `<AreaChartWrapper>` DOM — Recharts' `<ResponsiveContainer>` measures
 *     its parent via ResizeObserver, which jsdom reports as 0×0, so the inner
 *     `<AreaChart>` never paints. We replace the container with a pass-through
 *     that hands the chart a concrete size, letting Recharts render the real
 *     SVG (gradients, axes, area paths) we assert on. Never hits the network —
 *     this is a pure presentational component fed entirely by props.
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AreaChartWrapper, resolveAreaTooltip, type SeriesConfig } from './AreaChartWrapper'

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 640, height: 240 }),
  }
})

const series: SeriesConfig[] = [
  { key: 'energy', label: 'Energy', color: '#10b981' },
  { key: 'power', label: 'Power', color: '#3b82f6' },
]

const data = [
  { i: '0', energy: 1, power: 4 },
  { i: '1', energy: 2, power: 5 },
  { i: '2', energy: 3, power: 6 },
]

describe('resolveAreaTooltip', () => {
  it('maps a known series key to its friendly label', () => {
    expect(resolveAreaTooltip(series, 42, 'power')).toEqual([42, 'Power'])
  })

  it('falls back to the raw dataKey when the series is unknown', () => {
    expect(resolveAreaTooltip(series, 7, 'mystery')).toEqual([7, 'mystery'])
  })

  it('applies the y-axis formatter to the value while keeping the label', () => {
    const yFormatter = (v: number) => `${v.toFixed(1)} kWh`
    expect(resolveAreaTooltip(series, 3.14159, 'energy', yFormatter)).toEqual([
      '3.1 kWh',
      'Energy',
    ])
  })

  it('formats the value even when the series is unknown, keeping the raw name', () => {
    expect(resolveAreaTooltip(series, 5, 'ghost', (v) => `#${v}`)).toEqual(['#5', 'ghost'])
  })

  it('returns the raw numeric value (not a string) when no formatter is given', () => {
    const [value, label] = resolveAreaTooltip(series, 0, 'energy')
    expect(value).toBe(0)
    expect(label).toBe('Energy')
  })

  it('tolerates an empty series list without throwing (null-safety)', () => {
    expect(resolveAreaTooltip([], 9, 'anything')).toEqual([9, 'anything'])
  })
})

describe('AreaChartWrapper', () => {
  it('merges the default w-full class with a caller-supplied className', () => {
    const { container } = render(
      <AreaChartWrapper data={data} xKey="i" series={series} className="mt-4" />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('w-full')
    expect(root).toHaveClass('mt-4')
  })

  it('forwards its ref to the outer container element', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(<AreaChartWrapper ref={ref} data={data} xKey="i" series={series} />)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
    expect(ref.current).toHaveClass('w-full')
  })

  it('renders one gradient and one area per series, wired together by id', () => {
    const { container } = render(<AreaChartWrapper data={data} xKey="i" series={series} />)

    const ids = Array.from(container.querySelectorAll('linearGradient')).map((g) =>
      g.getAttribute('id'),
    )
    expect(ids).toEqual(['gradient-energy', 'gradient-power'])

    const areaFills = Array.from(container.querySelectorAll('.recharts-area-area')).map((p) =>
      p.getAttribute('fill'),
    )
    expect(areaFills).toEqual(['url(#gradient-energy)', 'url(#gradient-power)'])
  })

  it('renders both X and Y axes for the provided keys', () => {
    const { container } = render(<AreaChartWrapper data={data} xKey="i" series={series} />)
    expect(container.querySelector('.recharts-xAxis')).not.toBeNull()
    expect(container.querySelector('.recharts-yAxis')).not.toBeNull()
  })

  it('renders an svg but no gradients or areas for an empty series list', () => {
    const { container } = render(<AreaChartWrapper data={data} xKey="i" series={[]} />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelectorAll('linearGradient')).toHaveLength(0)
    expect(container.querySelectorAll('.recharts-area')).toHaveLength(0)
  })

  it('does not throw when data/series are undefined at runtime (defensive guards)', () => {
    // Props are typed as required, but the `?? []` guards must keep the
    // component from crashing if an untyped caller passes undefined.
    expect(() =>
      render(
        <AreaChartWrapper
          data={undefined as unknown as Record<string, unknown>[]}
          xKey="i"
          series={undefined as unknown as SeriesConfig[]}
        />,
      ),
    ).not.toThrow()
  })

  it('exposes an accessible image role + label only when ariaLabel is provided', () => {
    const { rerender } = render(
      <AreaChartWrapper data={data} xKey="i" series={series} ariaLabel="Energy over time" />,
    )
    expect(screen.getByRole('img', { name: 'Energy over time' })).toBeInTheDocument()

    // Without an ariaLabel the wrapper must not advertise a bogus img role.
    rerender(<AreaChartWrapper data={data} xKey="i" series={series} />)
    expect(screen.queryByRole('img')).toBeNull()
  })
})
