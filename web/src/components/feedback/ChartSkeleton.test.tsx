import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartSkeleton } from './ChartSkeleton'

/**
 * ChartSkeleton — animated chart-shaped loading placeholder.
 *
 * The contract we lock down here:
 *  - It announces itself as an accessible `role="status"` busy region so screen
 *    readers identify the loading state (parity with the other feedback
 *    skeletons), with an overridable label.
 *  - It renders exactly `bars` decorative bars, defaulting to 7, and tolerates
 *    hostile input (0, negative, fractional, NaN, Infinity) without throwing.
 *  - Bar heights are DETERMINISTIC — the old `Math.random()` implementation
 *    re-rolled every render, causing jitter and making the output untestable.
 */

const bars = (region: HTMLElement) => Array.from(region.children) as HTMLElement[]
const heightsOf = (region: HTMLElement) => bars(region).map((b) => b.style.height)

describe('ChartSkeleton', () => {
  it('renders an accessible busy status region by default', () => {
    render(<ChartSkeleton />)
    const region = screen.getByTestId('chart-skeleton')

    expect(region).toBeInTheDocument()
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveAttribute('aria-label', 'Loading chart')
  })

  it('defaults to 7 decorative bars, each hidden from the a11y tree', () => {
    render(<ChartSkeleton />)
    const region = screen.getByTestId('chart-skeleton')

    expect(region.children).toHaveLength(7)
    for (const bar of bars(region)) {
      expect(bar).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('renders the requested number of bars', () => {
    render(<ChartSkeleton bars={4} />)
    expect(screen.getByTestId('chart-skeleton').children).toHaveLength(4)
  })

  it('honours an explicit request for zero bars without crashing', () => {
    render(<ChartSkeleton bars={0} />)
    const region = screen.getByTestId('chart-skeleton')
    // Still a valid status region — just no bars inside it.
    expect(region).toHaveAttribute('role', 'status')
    expect(region.children).toHaveLength(0)
  })

  it('clamps negative and fractional bar counts instead of throwing', () => {
    const { container: negative } = render(<ChartSkeleton bars={-5} />)
    expect(
      (negative.querySelector('[data-testid="chart-skeleton"]') as HTMLElement).children,
    ).toHaveLength(0)

    const { container: fractional } = render(<ChartSkeleton bars={3.9} />)
    expect(
      (fractional.querySelector('[data-testid="chart-skeleton"]') as HTMLElement).children,
    ).toHaveLength(3)
  })

  it('falls back to the default count for non-finite bar counts', () => {
    const { container: nan } = render(<ChartSkeleton bars={Number.NaN} />)
    expect(
      (nan.querySelector('[data-testid="chart-skeleton"]') as HTMLElement).children,
    ).toHaveLength(7)

    const { container: infinite } = render(<ChartSkeleton bars={Number.POSITIVE_INFINITY} />)
    expect(
      (infinite.querySelector('[data-testid="chart-skeleton"]') as HTMLElement).children,
    ).toHaveLength(7)
  })

  it('produces deterministic bar heights across renders (no Math.random jitter)', () => {
    const { container: first } = render(<ChartSkeleton bars={6} />)
    const firstHeights = heightsOf(
      first.querySelector('[data-testid="chart-skeleton"]') as HTMLElement,
    )

    const { container: second } = render(<ChartSkeleton bars={6} />)
    const secondHeights = heightsOf(
      second.querySelector('[data-testid="chart-skeleton"]') as HTMLElement,
    )

    expect(firstHeights).toEqual(secondHeights)
  })

  it('renders varied bar heights within a valid CSS percentage range', () => {
    render(<ChartSkeleton bars={7} />)
    const region = screen.getByTestId('chart-skeleton')
    const values = heightsOf(region).map((h) => Number.parseFloat(h))

    // Every bar carries a percentage height.
    for (const h of heightsOf(region)) {
      expect(h).toContain('%')
    }
    // Clamped into the [8, 95] window the source guarantees.
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(8)
      expect(v).toBeLessThanOrEqual(95)
    }
    // A chart silhouette needs contrast — not every bar the same height.
    expect(new Set(values).size).toBeGreaterThan(1)
  })

  it('applies the caller-provided className to the container', () => {
    render(<ChartSkeleton className="mt-8 h-40" />)
    const region = screen.getByTestId('chart-skeleton')
    expect(region.className).toContain('mt-8')
    expect(region.className).toContain('h-40')
    // Base layout classes are preserved alongside the override.
    expect(region.className).toContain('flex')
  })

  it('supports an overridable accessible label for localisation', () => {
    render(<ChartSkeleton label="Loading battery chart" />)
    expect(screen.getByTestId('chart-skeleton')).toHaveAttribute(
      'aria-label',
      'Loading battery chart',
    )
  })
})
