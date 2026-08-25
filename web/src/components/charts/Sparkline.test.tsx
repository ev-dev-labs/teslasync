/**
 * Sparkline — behaviour, geometry, robustness and a11y.
 *
 * The component is a low-level SVG primitive with no data-fetching, so the
 * tests focus on the pure geometry mapping and the three real bugs the
 * hardening pass fixed:
 *   1. a single sample used to divide by (n-1)===0 → NaN coordinates;
 *   2. a non-finite sample poisoned Math.min/Math.max → NaN coordinates;
 *   3. the gradient id was derived from `color`, producing invalid /
 *      collision-prone `url(#…)` refs for non-hex colours.
 */

import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Sparkline } from './Sparkline'

// Deterministic i18n: return the developer fallback verbatim.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

/** First (line) polyline: fill=none, stroke=colour. */
function linePoints(container: HTMLElement): string {
  const polylines = container.querySelectorAll('polyline')
  return polylines[0]?.getAttribute('points') ?? ''
}

describe('Sparkline — empty / degenerate input', () => {
  it('renders nothing for an empty series', () => {
    const { container } = render(<Sparkline data={[]} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when every sample is non-finite', () => {
    const { container } = render(<Sparkline data={[NaN, Infinity, -Infinity]} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders nothing when data is nullish (defensive)', () => {
    // Callers occasionally forward an unresolved value; must not throw.
    const { container } = render(<Sparkline data={undefined as unknown as number[]} />)
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('Sparkline — geometry mapping', () => {
  it('maps the minimum to the bottom and the maximum to the top', () => {
    // data [0,10] over 100×30: min→y=height(30), max→y=0.
    const { container } = render(<Sparkline data={[0, 10]} width={100} height={30} />)
    expect(linePoints(container)).toBe('0,30 100,0')
  })

  it('spreads intermediate samples evenly across the width', () => {
    const { container } = render(<Sparkline data={[0, 5, 10]} width={100} height={30} />)
    expect(linePoints(container)).toBe('0,30 50,15 100,0')
  })

  it('renders a decreasing series top-left to bottom-right', () => {
    const { container } = render(<Sparkline data={[10, 0]} width={100} height={30} />)
    expect(linePoints(container)).toBe('0,0 100,30')
  })

  it('draws a flat line at the bottom when all values are equal', () => {
    const { container } = render(<Sparkline data={[5, 5, 5]} width={100} height={30} />)
    // range collapses to 1, every sample maps to y=height.
    expect(linePoints(container)).toBe('0,30 50,30 100,30')
  })

  it('emits an area-fill polyline that closes back to the baseline', () => {
    const { container } = render(<Sparkline data={[0, 10]} width={100} height={30} />)
    const polylines = container.querySelectorAll('polyline')
    expect(polylines.length).toBe(2)
    const area = polylines[1]?.getAttribute('points') ?? ''
    expect(area).toContain('0,30 100,0') // the line segment
    expect(area.startsWith('0,30')).toBe(true)
    expect(area.endsWith('100,30')).toBe(true)
  })
})

describe('Sparkline — single-sample bug fix (no NaN)', () => {
  it('draws a full-width flat line for a lone sample instead of NaN', () => {
    const { container } = render(<Sparkline data={[7]} width={100} height={30} />)
    expect(linePoints(container)).toBe('0,30 100,30')
    expect(container.innerHTML).not.toContain('NaN')
  })
})

describe('Sparkline — non-finite filtering (no NaN)', () => {
  it('ignores interleaved NaN/Infinity but plots the finite samples', () => {
    const { container } = render(
      <Sparkline data={[0, NaN, 10, Infinity]} width={100} height={30} />,
    )
    // Filtered series is [0,10] → identical to the clean two-point case.
    expect(linePoints(container)).toBe('0,30 100,0')
    expect(container.innerHTML).not.toContain('NaN')
    expect(container.innerHTML).not.toContain('Infinity')
  })
})

describe('Sparkline — styling props', () => {
  it('reflects width, height and colour on the SVG and stroke', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} color="#ff0066" width={120} height={40} />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('120')
    expect(svg?.getAttribute('height')).toBe('40')
    const line = container.querySelectorAll('polyline')[0]
    expect(line?.getAttribute('stroke')).toBe('#ff0066')
  })

  it('uses the default cyan accent when no colour is supplied', () => {
    const { container } = render(<Sparkline data={[1, 2]} />)
    const line = container.querySelectorAll('polyline')[0]
    expect(line?.getAttribute('stroke')).toBe('var(--theme-primary, #3b82f6)')
    const stops = container.querySelectorAll('stop')
    expect(stops[0]?.getAttribute('stop-color')).toBe('var(--theme-primary, #3b82f6)')
  })
})

describe('Sparkline — gradient id safety', () => {
  it('produces a CSS-URL-safe id even for a non-hex colour', () => {
    const { container } = render(<Sparkline data={[1, 2]} color="rgb(0, 0, 0)" />)
    const grad = container.querySelector('linearGradient')
    const id = grad?.getAttribute('id') ?? ''
    // No parens/commas/spaces that would break url(#…).
    expect(id).toMatch(/^sg-[A-Za-z0-9]+$/)
    const area = container.querySelectorAll('polyline')[1]
    expect(area?.getAttribute('fill')).toBe(`url(#${id})`)
  })

  it('gives each instance a distinct gradient id (no collisions)', () => {
    const { container } = render(
      <>
        <Sparkline data={[1, 2]} color="#00f0ff" />
        <Sparkline data={[3, 4]} color="#00f0ff" />
      </>,
    )
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((g) =>
      g.getAttribute('id'),
    )
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})

describe('Sparkline — accessibility', () => {
  it('exposes the SVG as an image with a default trend label', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('role')).toBe('img')
    expect(svg?.getAttribute('aria-label')).toBe('Trend sparkline')
  })

  it('honours an explicit ariaLabel override', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} ariaLabel="Speed over time" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-label')).toBe('Speed over time')
  })
})
