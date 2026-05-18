import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// test-setup.ts installs a global vi.mock for '@/hooks/useSettings'
// that returns static defaults so most rendering tests don't need a
// QueryClientProvider. This file IS the test for the real hook, so
// we restore the actual implementation locally. File-level vi.mock
// takes precedence over the setupFiles registration.
vi.mock('@/hooks/useSettings', async () =>
  await vi.importActual<typeof import('../useSettings')>('../useSettings'),
)

import { useSettings } from '../useSettings'
import {
  getGlobalLocale,
  getGlobalPrecision,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat'
import { broadcast } from '@/lib/broadcast'
import { TOPICS } from '@/lib/broadcastTopics'
import { FormatterPrefsBridge } from '@/components/FormatterPrefsBridge'
import { invalidateAndBroadcast, __flushQueryBroadcastForTests } from '@/lib/queryBroadcast'

/**
 * Phase-45 / Prompt 06 — broadcast propagation contract.
 *
 * The prompt's user-facing bug ("had to refresh the page after changing
 * the car color") is rooted in the fact that mutating settings on one
 * tab did not propagate to:
 *   1. dependent queries on the SAME tab (now handled by
 *      `invalidateAndBroadcast` inside `useSaveSettings`)
 *   2. module-level formatter globals on tabs that don't have a direct
 *      `useSettings()` consumer (handled by `<FormatterPrefsBridge />`)
 *   3. peer tabs (handled by `<QueryBroadcastBridge />`)
 *
 * These tests cover layers (1)+(2)+(3) at the unit-of-work boundary.
 * The cross-tab mechanics (`broadcast` ↔ `BroadcastChannel`) are
 * exhaustively tested in `lib/__tests__/broadcast.test.ts`.
 */

// ── Test plumbing ─────────────────────────────────────────────────────────────

let nextSettings: { locale?: string; decimal_precision?: number } = {
  locale: 'en-US',
  decimal_precision: 2,
}

// Mock the settings fetcher so the query resolves synchronously without
// network. Both the derived `@/hooks/useSettings` and the lower-level
// `@/api/hooks/useSettings` ultimately call this through `getSettings()`
// from `@/api/settings` (which itself calls `request<AppSettings>('/settings')`).
vi.mock('@/api/client', () => ({
  request: vi.fn(async () => nextSettings),
}))

function makeWrapper(): {
  Wrapper: (p: { children: ReactNode }) => JSX.Element
  qc: QueryClient
} {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { Wrapper, qc }
}

beforeEach(() => {
  // Reset module-level globals to a known state so each test starts
  // from the same baseline regardless of run order.
  setGlobalLocale('xx-XX')
  setGlobalPrecision(0)
  nextSettings = { locale: 'en-US', decimal_precision: 2 }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── 1. Derived useSettings hook applies globals from settings ────────────────

describe('useSettings derived hook — formatter globals', () => {
  it('applies locale and decimals from the resolved query', async () => {
    nextSettings = { locale: 'de-DE', decimal_precision: 3 }
    const { Wrapper } = makeWrapper()
    renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('de-DE')
      expect(getGlobalPrecision()).toBe(3)
    })
  })

  it('re-applies globals when settings change between fetches', async () => {
    nextSettings = { locale: 'en-US', decimal_precision: 2 }
    const { Wrapper, qc } = makeWrapper()
    renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('en-US')
      expect(getGlobalPrecision()).toBe(2)
    })

    // Simulate a user changing settings: server now returns new values,
    // and any code path that calls invalidate triggers a refetch.
    nextSettings = { locale: 'fr-FR', decimal_precision: 4 }
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] })
    })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('fr-FR')
      expect(getGlobalPrecision()).toBe(4)
    })
  })

  it('refetches the settings query on a settings.changed broadcast', async () => {
    nextSettings = { locale: 'en-US', decimal_precision: 2 }
    const { Wrapper } = makeWrapper()
    renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('en-US')
    })

    // A peer (or same-tab non-React-Query mutator) emits the umbrella
    // broadcast — the hook should pick it up, refetch, and the updated
    // server payload should propagate to the formatter globals.
    nextSettings = { locale: 'ja-JP', decimal_precision: 1 }

    // The bus self-filters same-tab broadcasts; emulate a peer envelope by
    // dispatching a storage event (the fallback transport) so subscribe()
    // delivers it back into the same tab.
    act(() => {
      const env = {
        _from: 'peer-tab',
        _ts: Date.now(),
        msg: { type: TOPICS.SETTINGS_CHANGED, keys: ['locale', 'decimal_precision'] },
      }
      window.localStorage.setItem('__teslasync_bus_test', JSON.stringify(env))
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: '__teslasync_bus_test',
          newValue: JSON.stringify(env),
        }),
      )
    })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('ja-JP')
      expect(getGlobalPrecision()).toBe(1)
    })
  })
})

// ── 2. FormatterPrefsBridge keeps globals current at the app root ────────────

describe('FormatterPrefsBridge — anchor for formatter globals', () => {
  it('applies globals on mount even when no page consumes useSettings()', async () => {
    nextSettings = { locale: 'es-ES', decimal_precision: 1 }
    const { Wrapper } = makeWrapper()
    renderHook(() => null, {
      wrapper: ({ children }) => (
        <Wrapper>
          <FormatterPrefsBridge />
          {children}
        </Wrapper>
      ),
    })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('es-ES')
      expect(getGlobalPrecision()).toBe(1)
    })
  })

  it('refetches and re-applies globals on a settings.changed broadcast', async () => {
    nextSettings = { locale: 'en-US', decimal_precision: 2 }
    const { Wrapper } = makeWrapper()
    renderHook(() => null, {
      wrapper: ({ children }) => (
        <Wrapper>
          <FormatterPrefsBridge />
          {children}
        </Wrapper>
      ),
    })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('en-US')
    })

    nextSettings = { locale: 'ko-KR', decimal_precision: 0 }
    act(() => {
      const env = {
        _from: 'peer-tab',
        _ts: Date.now(),
        msg: { type: TOPICS.SETTINGS_CHANGED },
      }
      window.localStorage.setItem('__teslasync_bus_test', JSON.stringify(env))
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: '__teslasync_bus_test',
          newValue: JSON.stringify(env),
        }),
      )
    })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('ko-KR')
      expect(getGlobalPrecision()).toBe(0)
    })
  })

  it('handles missing locale/decimal_precision by falling back to defaults', async () => {
    nextSettings = {}
    const { Wrapper } = makeWrapper()
    renderHook(() => null, {
      wrapper: ({ children }) => (
        <Wrapper>
          <FormatterPrefsBridge />
          {children}
        </Wrapper>
      ),
    })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('en-US')
      expect(getGlobalPrecision()).toBe(2)
    })
  })
})

// ── 3. invalidateAndBroadcast emits the queryInvalidate envelope ─────────────

describe('settings save → broadcast propagation', () => {
  it('invalidateAndBroadcast on the settings key emits a queryInvalidate broadcast', async () => {
    const broadcastSpy = vi.fn()
    const channel = new BroadcastChannel('teslasync')
    channel.addEventListener('message', (e: MessageEvent) => broadcastSpy(e.data))

    const { qc } = makeWrapper()
    invalidateAndBroadcast(qc, { queryKey: ['settings'] })
    __flushQueryBroadcastForTests()

    // BroadcastChannel delivery is async — give it a tick.
    await new Promise((r) => setTimeout(r, 5))

    channel.close()

    expect(broadcastSpy).toHaveBeenCalled()
    const env = broadcastSpy.mock.calls[0][0] as {
      msg: { type: string; keys: ReadonlyArray<ReadonlyArray<unknown>> }
    }
    expect(env.msg.type).toBe('queryInvalidate')
    expect(env.msg.keys).toEqual([['settings']])
  })

  it('a peer settings.changed broadcast also flows through the bridge', async () => {
    nextSettings = { locale: 'en-US', decimal_precision: 2 }
    const { Wrapper } = makeWrapper()

    renderHook(() => null, {
      wrapper: ({ children }) => (
        <Wrapper>
          <FormatterPrefsBridge />
          {children}
        </Wrapper>
      ),
    })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('en-US')
    })

    // Direct broadcast() from this tab is self-filtered; use the peer
    // envelope shape exactly like the real cross-tab path.
    nextSettings = { locale: 'pt-BR', decimal_precision: 3 }
    act(() => {
      const env = {
        _from: 'peer-tab-2',
        _ts: Date.now(),
        msg: { type: TOPICS.SETTINGS_CHANGED },
      }
      window.localStorage.setItem('__teslasync_bus_test', JSON.stringify(env))
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: '__teslasync_bus_test',
          newValue: JSON.stringify(env),
        }),
      )
    })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('pt-BR')
      expect(getGlobalPrecision()).toBe(3)
    })
  })

  it('TOPICS constants match the BroadcastMessage discriminator string values', () => {
    // Guards against a typo in either file: if the constants drift from
    // the union, publishers/subscribers would silently miss each other.
    // Sample the few that this prompt cares about.
    expect(TOPICS.SETTINGS_CHANGED).toBe('settings.changed')
    expect(TOPICS.THEME_CHANGED).toBe('theme.changed')
    expect(TOPICS.THEME_CUSTOM_COLORS).toBe('theme.customColors')
    expect(TOPICS.VEHICLE_PAINT_CHANGED).toBe('vehicle.paint.changed')
    expect(TOPICS.QUERY_INVALIDATE).toBe('queryInvalidate')

    // Smoke-publish: the discriminated union must accept the constant
    // (TS would have caught a type-only mismatch at compile time, but
    // this also exercises the runtime path without throwing).
    expect(() => broadcast({ type: TOPICS.SETTINGS_CHANGED })).not.toThrow()
  })
})
