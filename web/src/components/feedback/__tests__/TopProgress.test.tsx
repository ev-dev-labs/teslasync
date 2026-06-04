import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import '@/i18n'

// Drive the reduced-motion preference deterministically. Mirrors the
// pattern used in RouteTransition.test.tsx and DataFreshness.test.tsx.
let reducedMotionMock = (): boolean => false
vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMotionMock(),
}))

import { TopProgress } from '../TopProgress'
import {
  globalProgress,
  TRICKLE_INITIAL,
  __resetGlobalProgressForTests,
} from '@/lib/globalProgress'

/**
 * TopProgress component contract.
 *
 * Verifies the bar respects the globalProgress lifecycle, exposes
 * accessible progressbar semantics, and honours prefers-reduced-motion
 * by omitting the width transition class.
 */

describe('TopProgress', () => {
  beforeEach(() => {
    reducedMotionMock = () => false
    __resetGlobalProgressForTests()
  })

  afterEach(() => {
    __resetGlobalProgressForTests()
  })

  it('renders nothing while no consumer is active', () => {
    render(<TopProgress />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('top-progress')).not.toBeInTheDocument()
  })

  it('appears when globalProgress.start() is called and disappears on stop()', () => {
    render(<TopProgress />)

    let stop: (() => void) | null = null
    act(() => {
      stop = globalProgress.start()
    })

    const bar = screen.getByRole('progressbar')
    expect(bar).toBeInTheDocument()
    expect(bar).toHaveAttribute('aria-valuenow', String(TRICKLE_INITIAL))

    act(() => {
      stop?.()
    })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('exposes accessible progressbar semantics with bounds and an i18n label', () => {
    render(<TopProgress />)
    let stop: (() => void) | null = null
    act(() => {
      stop = globalProgress.start()
    })

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuenow')
    expect(bar.getAttribute('aria-label')).toBeTruthy()

    act(() => {
      stop?.()
    })
  })

  it('width style mirrors the current progress percentage', () => {
    render(<TopProgress />)
    let stop: (() => void) | null = null
    act(() => {
      stop = globalProgress.start()
    })

    const bar = screen.getByRole('progressbar') as HTMLDivElement
    expect(bar.style.width).toBe(`${TRICKLE_INITIAL}%`)

    act(() => {
      stop?.()
    })
  })

  it('omits the width transition class when prefers-reduced-motion is set', () => {
    reducedMotionMock = () => true
    render(<TopProgress />)
    act(() => {
      globalProgress.start()
    })

    const bar = screen.getByRole('progressbar')
    expect(bar.className).not.toMatch(/transition-\[width\]/)
    expect(bar.className).not.toMatch(/duration-fast/)
  })

  it('includes the width transition class when reduced motion is not requested', () => {
    reducedMotionMock = () => false
    render(<TopProgress />)
    act(() => {
      globalProgress.start()
    })

    const bar = screen.getByRole('progressbar')
    expect(bar.className).toMatch(/transition-\[width\]/)
    expect(bar.className).toMatch(/duration-fast/)
  })
})
