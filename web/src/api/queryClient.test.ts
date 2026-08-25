/**
 * queryClient pause-when-hidden polling tests.
 *
 * Locks in the pause-when-hidden polling contract:
 *
 *   1. `DEFAULT_QUERY_CLIENT_CONFIG` exposes `refetchIntervalInBackground:
 *      false` on `defaultOptions.queries` (catches accidental removal).
 *   2. The factory propagates that default into the resulting QueryClient.
 *   3. Behavioural: a query that uses bare `refetchInterval` stops
 *      refetching while `focusManager` reports unfocused, and resumes
 *      once focus returns. This is what keeps Tesla API quota safe for
 *      users who leave TeslaSync open in a background tab.
 *   4. Behavioural: a query that explicitly opts in via
 *      `refetchIntervalInBackground: true` continues to refetch while
 *      unfocused. The opt-in must remain available for hooks that
 *      genuinely need persistent polling (covered by the
 *      `audit:bg-polling` annotation requirement).
 *
 * Tests use TanStack Query's own `focusManager.setFocused()` to simulate
 * tab visibility transitions deterministically — that is precisely the
 * primitive the QueryObserver consults at every interval tick.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { focusManager, QueryObserver } from '@tanstack/react-query'

import { createQueryClient, DEFAULT_QUERY_CLIENT_CONFIG } from './queryClient'

describe('DEFAULT_QUERY_CLIENT_CONFIG', () => {
  it('sets refetchIntervalInBackground=false on the queries defaults', () => {
    expect(
      DEFAULT_QUERY_CLIENT_CONFIG.defaultOptions?.queries?.refetchIntervalInBackground,
    ).toBe(false)
  })

  it('keeps queries cache-first while mutations fail immediately offline', () => {
    const queries = DEFAULT_QUERY_CLIENT_CONFIG.defaultOptions?.queries
    expect(queries?.staleTime).toBe(60_000)
    expect(queries?.retry).toBe(1)
    expect(queries?.refetchOnWindowFocus).toBe(false)
    expect(queries?.networkMode).toBe('offlineFirst')

    const mutations = DEFAULT_QUERY_CLIENT_CONFIG.defaultOptions?.mutations
    expect(mutations?.retry).toBe(0)
    expect(mutations?.networkMode).toBe('always')
  })
})

describe('createQueryClient', () => {
  it('returns a QueryClient with refetchIntervalInBackground=false default', () => {
    const qc = createQueryClient()
    const opts = qc.getDefaultOptions()
    expect(opts.queries?.refetchIntervalInBackground).toBe(false)
    expect(opts.queries?.networkMode).toBe('offlineFirst')
    expect(opts.mutations?.retry).toBe(0)
    expect(opts.mutations?.networkMode).toBe('always')
  })

  it('keeps the last successful value visible while a same-key refresh is pending', async () => {
    const qc = createQueryClient()
    const queryKey = ['perceived-performance', 'refresh']
    qc.setQueryData(queryKey, 'previous')

    let resolveRefresh: ((value: string) => void) | undefined
    const observer = new QueryObserver(qc, {
      queryKey,
      queryFn: () =>
        new Promise<string>((resolve) => {
          resolveRefresh = resolve
        }),
    })
    const unsubscribe = observer.subscribe(() => {})

    try {
      const refresh = observer.refetch()
      await Promise.resolve()

      const pending = observer.getCurrentResult()
      expect(pending.isFetching).toBe(true)
      expect(pending.data).toBe('previous')

      resolveRefresh?.('fresh')
      await refresh

      const settled = observer.getCurrentResult()
      expect(settled.isFetching).toBe(false)
      expect(settled.data).toBe('fresh')
    } finally {
      unsubscribe()
    }
  })
})

describe('refetchInterval pause-when-hidden behaviour', () => {
  beforeEach(() => {
    // Force the focusManager into a known-focused state before each
    // test so transitions from focused→unfocused are observable.
    focusManager.setFocused(true)
  })

  afterEach(() => {
    // Hand control back to TanStack's default visibilitychange listener
    // so subsequent suites are not pinned by leftover state.
    focusManager.setFocused(undefined)
  })

  it('default-config query stops refetching while focusManager is unfocused', async () => {
    const qc = createQueryClient()
    let calls = 0
    const observer = new QueryObserver(qc, {
      queryKey: ['phase-46-53', 'paused-default'],
      queryFn: async () => {
        calls += 1
        return calls
      },
      refetchInterval: 50,
      // intentionally NOT setting refetchIntervalInBackground —
      // exercises the inherited default from createQueryClient().
    })
    const unsub = observer.subscribe(() => {})

    try {
      // Allow the initial fetch + several interval ticks to land while
      // the manager reports focused.
      await new Promise((r) => setTimeout(r, 250))
      expect(calls).toBeGreaterThanOrEqual(2)

      // Flip to unfocused; capture the call count and assert it is
      // unchanged after a comfortably-larger-than-interval wait.
      focusManager.setFocused(false)
      const baselineWhileHidden = calls
      await new Promise((r) => setTimeout(r, 300))
      expect(calls).toBe(baselineWhileHidden)

      // Restore focus; the interval should resume firing.
      focusManager.setFocused(true)
      await new Promise((r) => setTimeout(r, 200))
      expect(calls).toBeGreaterThan(baselineWhileHidden)
    } finally {
      unsub()
    }
  })

  it('refetchIntervalInBackground=true keeps polling while focusManager is unfocused', async () => {
    const qc = createQueryClient()
    let calls = 0
    const observer = new QueryObserver(qc, {
      queryKey: ['phase-46-53', 'opt-in'],
      queryFn: async () => {
        calls += 1
        return calls
      },
      refetchInterval: 50,
      // Explicit opt-in: simulates a hook that ships
      // `// ALLOW-BG-POLLING: <reason>` + this override.
      refetchIntervalInBackground: true,
    })
    const unsub = observer.subscribe(() => {})

    try {
      await new Promise((r) => setTimeout(r, 100))
      const baseline = calls
      expect(baseline).toBeGreaterThanOrEqual(1)

      focusManager.setFocused(false)
      await new Promise((r) => setTimeout(r, 300))

      // Opt-in ⇒ refetches continue even though focusManager is unfocused.
      expect(calls).toBeGreaterThan(baseline)
    } finally {
      unsub()
    }
  })
})
