/**
 * StickyChipBar — behaviour + hardening coverage.
 *
 * StickyChipBar is the scroll-spy "jump to section" nav. Every facet is exercised:
 *   - chip rendering (one accessible <button> per chip, in order)
 *   - the default-active chip + single-active invariant
 *   - the two scroll paths in handleClick (the #main-content scroll container
 *     vs. the window fallback) with the exact target-offset math
 *   - the missing-anchor no-op branch (`if (!el) return`)
 *   - the empty-chips guard (no buttons, no observer) and the undefined-chips
 *     hardening guard (no crash)
 *   - the IntersectionObserver logic: topmost-visible-section wins the reduce,
 *     non-intersecting entries are filtered out, the last active chip is kept
 *     when nothing intersects, observers are cleaned up on unmount, and the
 *     subscription is rebuilt when the chips prop changes
 *   - the a11y surface: nav landmark label, aria-current, focusable buttons
 *
 * The global test-setup (src/test-setup.ts) installs an auto-firing
 * IntersectionObserver stub whose entries lack `target` / `boundingClientRect`.
 * This file replaces it with a controllable stub so the real observer callback
 * can be driven with production-shaped entries.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StickyChipBar, type ChipItem } from '../StickyChipBar'

// ── Controllable IntersectionObserver ────────────────────────────────────────
interface FakeEntry {
  target: Element
  isIntersecting: boolean
  boundingClientRect: { top: number }
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  readonly observed = new Set<Element>()
  disconnected = false
  options?: IntersectionObserverInit
  private cb: IntersectionObserverCallback

  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.cb = cb
    this.options = options
    MockIntersectionObserver.instances.push(this)
  }

  observe(el: Element) {
    this.observed.add(el)
  }
  unobserve(el: Element) {
    this.observed.delete(el)
  }
  disconnect() {
    this.disconnected = true
    this.observed.clear()
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  /** Drive the scroll-spy with production-shaped entries. */
  emit(entries: FakeEntry[]) {
    act(() => {
      this.cb(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
    })
  }

  static latest(): MockIntersectionObserver {
    return MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1]!
  }
}

const CHIPS: ChipItem[] = [
  { id: 'health', label: 'Health' },
  { id: 'action-items', label: 'Action items' },
  { id: 'resources', label: 'Resources' },
]

function mountAnchors(ids: string[]) {
  for (const id of ids) {
    const el = document.createElement('section')
    el.id = id
    document.body.appendChild(el)
  }
}

const rectTop = (top: number) => ({ top } as unknown as DOMRect)

function chipButton(name: string) {
  return screen.getByRole('button', { name })
}

function activeChips() {
  return screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'true')
}

beforeEach(() => {
  MockIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('StickyChipBar', () => {
  it('renders one accessible button per chip, in order', () => {
    render(<StickyChipBar chips={CHIPS} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons.map((b) => b.textContent)).toEqual(['Health', 'Action items', 'Resources'])
  })

  it('labels the nav landmark for screen readers', () => {
    render(<StickyChipBar chips={CHIPS} />)
    expect(screen.getByRole('navigation', { name: 'Jump to section' })).toBeInTheDocument()
  })

  it('marks the first chip active by default and keeps exactly one active', () => {
    render(<StickyChipBar chips={CHIPS} />)
    expect(chipButton('Health')).toHaveAttribute('aria-current', 'true')
    expect(chipButton('Action items')).not.toHaveAttribute('aria-current')
    expect(activeChips()).toHaveLength(1)
  })

  it('applies the sticky topOffset and forwards className to the nav', () => {
    render(<StickyChipBar chips={CHIPS} topOffset={12} className="my-custom-bar" />)
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveStyle({ top: '12px' })
    expect(nav).toHaveClass('my-custom-bar')
  })

  it('renders no buttons and creates no observer when chips is empty', () => {
    render(<StickyChipBar chips={[]} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // The nav shell always renders — it never collapses to a blank fragment.
    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(MockIntersectionObserver.instances).toHaveLength(0)
  })

  it('guards against an undefined chips prop without crashing', () => {
    // Defends the runtime contract for untyped JS callers: the `chips = []`
    // default keeps .length / .map / [0] safe instead of throwing.
    expect(() => render(<StickyChipBar chips={undefined as unknown as ChipItem[]} />)).not.toThrow()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('scrolls the #main-content container and activates the chip on click', () => {
    mountAnchors(['health', 'action-items', 'resources'])
    const main = document.createElement('main')
    main.id = 'main-content'
    document.body.appendChild(main)
    main.getBoundingClientRect = () => rectTop(100)
    Object.defineProperty(main, 'scrollTop', { value: 50, configurable: true, writable: true })
    const scrollTo = vi.fn()
    main.scrollTo = scrollTo as unknown as typeof main.scrollTo

    const resourcesEl = document.getElementById('resources')!
    resourcesEl.getBoundingClientRect = () => rectTop(600)

    render(<StickyChipBar chips={CHIPS} />)
    fireEvent.click(chipButton('Resources'))

    // target = scrollTop(50) + (elTop(600) - containerTop(100)) - offset(0) - navH(0) - 12
    expect(scrollTo).toHaveBeenCalledWith({ top: 538, behavior: 'smooth' })
    expect(chipButton('Resources')).toHaveAttribute('aria-current', 'true')
    expect(chipButton('Health')).not.toHaveAttribute('aria-current')
  })

  it('falls back to window scroll when #main-content is absent', () => {
    mountAnchors(['health', 'action-items', 'resources'])
    const el = document.getElementById('action-items')!
    el.getBoundingClientRect = () => rectTop(420)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    render(<StickyChipBar chips={CHIPS} topOffset={8} />)
    fireEvent.click(chipButton('Action items'))

    // y = elTop(420) + scrollY(0) - offset(8) - navH(0) - 12 = 400
    expect(scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'smooth' })
    expect(chipButton('Action items')).toHaveAttribute('aria-current', 'true')
  })

  it('does nothing when the target anchor is missing from the DOM', () => {
    // No anchors mounted → getElementById returns null → early return.
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(<StickyChipBar chips={CHIPS} />)
    fireEvent.click(chipButton('Resources'))

    expect(scrollTo).not.toHaveBeenCalled()
    // Active state is untouched — the default first chip stays current.
    expect(chipButton('Health')).toHaveAttribute('aria-current', 'true')
    expect(chipButton('Resources')).not.toHaveAttribute('aria-current')
  })

  it('activates the topmost intersecting section and ignores non-intersecting ones', () => {
    mountAnchors(['health', 'action-items', 'resources'])
    render(<StickyChipBar chips={CHIPS} />)
    const io = MockIntersectionObserver.latest()

    io.emit([
      { target: document.getElementById('health')!, isIntersecting: true, boundingClientRect: { top: 200 } },
      { target: document.getElementById('action-items')!, isIntersecting: true, boundingClientRect: { top: 40 } },
      { target: document.getElementById('resources')!, isIntersecting: false, boundingClientRect: { top: 900 } },
    ])

    // Among intersecting entries, action-items has the smallest top → it wins.
    expect(chipButton('Action items')).toHaveAttribute('aria-current', 'true')
    expect(chipButton('Health')).not.toHaveAttribute('aria-current')
    expect(activeChips()).toHaveLength(1)
  })

  it('keeps the last active chip when nothing is intersecting', () => {
    mountAnchors(['health', 'action-items', 'resources'])
    render(<StickyChipBar chips={CHIPS} />)
    const io = MockIntersectionObserver.latest()

    io.emit([
      { target: document.getElementById('resources')!, isIntersecting: true, boundingClientRect: { top: 10 } },
    ])
    expect(chipButton('Resources')).toHaveAttribute('aria-current', 'true')

    // Everything scrolls out of the active band → no visible entries → hold.
    io.emit([
      { target: document.getElementById('resources')!, isIntersecting: false, boundingClientRect: { top: -50 } },
    ])
    expect(chipButton('Resources')).toHaveAttribute('aria-current', 'true')
  })

  it('observes every anchor that exists and disconnects on unmount', () => {
    mountAnchors(['health', 'resources']) // action-items intentionally absent
    const { unmount } = render(<StickyChipBar chips={CHIPS} />)
    const io = MockIntersectionObserver.latest()

    expect(io.observed.size).toBe(2)
    expect(io.disconnected).toBe(false)

    unmount()
    expect(io.disconnected).toBe(true)
  })

  it('rebuilds the observer subscription when the chips prop changes', () => {
    const { rerender } = render(<StickyChipBar chips={CHIPS} />)
    const first = MockIntersectionObserver.latest()
    expect(first.disconnected).toBe(false)

    rerender(<StickyChipBar chips={[{ id: 'x', label: 'X' }]} />)

    // The old observer is torn down and a fresh one is created for the new set.
    expect(first.disconnected).toBe(true)
    expect(MockIntersectionObserver.instances.length).toBeGreaterThan(1)
  })

  it('exposes chips as keyboard-focusable native buttons', () => {
    render(<StickyChipBar chips={CHIPS} />)
    const btn = chipButton('Resources')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn).toHaveAttribute('type', 'button')

    btn.focus()
    expect(btn).toHaveFocus()
  })
})
