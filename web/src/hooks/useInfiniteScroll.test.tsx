import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import { useInfiniteScroll } from './useInfiniteScroll'

// A fully controllable IntersectionObserver test double. The global polyfill
// in test-setup.ts fires `isIntersecting: true` immediately on observe(),
// which is useless for asserting the hasMore / not-intersecting / empty-batch
// branches — so each test installs this stub via vi.stubGlobal and drives the
// callback by hand.
type Emit = Array<Partial<IntersectionObserverEntry>>

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
  observed: Element[] = []
  disconnectCount = 0

  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = cb
    this.options = options
    FakeIntersectionObserver.instances.push(this)
  }

  observe(el: Element) {
    this.observed.push(el)
  }
  unobserve() {}
  disconnect() {
    this.disconnectCount += 1
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  emit(entries: Emit) {
    this.callback(
      entries as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    )
  }
}

function Harness({ onLoadMore, hasMore }: { onLoadMore: () => void; hasMore: boolean }) {
  const ref = useInfiniteScroll(onLoadMore, hasMore)
  return <div data-testid="sentinel" ref={ref} />
}

function latest(): FakeIntersectionObserver {
  const list = FakeIntersectionObserver.instances
  return list[list.length - 1]
}

beforeEach(() => {
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useInfiniteScroll', () => {
  it('observes the sentinel with a 0.1 threshold once mounted', () => {
    const onLoadMore = vi.fn()
    const { getByTestId } = render(<Harness onLoadMore={onLoadMore} hasMore />)

    expect(FakeIntersectionObserver.instances).toHaveLength(1)
    const io = latest()
    expect(io.observed).toContain(getByTestId('sentinel'))
    expect(io.options?.threshold).toBe(0.1)
    // No intersection reported yet, so nothing should have loaded.
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('calls onLoadMore when the sentinel intersects and hasMore is true', () => {
    const onLoadMore = vi.fn()
    render(<Harness onLoadMore={onLoadMore} hasMore />)

    latest().emit([{ isIntersecting: true }])
    expect(onLoadMore).toHaveBeenCalledTimes(1)

    // Fires again on a subsequent intersection — no freeze-once semantics.
    latest().emit([{ isIntersecting: true }])
    expect(onLoadMore).toHaveBeenCalledTimes(2)
  })

  it('does not call onLoadMore while hasMore is false', () => {
    const onLoadMore = vi.fn()
    render(<Harness onLoadMore={onLoadMore} hasMore={false} />)

    latest().emit([{ isIntersecting: true }])
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('does not call onLoadMore when the sentinel is not intersecting', () => {
    const onLoadMore = vi.fn()
    render(<Harness onLoadMore={onLoadMore} hasMore />)

    latest().emit([{ isIntersecting: false }])
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('tolerates an observer callback with no entries (empty batch)', () => {
    const onLoadMore = vi.fn()
    render(<Harness onLoadMore={onLoadMore} hasMore />)

    // Regression guard: entries[0] is undefined here — the hook must not throw
    // (the pre-hardening `entries[0].isIntersecting` crashed on this input).
    expect(() => latest().emit([])).not.toThrow()
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('disconnects the observer on unmount', () => {
    const onLoadMore = vi.fn()
    const { unmount } = render(<Harness onLoadMore={onLoadMore} hasMore />)
    const io = latest()

    unmount()
    expect(io.disconnectCount).toBe(1)
  })

  it('recreates the observer and honours the latest hasMore when props change', () => {
    const onLoadMore = vi.fn()
    const { rerender } = render(<Harness onLoadMore={onLoadMore} hasMore />)
    const first = latest()

    // Flip hasMore off: the stale observer is torn down, a fresh one is wired.
    rerender(<Harness onLoadMore={onLoadMore} hasMore={false} />)
    expect(first.disconnectCount).toBe(1)
    expect(FakeIntersectionObserver.instances).toHaveLength(2)

    // The new observer closes over hasMore=false, so intersecting is a no-op.
    latest().emit([{ isIntersecting: true }])
    expect(onLoadMore).not.toHaveBeenCalled()

    // Flip it back on and the newest observer resumes loading.
    rerender(<Harness onLoadMore={onLoadMore} hasMore />)
    latest().emit([{ isIntersecting: true }])
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('returns a stable ref object across re-renders', () => {
    const { result, rerender } = renderHook(
      ({ more }: { more: boolean }) => useInfiniteScroll(() => {}, more),
      { initialProps: { more: true } },
    )
    const firstRef = result.current
    rerender({ more: false })

    expect(result.current).toBe(firstRef)
    expect(result.current.current).toBeNull()
  })

  it('is a no-op (no crash, no observer) when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const onLoadMore = vi.fn()

    expect(() => render(<Harness onLoadMore={onLoadMore} hasMore />)).not.toThrow()
    expect(FakeIntersectionObserver.instances).toHaveLength(0)
    expect(onLoadMore).not.toHaveBeenCalled()
  })
})
