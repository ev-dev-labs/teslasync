import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetDocumentCancellationForTests, assertDocumentActive } from '../documentCancellation'
import { documentLifecycleDriver } from '../../test/documentLifecycle'

afterEach(() => {
  __resetDocumentCancellationForTests()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('document-owned late request starts', () => {
  it.each(['beforeunload', 'pagehide'])('rejects reads after %s and resumes on pageshow', (event) => {
    const lifecycle = documentLifecycleDriver()
    expect(() => assertDocumentActive()).not.toThrow()
    lifecycle(event as 'beforeunload' | 'pagehide')
    expect(() => assertDocumentActive()).toThrow(expect.objectContaining({ name: 'AbortError' }))
    lifecycle('pageshow')
    expect(() => assertDocumentActive()).not.toThrow()
  })

  it('does not stop active reads for synthetic telemetry-flush lifecycle events', () => {
    const lifecycle = documentLifecycleDriver()
    assertDocumentActive()
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
    window.dispatchEvent(new Event('beforeunload'))
    expect(() => assertDocumentActive()).not.toThrow()
    lifecycle('pagehide')
    window.dispatchEvent(new Event('pageshow'))
    expect(() => assertDocumentActive()).toThrow(expect.objectContaining({ name: 'AbortError' }))
    lifecycle('pageshow')
    expect(() => assertDocumentActive()).not.toThrow()
  })

  it('does not register another lifecycle for each request', () => {
    const add = vi.spyOn(window, 'addEventListener')
    for (let request = 0; request < 10; request++) assertDocumentActive()
    for (const event of ['beforeunload', 'pagehide', 'pageshow']) {
      expect(add.mock.calls.filter(([name]) => name === event)).toHaveLength(1)
    }
  })

  it('resumes after later dirty-form handlers prevent navigation, but stops again on actual pagehide', async () => {
    vi.useFakeTimers()
    const lifecycle = documentLifecycleDriver()
    assertDocumentActive()
    const prevent = (event: Event) => event.preventDefault()
    window.addEventListener('beforeunload', prevent)
    try {
      lifecycle('beforeunload')
      expect(() => assertDocumentActive()).toThrow(expect.objectContaining({ name: 'AbortError' }))
      await vi.runAllTimersAsync()
      expect(() => assertDocumentActive()).not.toThrow()
      lifecycle('pagehide')
      expect(() => assertDocumentActive()).toThrow(expect.objectContaining({ name: 'AbortError' }))
    } finally {
      window.removeEventListener('beforeunload', prevent)
    }
  })

  it('releases lifecycle listeners and the pending navigation decision timer on disposal', () => {
    vi.useFakeTimers()
    const lifecycle = documentLifecycleDriver()
    const remove = vi.spyOn(window, 'removeEventListener')
    assertDocumentActive()
    lifecycle('beforeunload')
    expect(vi.getTimerCount()).toBe(1)
    __resetDocumentCancellationForTests()
    expect(vi.getTimerCount()).toBe(0)
    for (const event of ['beforeunload', 'pagehide', 'pageshow']) {
      expect(remove).toHaveBeenCalledWith(event, expect.any(Function))
    }
  })

  it('is safe outside a browser document', () => {
    vi.stubGlobal('window', undefined)
    expect(() => assertDocumentActive()).not.toThrow()
  })
})
