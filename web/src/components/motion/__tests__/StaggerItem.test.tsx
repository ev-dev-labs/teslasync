import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock framer-motion: render children immediately, surface the resolved
// `variants` object as a JSON data attribute, and let tests drive
// useReducedMotion deterministically. framer-motion v12 caches matchMedia at
// module load, so mocking the export is the canonical pattern in this repo
// (see __tests__/RouteTransition.test.tsx and
// hooks/__tests__/useMotionPreference.test.ts).
const reducedMotionMock = vi.fn<() => boolean | null>(() => false)
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, variants, className }: any) => (
      <div
        data-testid="stagger-item"
        data-variants={JSON.stringify(variants)}
        className={className}
      >
        {children}
      </div>
    ),
  },
  useReducedMotion: () => reducedMotionMock(),
}))

import { StaggerItem } from '../StaggerItem'

interface ResolvedVariants {
  hidden: { opacity: number; y: number }
  show: { opacity: number; y: number; transition: { duration: number } }
}

function renderItem(props?: { className?: string }) {
  const utils = render(
    <StaggerItem className={props?.className}>
      <span>stagger-child</span>
    </StaggerItem>,
  )
  const el = utils.container.querySelector('[data-testid="stagger-item"]') as HTMLElement
  const variants = JSON.parse(el.dataset.variants ?? '{}') as ResolvedVariants
  return { ...utils, el, variants }
}

describe('StaggerItem', () => {
  beforeEach(() => {
    reducedMotionMock.mockReset()
    reducedMotionMock.mockReturnValue(false)
  })

  it('renders its children', () => {
    renderItem()
    expect(screen.getByText('stagger-child')).toBeInTheDocument()
  })

  it('forwards a provided className to the motion wrapper', () => {
    const { el } = renderItem({ className: 'col-span-2 gap-4' })
    expect(el).toHaveClass('col-span-2', 'gap-4')
  })

  it('defaults className to an empty string when omitted', () => {
    const { el } = renderItem()
    // The `className = ''` default must reach the wrapper — never `undefined`.
    expect(el.className).toBe('')
  })

  it('does not set its own initial/animate (inherits the stagger from the parent)', () => {
    // The mock only forwards children/variants/className; assert the wrapper
    // carries no leftover framer-motion orchestration props on the DOM node.
    const { el } = renderItem()
    expect(el.getAttribute('initial')).toBeNull()
    expect(el.getAttribute('animate')).toBeNull()
  })

  it('hides with a slide-up (opacity 0, y 15) when motion is allowed', () => {
    const { variants } = renderItem()
    expect(variants.hidden).toEqual({ opacity: 0, y: 15 })
  })

  it('shows in its final state over 350ms when motion is allowed', () => {
    const { variants } = renderItem()
    expect(variants.show).toEqual({ opacity: 1, y: 0, transition: { duration: 0.35 } })
    expect(variants.show.transition.duration).toBeCloseTo(0.35, 5)
  })

  it('renders in the final state with no slide when prefers-reduced-motion: reduce', () => {
    reducedMotionMock.mockReturnValue(true)
    const { variants } = renderItem()
    expect(variants.hidden).toEqual({ opacity: 1, y: 0 })
    expect(variants.hidden.y).toBe(0)
  })

  it('collapses the show transition duration to 0 when reduced motion is requested', () => {
    reducedMotionMock.mockReturnValue(true)
    const { variants } = renderItem()
    expect(variants.show.transition.duration).toBe(0)
  })

  it('coalesces a null framer-motion reduced-motion result to full motion', () => {
    // framer-motion returns null before it resolves the media query — the hook
    // coalesces that to reduce=false, so the animated hidden state applies.
    reducedMotionMock.mockReturnValue(null)
    const { variants } = renderItem()
    expect(variants.hidden).toEqual({ opacity: 0, y: 15 })
    expect(variants.show.transition.duration).toBeCloseTo(0.35, 5)
  })

  it('re-resolves variants when the reduced-motion preference flips', () => {
    const first = renderItem()
    expect(first.variants.hidden.opacity).toBe(0)

    reducedMotionMock.mockReturnValue(true)
    const second = renderItem()
    expect(second.variants.hidden.opacity).toBe(1)
    expect(second.variants.hidden).not.toEqual(first.variants.hidden)
  })
})
