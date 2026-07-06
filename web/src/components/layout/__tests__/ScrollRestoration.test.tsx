/**
 * ScrollRestoration behaviour tests.
 *
 * ScrollRestoration renders nothing — all of its behaviour is side effects on
 * the `<main id="main-content">` scroll container (or `window` when that is
 * absent) plus `sessionStorage`. These tests drive it through a real
 * `<MemoryRouter>` so `useNavigationType()` reports genuine POP / PUSH /
 * REPLACE values, and use a deterministic requestAnimationFrame stub so the
 * rAF-throttled save can be flushed (or asserted as scheduled/cancelled) on
 * demand.
 *
 * Coverage:
 *   - renders null (no DOM contribution)
 *   - initial POP with no saved entry scrolls the container to the top
 *   - continuous scroll saving is rAF-throttled and keyed by path+search
 *   - POP restores the saved scrollTop; PUSH / REPLACE reset to the top
 *   - the outgoing position is flushed on navigation and NOT clobbered to 0
 *     (the core regression this component's rewrite fixed)
 *   - a pending scroll-save is cancelled on navigation so it cannot clobber
 *   - a corrupt (non-numeric) saved value falls back to the top
 *   - falls back to window scrolling when #main-content is missing
 *   - sessionStorage read/write failures are swallowed, never fatal
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'

import { ScrollRestoration } from '../ScrollRestoration'

const STORAGE_PREFIX = 'teslasync.scroll:'
const keyOf = (path: string) => STORAGE_PREFIX + path

// ── Deterministic requestAnimationFrame ───────────────────────────────
// jsdom's real rAF is timer-backed and non-deterministic. Capture callbacks
// in a map keyed by id so tests can flush them, assert scheduling, and verify
// cancellation (cancelAnimationFrame deletes from the map).
let rafCallbacks: Map<number, FrameRequestCallback>
let rafSeq: number

function flushRaf(): void {
  const pending = [...rafCallbacks.values()]
  rafCallbacks.clear()
  act(() => {
    for (const cb of pending) cb(0)
  })
}

beforeEach(() => {
  rafCallbacks = new Map()
  rafSeq = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    const id = ++rafSeq
    rafCallbacks.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    rafCallbacks.delete(id)
  })
  window.sessionStorage.clear()

  // Fresh scroll container for each test.
  const main = document.createElement('main')
  main.id = 'main-content'
  document.body.appendChild(main)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

// ── Harness ────────────────────────────────────────────────────────────

function getMain(): HTMLElement {
  const el = document.getElementById('main-content')
  if (!el) throw new Error('test harness: #main-content missing')
  return el
}

// Navigation triggers so tests can drive PUSH / POP / REPLACE deterministically.
function Nav() {
  const navigate = useNavigate()
  return (
    <div>
      <button type="button" onClick={() => navigate('/b')}>
        go-b
      </button>
      <button type="button" onClick={() => navigate('/a')}>
        go-a
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
      <button type="button" onClick={() => navigate('/r', { replace: true })}>
        replace
      </button>
    </div>
  )
}

function renderApp(initial = '/a') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <ScrollRestoration />
      <Nav />
    </MemoryRouter>,
  )
}

function click(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

function scrollMainTo(px: number): void {
  const main = getMain()
  main.scrollTop = px
  fireEvent.scroll(main)
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('ScrollRestoration', () => {
  it('renders nothing (contributes no DOM)', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/a']}>
        <ScrollRestoration />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('on initial POP with no saved entry, scrolls the container to the top', () => {
    // Pretend the browser left the container mid-page before mount.
    getMain().scrollTop = 999
    renderApp('/a')
    expect(getMain().scrollTop).toBe(0)
  })

  it('saves scrollTop under the path key while scrolling, throttled to one rAF', () => {
    renderApp('/a')

    scrollMainTo(420)
    expect(rafCallbacks.size).toBe(1)

    // A second scroll while a save is still pending must NOT schedule another.
    getMain().scrollTop = 500
    fireEvent.scroll(getMain())
    expect(rafCallbacks.size).toBe(1)

    flushRaf()
    expect(window.sessionStorage.getItem(keyOf('/a'))).toBe('500')
    // The throttle latch is released after the frame fires.
    expect(rafCallbacks.size).toBe(0)
  })

  it('restores the saved scrollTop on POP (back/forward)', () => {
    renderApp('/a')
    scrollMainTo(300)
    flushRaf()
    expect(window.sessionStorage.getItem(keyOf('/a'))).toBe('300')

    click('go-b') // PUSH → resets to top
    expect(getMain().scrollTop).toBe(0)

    click('back') // POP back to /a → restore 300
    expect(getMain().scrollTop).toBe(300)
  })

  it('resets to the top on PUSH even when a saved entry exists for the target', () => {
    renderApp('/a')
    scrollMainTo(300)
    flushRaf()
    expect(window.sessionStorage.getItem(keyOf('/a'))).toBe('300')

    click('go-b') // PUSH /b
    click('go-a') // PUSH /a again — a fresh navigation, not a POP
    expect(getMain().scrollTop).toBe(0)
  })

  it('resets to the top on REPLACE navigation', () => {
    renderApp('/a')
    getMain().scrollTop = 250
    click('replace') // navigate('/r', { replace: true }) → REPLACE
    expect(getMain().scrollTop).toBe(0)
  })

  it('flushes the outgoing position on navigation and does NOT clobber it to 0', () => {
    // Regression: the old passive-cleanup flush ran after the layout-effect
    // reset the scroll, persisting 0 for the route the user just left.
    renderApp('/a')
    scrollMainTo(600)
    flushRaf()
    expect(window.sessionStorage.getItem(keyOf('/a'))).toBe('600')

    click('go-b') // PUSH /b resets the container to 0
    // The saved position for /a must survive.
    expect(window.sessionStorage.getItem(keyOf('/a'))).toBe('600')

    click('back') // POP back to /a
    expect(getMain().scrollTop).toBe(600)
  })

  it('cancels a pending scroll-save on navigation so it cannot clobber the store', () => {
    renderApp('/a')
    scrollMainTo(600) // schedules a save, left un-flushed → pending
    expect(rafCallbacks.size).toBe(1)

    click('go-b') // navigation must cancel the pending save and flush 600 first
    expect(rafCallbacks.size).toBe(0)

    flushRaf() // no-op: the callback was cancelled, not run
    expect(window.sessionStorage.getItem(keyOf('/a'))).toBe('600')
  })

  it('falls back to the top on POP when the saved value is corrupt', () => {
    window.sessionStorage.setItem(keyOf('/a'), 'not-a-number')
    getMain().scrollTop = 123
    renderApp('/a') // POP → readSaved parses NaN → treated as absent → top
    expect(getMain().scrollTop).toBe(0)
  })

  it('falls back to window scrolling when #main-content is absent', () => {
    getMain().remove()
    const scrollToSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)

    renderApp('/x') // POP, no saved entry, no container → window.scrollTo(top:0)
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })

    // And the scroll-save path reads window.scrollY when there is no container.
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 275 })
    fireEvent.scroll(window)
    flushRaf()
    expect(window.sessionStorage.getItem(keyOf('/x'))).toBe('275')

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  it('swallows sessionStorage read and write failures without throwing', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('sessionStorage blocked')
      })
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('sessionStorage blocked')
      })

    getMain().scrollTop = 88
    // readSaved throws internally → caught → treated as no entry → top.
    expect(() => renderApp('/a')).not.toThrow()
    expect(getMain().scrollTop).toBe(0)

    // writeSaved throws internally → caught.
    scrollMainTo(120)
    expect(() => flushRaf()).not.toThrow()

    getItem.mockRestore()
    setItem.mockRestore()
  })
})
