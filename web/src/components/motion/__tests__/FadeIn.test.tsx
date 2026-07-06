import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock framer-motion: render `motion.div` as a plain div, capture the exact
// animation props it receives (initial/animate/transition), and let tests drive
// `useReducedMotion` deterministically. framer-motion v12 caches matchMedia at
// module load, so mocking the export is the canonical pattern here (see
// hooks/__tests__/useMotionPreference.test.ts and RouteTransition.test.tsx).
const reducedMotionMock = vi.fn<() => boolean | null>(() => false)
let lastMotionProps: { initial: unknown; animate: unknown; transition: any; className: unknown } | null = null

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, animate, transition, className, ...rest }: any) => {
      lastMotionProps = { initial, animate, transition, className }
      return (
        <div
          data-testid="fadein-root"
          className={className}
          data-initial={JSON.stringify(initial)}
          data-duration={transition?.duration}
          data-delay={transition?.delay}
          data-ease={transition?.ease}
          {...rest}
        >
          {children}
        </div>
      )
    },
  },
  useReducedMotion: () => reducedMotionMock(),
}))

import { FadeIn } from '../FadeIn'

describe('FadeIn', () => {
  beforeEach(() => {
    reducedMotionMock.mockReset()
    reducedMotionMock.mockReturnValue(false)
    lastMotionProps = null
  })

  it('renders its children', () => {
    render(
      <FadeIn>
        <span>fade-child</span>
      </FadeIn>,
    )
    expect(screen.getByText('fade-child')).toBeInTheDocument()
  })

  it('forwards className to the animated wrapper and defaults it to empty', () => {
    const { rerender } = render(<FadeIn className="my-panel">a</FadeIn>)
    expect(screen.getByTestId('fadein-root')).toHaveClass('my-panel')
    expect(lastMotionProps?.className).toBe('my-panel')

    rerender(<FadeIn>a</FadeIn>)
    expect(lastMotionProps?.className).toBe('')
  })

  it('uses a slide-up entry and 400ms ease-out with no delay by default', () => {
    render(<FadeIn>content</FadeIn>)
    expect(lastMotionProps?.initial).toEqual({ opacity: 0, y: 12 })
    expect(lastMotionProps?.animate).toEqual({ opacity: 1, y: 0 })
    // 400ms expressed in seconds for framer-motion's transition.duration.
    expect(lastMotionProps?.transition).toEqual({ duration: 0.4, delay: 0, ease: 'easeOut' })
  })

  it('passes a positive delay straight through when motion is enabled', () => {
    render(<FadeIn delay={0.25}>content</FadeIn>)
    expect(lastMotionProps?.transition.delay).toBe(0.25)
    expect(screen.getByTestId('fadein-root').dataset.delay).toBe('0.25')
  })

  it('collapses to the final state (no entry, no delay) under reduced motion', () => {
    reducedMotionMock.mockReturnValue(true)
    render(<FadeIn delay={0.9}>content</FadeIn>)
    // initial={false} tells framer-motion to skip the entry animation.
    expect(lastMotionProps?.initial).toBe(false)
    expect(lastMotionProps?.transition.duration).toBe(0)
    expect(lastMotionProps?.transition.delay).toBe(0)
    // The element must still render visibly in its target state.
    expect(lastMotionProps?.animate).toEqual({ opacity: 1, y: 0 })
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('coerces a NaN delay to 0 so children never strand at opacity:0', () => {
    render(<FadeIn delay={Number.NaN}>content</FadeIn>)
    expect(lastMotionProps?.transition.delay).toBe(0)
    expect(Number.isFinite(lastMotionProps?.transition.delay)).toBe(true)
  })

  it('coerces a non-finite (Infinity) delay to 0', () => {
    render(<FadeIn delay={Number.POSITIVE_INFINITY}>content</FadeIn>)
    expect(lastMotionProps?.transition.delay).toBe(0)
  })

  it('clamps a negative delay up to 0', () => {
    render(<FadeIn delay={-3}>content</FadeIn>)
    expect(lastMotionProps?.transition.delay).toBe(0)
  })

  it('re-reads the reduced-motion preference on each render', () => {
    const { rerender } = render(<FadeIn delay={0.5}>content</FadeIn>)
    expect(lastMotionProps?.transition.delay).toBe(0.5)

    reducedMotionMock.mockReturnValue(true)
    rerender(<FadeIn delay={0.5}>content</FadeIn>)
    expect(lastMotionProps?.transition.delay).toBe(0)
    expect(lastMotionProps?.initial).toBe(false)
  })
})
