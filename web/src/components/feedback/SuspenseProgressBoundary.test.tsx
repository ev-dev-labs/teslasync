import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import { SuspenseProgressBoundary } from './SuspenseProgressBoundary'
import {
  globalProgress,
  __getGlobalProgressStateForTests,
  __resetGlobalProgressForTests,
} from '@/lib/globalProgress'

/**
 * SuspenseProgressBoundary contract.
 *
 * The component is the Suspense → globalProgress bridge: mounting the
 * fallback (because a lazy child suspended) MUST activate the global
 * progress bar exactly once, and resolving/unmounting MUST deactivate it.
 * The controller (globalProgress) and the visible bar (TopProgress) are
 * tested elsewhere; these cases lock in the wiring between them.
 */

/**
 * Builds a component whose first render suspends (throws a stable promise)
 * and, once `resolve()` fires, renders its content. Throwing the *same*
 * promise instance on every pending render is what lets React register its
 * retry `.then` and re-render the subtree when the promise settles.
 */
function createSuspender(content: string) {
  let resolveFn: () => void = () => {}
  let status: 'pending' | 'resolved' = 'pending'
  const promise = new Promise<void>((res) => {
    resolveFn = () => {
      status = 'resolved'
      res()
    }
  })
  function Suspender() {
    if (status === 'pending') throw promise
    return <div>{content}</div>
  }
  return { Suspender, resolve: resolveFn, promise }
}

describe('SuspenseProgressBoundary', () => {
  beforeEach(() => {
    __resetGlobalProgressForTests()
  })

  afterEach(() => {
    __resetGlobalProgressForTests()
    vi.restoreAllMocks()
  })

  it('renders children directly and never activates progress when nothing suspends', () => {
    render(
      <SuspenseProgressBoundary fallback={<div>loading…</div>}>
        <div>ready content</div>
      </SuspenseProgressBoundary>,
    )

    expect(screen.getByText('ready content')).toBeInTheDocument()
    expect(screen.queryByText('loading…')).not.toBeInTheDocument()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)
  })

  it('shows the fallback and activates global progress while a child is suspended', () => {
    const { Suspender } = createSuspender('loaded content')

    render(
      <SuspenseProgressBoundary fallback={<div>loading…</div>}>
        <Suspender />
      </SuspenseProgressBoundary>,
    )

    // Fallback visible, real content withheld until the chunk resolves.
    expect(screen.getByText('loading…')).toBeInTheDocument()
    expect(screen.queryByText('loaded content')).not.toBeInTheDocument()
    // Exactly one active consumer — a second start() would read as 2.
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)
  })

  it('calls globalProgress.start exactly once when the fallback mounts', () => {
    const startSpy = vi.spyOn(globalProgress, 'start')
    const { Suspender } = createSuspender('loaded content')

    render(
      <SuspenseProgressBoundary fallback={<div>loading…</div>}>
        <Suspender />
      </SuspenseProgressBoundary>,
    )

    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(startSpy).toHaveReturnedWith(expect.any(Function))
  })

  it('deactivates global progress and swaps in the real content once the child resolves', async () => {
    const { Suspender, resolve, promise } = createSuspender('loaded content')

    render(
      <SuspenseProgressBoundary fallback={<div>loading…</div>}>
        <Suspender />
      </SuspenseProgressBoundary>,
    )
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)

    await act(async () => {
      resolve()
      await promise
    })

    expect(screen.getByText('loaded content')).toBeInTheDocument()
    expect(screen.queryByText('loading…')).not.toBeInTheDocument()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)
  })

  it('renders the fallback node transparently, preserving its a11y semantics without an extra wrapper', () => {
    const { Suspender } = createSuspender('x')

    const { container } = render(
      <SuspenseProgressBoundary
        fallback={
          <div data-testid="sp-fallback" role="status" aria-busy="true">
            loading…
          </div>
        }
      >
        <Suspender />
      </SuspenseProgressBoundary>,
    )

    const fallback = screen.getByTestId('sp-fallback')
    expect(fallback).toHaveAttribute('role', 'status')
    expect(fallback).toHaveAttribute('aria-busy', 'true')
    // The bridge wraps the fallback in a fragment, so the caller's element
    // stays a direct child of the container — no intermediate <div> that
    // could break the skeleton's layout or duplicate the busy role.
    expect(fallback.parentElement).toBe(container)
  })

  it('releases global progress when the boundary unmounts mid-suspension', () => {
    const { Suspender } = createSuspender('never resolves in this test')

    const { unmount } = render(
      <SuspenseProgressBoundary fallback={<div>loading…</div>}>
        <Suspender />
      </SuspenseProgressBoundary>,
    )
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)

    unmount()

    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)
    expect(__getGlobalProgressStateForTests().trickling).toBe(false)
  })
})
