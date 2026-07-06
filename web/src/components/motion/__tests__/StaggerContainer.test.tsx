import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock framer-motion the same way the sibling motion tests do: render the
// motion.div as a plain <div>, ignore the animation runtime, and surface the
// orchestration props (initial/animate labels + variants) via data-attributes
// so they can be asserted deterministically. framer-motion v12 caches
// matchMedia at module load, so mocking `useReducedMotion` is the canonical way
// to drive the reduced-motion branch (see RouteTransition.test.tsx and
// hooks/__tests__/useMotionPreference.test.ts). `variantsSpy` lets us assert
// the memoised variants keep a stable reference across re-renders.
const { reducedMotionMock, variantsSpy } = vi.hoisted(() => ({
  reducedMotionMock: vi.fn<() => boolean | null>(() => false),
  variantsSpy: vi.fn<(variants: unknown) => void>(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, variants, initial, animate, className, ...rest }: any) => {
      variantsSpy(variants)
      return (
        <div
          data-testid="stagger-root"
          data-initial={initial}
          data-animate={animate}
          data-variants={variants ? JSON.stringify(variants) : undefined}
          className={className}
          {...rest}
        >
          {children}
        </div>
      )
    },
  },
  useReducedMotion: () => reducedMotionMock(),
}))

import { StaggerContainer } from '../StaggerContainer'

function getRoot() {
  return screen.getByTestId('stagger-root')
}

function getVariants(): { hidden: unknown; show: { transition: { staggerChildren: number } } } {
  const raw = getRoot().getAttribute('data-variants')
  expect(raw).not.toBeNull()
  return JSON.parse(raw as string)
}

describe('StaggerContainer', () => {
  beforeEach(() => {
    reducedMotionMock.mockReset()
    reducedMotionMock.mockReturnValue(false)
    variantsSpy.mockReset()
  })

  it('renders its child content', () => {
    render(
      <StaggerContainer>
        <span>child-content</span>
      </StaggerContainer>,
    )
    expect(screen.getByText('child-content')).toBeInTheDocument()
  })

  it('renders every child when multiple are provided', () => {
    render(
      <StaggerContainer>
        <span>first</span>
        <span>second</span>
        <span>third</span>
      </StaggerContainer>,
    )
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
    expect(screen.getByText('third')).toBeInTheDocument()
  })

  it('drives the framer-motion orchestration via the hidden → show variant labels', () => {
    render(
      <StaggerContainer>
        <span>x</span>
      </StaggerContainer>,
    )
    const root = getRoot()
    expect(root.getAttribute('data-initial')).toBe('hidden')
    expect(root.getAttribute('data-animate')).toBe('show')
  })

  it('staggers children by 0.06s and keeps an empty hidden variant when motion is enabled', () => {
    render(
      <StaggerContainer>
        <span>x</span>
      </StaggerContainer>,
    )
    const variants = getVariants()
    expect(variants.hidden).toEqual({})
    expect(variants.show.transition.staggerChildren).toBe(0.06)
  })

  it('collapses the stagger to 0 when prefers-reduced-motion: reduce', () => {
    reducedMotionMock.mockReturnValue(true)
    render(
      <StaggerContainer>
        <span>x</span>
      </StaggerContainer>,
    )
    expect(getVariants().show.transition.staggerChildren).toBe(0)
  })

  it('treats a null reduced-motion reading (framer-motion first paint) as motion-enabled', () => {
    reducedMotionMock.mockReturnValue(null)
    render(
      <StaggerContainer>
        <span>x</span>
      </StaggerContainer>,
    )
    expect(getVariants().show.transition.staggerChildren).toBe(0.06)
  })

  it('applies a caller-provided className to the motion root', () => {
    render(
      <StaggerContainer className="grid grid-cols-2 gap-3">
        <span>x</span>
      </StaggerContainer>,
    )
    expect(getRoot()).toHaveClass('grid', 'grid-cols-2', 'gap-3')
  })

  it('defaults className to an empty string when omitted', () => {
    render(
      <StaggerContainer>
        <span>x</span>
      </StaggerContainer>,
    )
    expect(getRoot().className).toBe('')
  })

  it('memoises the variants so the reference is stable across unrelated re-renders', () => {
    const { rerender } = render(
      <StaggerContainer className="a">
        <span>x</span>
      </StaggerContainer>,
    )
    const first = variantsSpy.mock.calls.at(-1)?.[0]
    // Re-render with a different className but the SAME motion preference —
    // the memoised variants object must not be recreated.
    rerender(
      <StaggerContainer className="b">
        <span>x</span>
      </StaggerContainer>,
    )
    const second = variantsSpy.mock.calls.at(-1)?.[0]
    expect(variantsSpy).toHaveBeenCalled()
    expect(second).toBe(first)
  })
})
