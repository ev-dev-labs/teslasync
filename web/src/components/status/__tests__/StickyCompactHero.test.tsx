import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StickyCompactHero } from '../StickyCompactHero'
import type { HeroStatus } from '../StatusHero'

// StickyCompactHero is driven by an IntersectionObserver. The global
// test-setup polyfill auto-fires isIntersecting=true, which is not enough
// to exercise the scroll-past branches. Install a controllable stub that
// captures the callback + options so each test can drive intersection
// events deterministically (mirrors PageHeaderSticky.test.tsx).
type IOEntry = { isIntersecting: boolean; boundingClientRect: { top: number } }
type IOCallback = (entries: IOEntry[]) => void

let lastCb: IOCallback | null = null
let lastOptions: IntersectionObserverInit | undefined
const observe = vi.fn()
const disconnect = vi.fn()
const unobserve = vi.fn()

class MockIO {
  constructor(cb: IOCallback, options?: IntersectionObserverInit) {
    lastCb = cb
    lastOptions = options
  }
  observe = observe
  disconnect = disconnect
  unobserve = unobserve
  takeRecords = () => []
}

beforeEach(() => {
  observe.mockReset()
  disconnect.mockReset()
  unobserve.mockReset()
  lastCb = null
  lastOptions = undefined
  ;(globalThis as unknown as { IntersectionObserver: typeof MockIO }).IntersectionObserver = MockIO
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const HERO_ID = 'status-hero'

function setup(props: Partial<React.ComponentProps<typeof StickyCompactHero>> = {}) {
  // getElementById must resolve during the mount effect, so the target has
  // to exist in the DOM before render().
  const target = document.createElement('div')
  target.id = props.targetId ?? HERO_ID
  document.body.appendChild(target)
  return render(<StickyCompactHero targetId={HERO_ID} status="healthy" {...props} />)
}

/** Drive the observer as if the hero scrolled ABOVE the fold → bar appears. */
function scrollHeroPast() {
  act(() => {
    lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -120 } }])
  })
}

describe('StickyCompactHero', () => {
  it('observes the target but stays hidden before any intersection event', () => {
    setup()
    expect(observe).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('never creates an observer when the target element is absent', () => {
    render(<StickyCompactHero targetId="missing-hero" status="healthy" />)
    expect(observe).not.toHaveBeenCalled()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('reveals the compact bar once the hero scrolls above the viewport', () => {
    setup({ status: 'healthy' })
    scrollHeroPast()
    expect(screen.getByRole('region', { name: 'Status summary' })).toBeInTheDocument()
    expect(screen.getByText('All operational')).toBeInTheDocument()
  })

  it('stays hidden while the hero is still below the fold (long-page guard)', () => {
    // Regression: IntersectionObserver reports isIntersecting=false in BOTH
    // directions. A positive boundingClientRect.top means the hero has not
    // yet been scrolled to — the bar must NOT appear.
    setup()
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: 640 } }])
    })
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('hides again when the hero scrolls back into view', () => {
    setup()
    scrollHeroPast()
    expect(screen.getByRole('region')).toBeInTheDocument()
    act(() => {
      lastCb?.([{ isIntersecting: true, boundingClientRect: { top: 40 } }])
    })
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it.each([
    ['healthy', 'All operational'],
    ['degraded', 'Degraded'],
    ['unhealthy', 'Outage'],
    ['unknown', 'Status unknown'],
    ['maintenance', 'Maintenance'],
  ] as const)('shows the "%s" short headline', (status, headline) => {
    setup({ status })
    scrollHeroPast()
    expect(screen.getByText(headline)).toBeInTheDocument()
  })

  it('falls back to the neutral "unknown" treatment for an unmapped status', () => {
    // Defensive path: a value outside the HeroStatus union must not crash the
    // icon render — it should degrade to the "Status unknown" headline.
    setup({ status: 'bogus' as HeroStatus })
    scrollHeroPast()
    expect(screen.getByText('Status unknown')).toBeInTheDocument()
  })

  it('renders the last-checked label when provided', () => {
    setup({ lastCheckedLabel: '12s ago' })
    scrollHeroPast()
    expect(screen.getByText(/12s ago/)).toBeInTheDocument()
  })

  it('omits the last-checked label when not provided', () => {
    setup()
    scrollHeroPast()
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
  })

  it('scrolls the #main-content container to the top when present', () => {
    const main = document.createElement('main')
    main.id = 'main-content'
    const mainScrollTo = vi.fn()
    main.scrollTo = mainScrollTo as unknown as typeof main.scrollTo
    document.body.appendChild(main)
    const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    setup()
    scrollHeroPast()
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to top of page' }))

    expect(mainScrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(windowScrollTo).not.toHaveBeenCalled()
  })

  it('falls back to window.scrollTo when #main-content is absent', () => {
    const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    setup()
    scrollHeroPast()
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to top of page' }))

    expect(windowScrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('does not render a refresh button without an onRefresh handler', () => {
    setup()
    scrollHeroPast()
    expect(screen.queryByRole('button', { name: 'Refresh status' })).not.toBeInTheDocument()
  })

  it('fires onRefresh when the refresh button is clicked', () => {
    const onRefresh = vi.fn()
    setup({ onRefresh })
    scrollHeroPast()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('disables the refresh button and does not fire while refreshing', () => {
    const onRefresh = vi.fn()
    setup({ onRefresh, refreshing: true })
    scrollHeroPast()
    const button = screen.getByRole('button', { name: 'Refresh status' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('applies topOffset to the sticky offset and the observer rootMargin', () => {
    setup({ topOffset: 64 })
    expect(lastOptions?.rootMargin).toBe('-64px 0px 0px 0px')
    scrollHeroPast()
    expect(screen.getByRole('region')).toHaveStyle({ top: '64px' })
  })

  it('disconnects the observer on unmount', () => {
    const { unmount } = setup()
    unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('marks decorative icons aria-hidden so the button name comes from its label', () => {
    setup({ status: 'degraded' })
    scrollHeroPast()
    const button = screen.getByRole('button', { name: 'Scroll to top of page' })
    const svgs = button.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThan(0)
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })
})
