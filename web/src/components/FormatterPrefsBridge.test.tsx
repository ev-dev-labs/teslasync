import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { FormatterPrefsBridge } from './FormatterPrefsBridge'
import { TOPICS } from '@/lib/broadcastTopics'
import {
  getGlobalLocale,
  getGlobalPrecision,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat'

/**
 * `<FormatterPrefsBridge />` is a side-effect-only mount (renders `null`).
 * Its contract:
 *   1. Applies the resolved `['settings']` query's locale + decimal
 *      precision to the module-level `numberFormat` globals — and keeps
 *      them in sync regardless of which page is mounted (it is the anchor
 *      subscriber for the settings query at the app root).
 *   2. Subscribes to the broadcast bus and refetches settings on a
 *      `settings.changed` topic (ignoring every other topic).
 *
 * These tests drive the query through the mocked `request` client and
 * simulate peer-tab broadcasts via a `StorageEvent` (the fallback bus
 * transport that `subscribe()` also listens to), so nothing hits the
 * network.
 */

// Mutable fixtures the mocked client returns. Both are referenced ONLY
// inside the async factory closure (never synchronously during hoisting),
// so vi.mock's top-of-file hoisting is safe. `marker` lets a test force
// React Query to hand back a fresh object while keeping locale/precision
// unchanged.
let nextSettings: { locale?: string; decimal_precision?: number; marker?: number } = {
  locale: 'en-US',
  decimal_precision: 2,
}
let shouldReject = false

vi.mock('@/api/client', () => ({
  request: vi.fn(async () => {
    if (shouldReject) throw new Error('settings fetch failed')
    return nextSettings
  }),
}))

function makeWrapper(): {
  Wrapper: (p: { children: ReactNode }) => JSX.Element
  qc: QueryClient
} {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { Wrapper, qc }
}

// Emulate a peer tab publishing `type` on the bus. `subscribe()` filters
// same-tab envelopes, so we forge a foreign `_from` and deliver it through
// the storage-event fallback transport (key prefix `__teslasync_bus_`).
function emitPeerTopic(type: string): void {
  const env = { _from: 'peer-tab', _ts: Date.now(), msg: { type } }
  const key = `__teslasync_bus_${Date.now()}_${Math.random().toString(36).slice(2)}`
  window.dispatchEvent(
    new StorageEvent('storage', { key, newValue: JSON.stringify(env) }),
  )
}

beforeEach(() => {
  // Reset the module-level globals to a sentinel that never matches a
  // real payload, so "did the bridge apply?" is unambiguous.
  setGlobalLocale('xx-XX')
  setGlobalPrecision(0)
  nextSettings = { locale: 'en-US', decimal_precision: 2 }
  shouldReject = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('FormatterPrefsBridge — render contract', () => {
  it('renders nothing (side-effect-only mount)', () => {
    const { Wrapper } = makeWrapper()
    const { container } = render(<FormatterPrefsBridge />, { wrapper: Wrapper })
    expect(container.innerHTML).toBe('')
    expect(container.childElementCount).toBe(0)
  })
})

describe('FormatterPrefsBridge — applying globals from settings', () => {
  it('applies locale and decimal precision from the resolved settings on mount', async () => {
    nextSettings = { locale: 'de-DE', decimal_precision: 3 }
    const { Wrapper } = makeWrapper()
    render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('de-DE')
      expect(getGlobalPrecision()).toBe(3)
    })
  })

  it('resolves an empty-string locale to en-US instead of crashing Intl', async () => {
    nextSettings = { locale: '', decimal_precision: 4 }
    const { Wrapper } = makeWrapper()
    render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('en-US')
      expect(getGlobalPrecision()).toBe(4)
    })
  })

  it('falls back to en-US locale and precision 2 when both fields are absent', async () => {
    nextSettings = {}
    const { Wrapper } = makeWrapper()
    render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('en-US')
      expect(getGlobalPrecision()).toBe(2)
    })
  })

  it('applies decimal_precision of 0 (does not coerce the falsy 0 to the default)', async () => {
    nextSettings = { locale: 'en-GB', decimal_precision: 0 }
    const { Wrapper } = makeWrapper()
    render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('en-GB')
      expect(getGlobalPrecision()).toBe(0)
    })
  })

  it('leaves globals untouched and renders null when the settings fetch fails', async () => {
    shouldReject = true
    const { Wrapper } = makeWrapper()
    const { container } = render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    // Give the (rejected, non-retrying) query a few ticks to settle.
    await new Promise((r) => setTimeout(r, 40))

    expect(getGlobalLocale()).toBe('xx-XX')
    expect(getGlobalPrecision()).toBe(0)
    expect(container.innerHTML).toBe('')
  })
})

describe('FormatterPrefsBridge — staying in sync', () => {
  it('re-applies globals when settings change and the query is invalidated', async () => {
    nextSettings = { locale: 'en-US', decimal_precision: 2 }
    const { Wrapper, qc } = makeWrapper()
    render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    await waitFor(() => expect(getGlobalLocale()).toBe('en-US'))

    nextSettings = { locale: 'fr-FR', decimal_precision: 4 }
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] })
    })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('fr-FR')
      expect(getGlobalPrecision()).toBe(4)
    })
  })

  it('re-asserts globals after external drift even when the settings values are unchanged', async () => {
    // Regression guard: the bridge is the source-of-truth anchor. If a
    // global it did NOT write drifts (e.g. a page's own useSettings
    // applied a transient value), the next settings resolution must
    // correct it — even though the settings-derived locale/precision are
    // identical to what the bridge last saw.
    nextSettings = { locale: 'en-US', decimal_precision: 2 }
    const { Wrapper, qc } = makeWrapper()
    render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('en-US')
      expect(getGlobalPrecision()).toBe(2)
    })

    act(() => {
      setGlobalLocale('de-DE')
      setGlobalPrecision(9)
    })

    // Same locale/precision, but a fresh object (marker changed) so React
    // Query hands the effect a new `settings` reference and it re-runs.
    nextSettings = { locale: 'en-US', decimal_precision: 2, marker: Date.now() }
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] })
    })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('en-US')
      expect(getGlobalPrecision()).toBe(2)
    })
  })
})

describe('FormatterPrefsBridge — broadcast subscription', () => {
  it('refetches settings and updates globals on a peer settings.changed broadcast', async () => {
    nextSettings = { locale: 'en-US', decimal_precision: 2 }
    const { Wrapper } = makeWrapper()
    render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    await waitFor(() => expect(getGlobalLocale()).toBe('en-US'))

    nextSettings = { locale: 'ja-JP', decimal_precision: 1 }
    act(() => emitPeerTopic(TOPICS.SETTINGS_CHANGED))

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('ja-JP')
      expect(getGlobalPrecision()).toBe(1)
    })
  })

  it('invalidates the settings query when a settings.changed broadcast arrives', async () => {
    const { Wrapper, qc } = makeWrapper()
    render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    await waitFor(() => expect(getGlobalLocale()).toBe('en-US'))

    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    act(() => emitPeerTopic(TOPICS.SETTINGS_CHANGED))

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['settings'] })
    })
  })

  it('ignores broadcast topics other than settings.changed', async () => {
    const { Wrapper, qc } = makeWrapper()
    render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    await waitFor(() => expect(getGlobalLocale()).toBe('en-US'))

    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    act(() => emitPeerTopic(TOPICS.THEME_CHANGED))
    await new Promise((r) => setTimeout(r, 30))

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('unsubscribes from the broadcast bus on unmount', async () => {
    const { Wrapper, qc } = makeWrapper()
    const { unmount } = render(<FormatterPrefsBridge />, { wrapper: Wrapper })

    await waitFor(() => expect(getGlobalLocale()).toBe('en-US'))

    unmount()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    act(() => emitPeerTopic(TOPICS.SETTINGS_CHANGED))
    await new Promise((r) => setTimeout(r, 30))

    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})
