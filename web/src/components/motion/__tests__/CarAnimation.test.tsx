/**
 * CarAnimation.tsx — behaviour, branch, edge-case, and a11y cover for every
 * export in the file: <CarAnimation>, <ChargingBolt>, <BatteryFillAnimation>,
 * and <WheelSpin>. These are decorative SVG motion primitives (no network, no
 * data hooks), so the interesting surface is:
 *
 *   • STRUCTURE  — the labelled <svg> renders with the right viewBox and the
 *                  `size` prop scales the outer element without distorting the
 *                  fixed-viewBox geometry.
 *   • A11Y       — each graphic exposes role="img" + a real, translated
 *                  accessible name (icon-only graphics are invisible to AT
 *                  otherwise).
 *   • REDUCED    — the whole file honours `prefers-reduced-motion`: entry
 *                  animations collapse to `initial={false}` + 0-duration and
 *                  the looping pulses become a single static value.
 *   • BATTERY    — the fill gauge maps level→width inside the fixed 0–48
 *                  viewBox, clamps out-of-range / non-finite input, and (the
 *                  regression this suite locks in) stays size-independent so a
 *                  100% battery fills completely at any `size`.
 *
 * framer-motion is mocked so `<motion.*>` renders the plain SVG element with
 * the animation props surfaced as inspectable data-attributes, and
 * `useReducedMotion()` is driven deterministically (the canonical pattern from
 * RouteTransition.test.tsx). react-i18next resolves to the English fallback so
 * copy is deterministic. No real network or timers are touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { reducedMotionMock } = vi.hoisted(() => ({
  reducedMotionMock: vi.fn<() => boolean | null>(() => false),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      // t(key, defaultValue, opts?) → resolve to the English fallback string so
      // assertions read the real copy rather than the i18n key.
      t: (key: string, defaultValue?: unknown) =>
        typeof defaultValue === 'string' ? defaultValue : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

// Render every `motion.<tag>` as the underlying SVG element, dropping the
// framer-only props but surfacing initial/animate/transition as data-attrs so
// the reduced-motion branches are assertable.
vi.mock('framer-motion', async () => {
  const React = await import('react')
  const FRAMER_ONLY = new Set([
    'variants', 'whileHover', 'whileTap', 'whileFocus', 'whileInView', 'whileDrag',
    'drag', 'dragConstraints', 'dragElastic', 'dragMomentum', 'layout', 'layoutId',
    'layoutScroll', 'layoutDependency', 'onAnimationStart', 'onAnimationComplete',
    'onUpdate', 'onHoverStart', 'onHoverEnd', 'onTap', 'onTapStart', 'onTapCancel',
    'custom', 'inherit', 'transformTemplate', 'style',
  ])
  const makeMotion = (tag: string) =>
    function MotionEl({ children, initial, animate, transition, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) {
      const domProps: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rest)) {
        if (!FRAMER_ONLY.has(k)) domProps[k] = v
      }
      return React.createElement(
        tag,
        {
          ...domProps,
          'data-initial': JSON.stringify(initial ?? null),
          'data-animate': JSON.stringify(animate ?? null),
          'data-duration': (transition as { duration?: number } | undefined)?.duration,
        },
        children,
      )
    }
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined
      return makeMotion(prop)
    },
  })
  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useReducedMotion: () => reducedMotionMock(),
  }
})

import { CarAnimation, ChargingBolt, BatteryFillAnimation, WheelSpin } from '../CarAnimation'

const GOOD = '#10b981'
const WARN = '#f59e0b'
const BAD = '#ef4444'

/** Parse a `data-animate` blob back into the original animate object. */
function animateOf(el: Element | null) {
  return JSON.parse(el?.getAttribute('data-animate') ?? 'null')
}

beforeEach(() => {
  reducedMotionMock.mockReset()
  reducedMotionMock.mockReturnValue(false)
})
afterEach(cleanup)

describe('CarAnimation', () => {
  it('renders a single labelled graphic wrapping a 240×96 viewBox svg', () => {
    const { container } = render(<CarAnimation />)

    const fig = screen.getByRole('img', { name: 'Tesla vehicle illustration' })
    expect(fig).toBeInTheDocument()

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('viewBox', '0 0 240 96')
  })

  it('scales the svg from the size prop (keeping the 2.5:1 aspect) and forwards className', () => {
    const { container } = render(<CarAnimation size={200} className="drop-shadow" />)

    const svg = container.querySelector('svg') as SVGSVGElement
    // width = size, height = size * 0.4 → 200 × 80.
    expect(svg).toHaveAttribute('width', '200')
    expect(svg).toHaveAttribute('height', '80')
    // className lands on the flex wrapper, not the svg.
    expect(screen.getByRole('img', { name: 'Tesla vehicle illustration' })).toHaveClass('drop-shadow')
  })

  it('defaults to size 120 → a 120×48 svg', () => {
    const { container } = render(<CarAnimation />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg).toHaveAttribute('width', '120')
    expect(svg).toHaveAttribute('height', '48')
  })

  it('draws the body in and loops the head/tail-light pulse by default', () => {
    const { container } = render(<CarAnimation />)

    // Body path animates its pathLength from 0 over 1.5s.
    const body = container.querySelector('path') as SVGPathElement
    expect(body.getAttribute('data-initial')).toContain('pathLength')
    expect(Number(body.getAttribute('data-duration'))).toBeCloseTo(1.5, 5)

    // Headlight pulses through a keyframe array (looping opacity).
    const headlight = container.querySelector('ellipse[cx="228"]')
    expect(Array.isArray(animateOf(headlight).opacity)).toBe(true)
  })

  it('honours reduced motion: no entry animation, 0-duration, and a static light', () => {
    reducedMotionMock.mockReturnValue(true)
    const { container } = render(<CarAnimation />)

    const body = container.querySelector('path') as SVGPathElement
    // initial={false} → framer skips the entry animation entirely.
    expect(body.getAttribute('data-initial')).toBe('false')
    expect(Number(body.getAttribute('data-duration'))).toBe(0)

    // Headlight is a single static opacity, not an animated keyframe array.
    const headlight = container.querySelector('ellipse[cx="228"]')
    expect(animateOf(headlight)).toEqual({ opacity: 0.8 })
  })
})

describe('ChargingBolt', () => {
  it('renders a labelled "Charging" graphic sized from the prop, with className', () => {
    const { container } = render(<ChargingBolt size={40} className="text-accent" />)

    const svg = screen.getByRole('img', { name: 'Charging' })
    expect(svg).toHaveAttribute('width', '40')
    expect(svg).toHaveAttribute('height', '40')
    expect(svg).toHaveClass('text-accent')
    // The bolt path is present.
    expect(container.querySelector('path')).not.toBeNull()
  })

  it('pulses the bolt fill by default and freezes it under reduced motion', () => {
    const { container: normal } = render(<ChargingBolt />)
    const boltNormal = normal.querySelector('path')
    // Looping fillOpacity keyframes while motion is allowed.
    expect(Array.isArray(animateOf(boltNormal).fillOpacity)).toBe(true)
    // svg default size is 32.
    expect(screen.getByRole('img', { name: 'Charging' })).toHaveAttribute('width', '32')
    cleanup()

    reducedMotionMock.mockReturnValue(true)
    const { container: reduced } = render(<ChargingBolt />)
    const boltReduced = reduced.querySelector('path')
    // Collapses to a single static fillOpacity, no keyframe loop.
    expect(animateOf(boltReduced)).toEqual({ fillOpacity: 0.2 })
    // Entry animation on the svg collapses to 0s too.
    const svgReduced = reduced.querySelector('svg') as SVGSVGElement
    expect(Number(svgReduced.getAttribute('data-duration'))).toBe(0)
  })
})

describe('BatteryFillAnimation', () => {
  /** The animated fill rect is the only <rect> carrying data-animate. */
  const fillRect = (root: HTMLElement) => root.querySelector('rect[data-animate]') as SVGRectElement
  const fillWidth = (root: HTMLElement) => Number(fillRect(root).getAttribute('width'))

  it('colours the fill by charge level: good ≥60, warn 30–59, bad <30', () => {
    const { container: hi } = render(<BatteryFillAnimation level={80} />)
    expect(fillRect(hi)).toHaveAttribute('fill', GOOD)
    cleanup()

    const { container: mid } = render(<BatteryFillAnimation level={45} />)
    expect(fillRect(mid)).toHaveAttribute('fill', WARN)
    cleanup()

    const { container: lo } = render(<BatteryFillAnimation level={12} />)
    expect(fillRect(lo)).toHaveAttribute('fill', BAD)
  })

  it('maps level to fill width inside the fixed 0–48 viewBox (0 → empty, 100 → full 38)', () => {
    const { container: empty } = render(<BatteryFillAnimation level={0} />)
    expect(fillWidth(empty)).toBeCloseTo(0, 5)
    cleanup()

    const { container: half } = render(<BatteryFillAnimation level={50} />)
    expect(fillWidth(half)).toBeCloseTo(19, 5)
    cleanup()

    const { container: full } = render(<BatteryFillAnimation level={100} />)
    expect(fillWidth(full)).toBeCloseTo(38, 5)
  })

  it('clamps out-of-range, negative, and non-finite levels', () => {
    // > 100 saturates at a full bar.
    const { container: over } = render(<BatteryFillAnimation level={150} />)
    expect(fillWidth(over)).toBeCloseTo(38, 5)
    expect(fillRect(over)).toHaveAttribute('fill', GOOD)
    cleanup()

    // Negative collapses to empty (and reads as a critical/bad charge).
    const { container: neg } = render(<BatteryFillAnimation level={-25} />)
    expect(fillWidth(neg)).toBeCloseTo(0, 5)
    expect(fillRect(neg)).toHaveAttribute('fill', BAD)
    cleanup()

    // NaN never produces a NaN width attribute — it degrades to empty.
    const { container: nan } = render(<BatteryFillAnimation level={Number.NaN} />)
    expect(Number.isNaN(fillWidth(nan))).toBe(false)
    expect(fillWidth(nan)).toBeCloseTo(0, 5)
  })

  it('keeps the gauge geometry size-independent: 100% fills fully at any size (regression guard)', () => {
    // The rendered <svg> scales with `size`, but the fill lives in the fixed
    // 0–48 viewBox — a full battery must read as 38 regardless of size.
    const { container: small } = render(<BatteryFillAnimation level={100} size={24} />)
    expect(small.querySelector('svg')).toHaveAttribute('width', '24')
    expect(fillWidth(small)).toBeCloseTo(38, 5)
    cleanup()

    const { container: large } = render(<BatteryFillAnimation level={100} size={96} />)
    expect(large.querySelector('svg')).toHaveAttribute('width', '96')
    expect(fillWidth(large)).toBeCloseTo(38, 5)
  })

  it('exposes an accessible battery label for assistive tech', () => {
    render(<BatteryFillAnimation level={80} />)
    const gauge = screen.getByRole('img', { name: /battery/i })
    expect(gauge).toBeInTheDocument()
  })

  it('jumps straight to the target fill under reduced motion', () => {
    reducedMotionMock.mockReturnValue(true)
    const { container } = render(<BatteryFillAnimation level={70} />)

    const rect = fillRect(container)
    // No width-from-0 entry animation; the rect renders at its final width.
    expect(rect.getAttribute('data-initial')).toBe('false')
    expect(Number(rect.getAttribute('data-duration'))).toBe(0)
    expect(Number(rect.getAttribute('width'))).toBeCloseTo(26.6, 5)
  })
})

describe('WheelSpin', () => {
  it('renders a labelled "Loading" hub with five evenly-spaced spokes at the default size', () => {
    const { container } = render(<WheelSpin />)

    const svg = screen.getByRole('img', { name: 'Loading' })
    expect(svg).toHaveAttribute('width', '24')

    const spokes = container.querySelectorAll('line')
    expect(spokes).toHaveLength(5)
    // Angles are applied as rotate() transforms around the hub centre.
    expect(spokes[1]).toHaveAttribute('transform', 'rotate(72 12 12)')
  })

  it('spins continuously by default and freezes when reduced motion is requested', () => {
    const { container: spinning } = render(<WheelSpin size={16} />)
    const gSpinning = spinning.querySelector('g') as SVGGElement
    expect(animateOf(gSpinning)).toEqual({ rotate: 360 })
    expect(spinning.querySelector('svg')).toHaveAttribute('width', '16')
    cleanup()

    reducedMotionMock.mockReturnValue(true)
    const { container: frozen } = render(<WheelSpin />)
    const gFrozen = frozen.querySelector('g') as SVGGElement
    expect(animateOf(gFrozen)).toEqual({ rotate: 0 })
    expect(Number(gFrozen.getAttribute('data-duration'))).toBe(0)
  })
})
