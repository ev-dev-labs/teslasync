/**
 * Unit tests for the shared jsdom polyfills / mock factories exported from
 * `./setup`.
 *
 * Every export is exercised for behaviour and multiple facets — not a smoke
 * construct:
 *   - `MockIntersectionObserver` — synchronous intersecting callback, target
 *     bookkeeping, option → field derivation with defaults.
 *   - `MockResizeObserver`       — observe/unobserve/disconnect bookkeeping and
 *     the `trigger()` callback fan-out.
 *   - `MockEventSource`          — constructor state, message vs named-event
 *     routing, payload serialisation, listener removal, lifecycle handlers.
 *   - `installTestPolyfills`     — bare-target install, no-clobber default,
 *     `force` override, and full restore (both delete + restore-prior paths).
 *   - `patchMatchMedia`          — per-query match state, reactive `fire`,
 *     modern + legacy listener wiring, and descriptor restore.
 *
 * The polyfill installer is tested against a throwaway fake target rather than
 * the real `globalThis` so the assertions are deterministic regardless of the
 * globals the project-wide `test-setup.ts` already installed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MockIntersectionObserver,
  MockResizeObserver,
  MockEventSource,
  installTestPolyfills,
  patchMatchMedia,
} from './setup'

afterEach(() => {
  // Guard against a test that forgot to restore leaking the stub across files.
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('MockIntersectionObserver', () => {
  it('fires the callback once with a fully-intersecting entry on observe()', () => {
    const callback = vi.fn()
    const io = new MockIntersectionObserver(callback)
    const el = document.createElement('div')

    io.observe(el)

    expect(callback).toHaveBeenCalledTimes(1)
    const [entries, observer] = callback.mock.calls[0]
    expect(entries[0].isIntersecting).toBe(true)
    expect(entries[0].intersectionRatio).toBe(1)
    expect(entries[0].target).toBe(el)
    expect(observer).toBe(io)
    expect(io.observed.has(el)).toBe(true)
  })

  it('tracks, releases and clears observed targets; takeRecords is empty', () => {
    const io = new MockIntersectionObserver(vi.fn())
    const a = document.createElement('div')
    const b = document.createElement('span')

    io.observe(a)
    io.observe(b)
    expect(io.observed.size).toBe(2)

    io.unobserve(a)
    expect(io.observed.has(a)).toBe(false)
    expect(io.observed.has(b)).toBe(true)

    io.disconnect()
    expect(io.observed.size).toBe(0)
    expect(io.takeRecords()).toEqual([])
  })

  it('defaults root/rootMargin/thresholds when no init is supplied', () => {
    const io = new MockIntersectionObserver(vi.fn())
    expect(io.root).toBeNull()
    expect(io.rootMargin).toBe('0px')
    expect(io.thresholds).toEqual([0])
  })

  it('derives root/rootMargin/thresholds from the init object', () => {
    const root = document.createElement('main')
    const many = new MockIntersectionObserver(vi.fn(), {
      root,
      rootMargin: '10px',
      threshold: [0, 0.5, 1],
    })
    expect(many.root).toBe(root)
    expect(many.rootMargin).toBe('10px')
    expect(many.thresholds).toEqual([0, 0.5, 1])

    const single = new MockIntersectionObserver(vi.fn(), { threshold: 0.25 })
    expect(single.thresholds).toEqual([0.25])
  })
})

describe('MockResizeObserver', () => {
  it('tracks observed targets and clears them on disconnect', () => {
    const ro = new MockResizeObserver(vi.fn())
    const a = document.createElement('div')
    const b = document.createElement('div')

    ro.observe(a)
    ro.observe(b)
    expect(ro.observed.size).toBe(2)

    ro.unobserve(a)
    expect(ro.observed.has(a)).toBe(false)

    ro.disconnect()
    expect(ro.observed.size).toBe(0)
  })

  it('trigger() invokes the callback with the target and the observer', () => {
    const callback = vi.fn()
    const ro = new MockResizeObserver(callback)
    const el = document.createElement('div')

    ro.observe(el)
    ro.trigger(el)

    expect(callback).toHaveBeenCalledTimes(1)
    const [entries, observer] = callback.mock.calls[0]
    expect(entries[0].target).toBe(el)
    expect(observer).toBe(ro)
  })
})

describe('MockEventSource', () => {
  it('opens synchronously and reflects its constructor arguments', () => {
    const fromString = new MockEventSource('http://host/sse')
    expect(fromString.url).toBe('http://host/sse')
    expect(fromString.readyState).toBe(MockEventSource.OPEN)
    expect(fromString.withCredentials).toBe(false)

    expect(MockEventSource.CONNECTING).toBe(0)
    expect(MockEventSource.OPEN).toBe(1)
    expect(MockEventSource.CLOSED).toBe(2)

    const fromUrl = new MockEventSource(new URL('http://host/stream'), {
      withCredentials: true,
    })
    expect(fromUrl.url).toBe('http://host/stream')
    expect(fromUrl.withCredentials).toBe(true)
  })

  it('routes "message" to onmessage and named events to addEventListener subscribers', () => {
    const es = new MockEventSource('http://host/sse')
    const onmessage = vi.fn()
    const onSignal = vi.fn()
    es.onmessage = onmessage
    es.addEventListener('signal', onSignal)

    es.emit('message', { soc: 80 })
    expect(onmessage).toHaveBeenCalledTimes(1)
    // Non-string payloads are JSON-serialised to mirror the real wire format.
    expect(onmessage.mock.calls[0][0].data).toBe(JSON.stringify({ soc: 80 }))

    es.emit('signal', 'raw-string')
    expect(onSignal).toHaveBeenCalledTimes(1)
    expect(onSignal.mock.calls[0][0].data).toBe('raw-string')
    // A named event must NOT re-fire the onmessage handler.
    expect(onmessage).toHaveBeenCalledTimes(1)
  })

  it('stops delivering to a removed listener', () => {
    const es = new MockEventSource('http://host/sse')
    const listener = vi.fn()
    es.addEventListener('tick', listener)
    es.emit('tick', '1')
    es.removeEventListener('tick', listener)
    es.emit('tick', '2')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].data).toBe('1')
  })

  it('drives readyState + lifecycle handlers via emitOpen / emitError / close', () => {
    const es = new MockEventSource('http://host/sse')
    const onopen = vi.fn()
    const onerror = vi.fn()
    es.onopen = onopen
    es.onerror = onerror

    es.emitOpen()
    expect(onopen).toHaveBeenCalledTimes(1)
    expect(es.readyState).toBe(MockEventSource.OPEN)

    es.emitError()
    expect(onerror).toHaveBeenCalledTimes(1)
    expect(es.readyState).toBe(MockEventSource.CLOSED)

    es.emitOpen()
    es.close()
    expect(es.readyState).toBe(MockEventSource.CLOSED)
    expect(es.dispatchEvent(new Event('message'))).toBe(true)
  })
})

describe('installTestPolyfills', () => {
  it('installs all three polyfills onto a bare target and restore removes them', () => {
    const target: Record<string, unknown> = {}
    const restore = installTestPolyfills(target)

    expect(target.IntersectionObserver).toBe(MockIntersectionObserver)
    expect(target.ResizeObserver).toBe(MockResizeObserver)
    expect(target.EventSource).toBe(MockEventSource)

    restore()

    expect(target.IntersectionObserver).toBeUndefined()
    expect(target.ResizeObserver).toBeUndefined()
    expect(target.EventSource).toBeUndefined()
  })

  it('leaves an existing global untouched by default', () => {
    const sentinel = class ExistingRO {}
    const target: Record<string, unknown> = { ResizeObserver: sentinel }

    const restore = installTestPolyfills(target)
    // Not clobbered — the prior definition wins.
    expect(target.ResizeObserver).toBe(sentinel)
    // The absent ones are still filled in.
    expect(target.EventSource).toBe(MockEventSource)

    restore()
    expect(target.ResizeObserver).toBe(sentinel)
    expect(target.EventSource).toBeUndefined()
  })

  it('overrides an existing global with force:true and restores the prior value', () => {
    const sentinel = class ExistingRO {}
    const target: Record<string, unknown> = { ResizeObserver: sentinel }

    const restore = installTestPolyfills(target, { force: true })
    expect(target.ResizeObserver).toBe(MockResizeObserver)

    restore()
    // The prior value is put back, not deleted.
    expect(target.ResizeObserver).toBe(sentinel)
  })
})

describe('patchMatchMedia', () => {
  it('returns the match state per query and reacts to fire()', () => {
    const ctrl = patchMatchMedia((q) => q === '(max-width: 640px)')

    expect(window.matchMedia('(max-width: 640px)').matches).toBe(true)
    expect(window.matchMedia('(min-width: 1024px)').matches).toBe(false)

    const mql = window.matchMedia('(pointer: coarse)')
    const onChange = vi.fn()
    mql.addEventListener('change', onChange)

    ctrl.fire('(pointer: coarse)', true)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].matches).toBe(true)
    expect(onChange.mock.calls[0][0].media).toBe('(pointer: coarse)')

    // A query with no registered listeners is a safe no-op.
    expect(() => ctrl.fire('(orientation: portrait)', true)).not.toThrow()

    ctrl.restore()
  })

  it('honours listener removal, legacy addListener, and restores the prior matchMedia', () => {
    const sentinel = vi.fn()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: sentinel,
    })

    const ctrl = patchMatchMedia(() => false)
    expect(window.matchMedia).not.toBe(sentinel)

    // Modern API: a removed listener no longer receives change events.
    const removed = window.matchMedia('(a)')
    const removedListener = vi.fn()
    removed.addEventListener('change', removedListener)
    removed.removeEventListener('change', removedListener)
    ctrl.fire('(a)', true)
    expect(removedListener).not.toHaveBeenCalled()

    // Legacy Safari API: addListener is still wired to fire().
    const legacy = window.matchMedia('(b)')
    const legacyListener = vi.fn()
    legacy.addListener(legacyListener)
    ctrl.fire('(b)', true)
    expect(legacyListener).toHaveBeenCalledTimes(1)

    ctrl.restore()
    expect(window.matchMedia).toBe(sentinel)
  })
})
