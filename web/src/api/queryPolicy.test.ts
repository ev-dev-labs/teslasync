import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import {
  MIN_REFETCH_INTERVAL_MS,
  QUERY_POLICIES,
  clampRefetchInterval,
  paginatedQueryPolicy,
  policyRetryDelay,
  queryPolicy,
  retryPolicy,
  type QueryVolatility,
} from './queryPolicy'

const TIERS: readonly QueryVolatility[] = ['live', 'operational', 'historical', 'reference']

describe('QUERY_POLICIES invariants', () => {
  it.each(TIERS)('%s keeps gcTime above staleTime', (tier) => {
    const policy = QUERY_POLICIES[tier]
    expect(policy.staleTime).toBeGreaterThan(0)
    expect(policy.gcTime).toBeGreaterThan(policy.staleTime)
  })

  it.each(TIERS)('%s never polls faster than its own cache window', (tier) => {
    const policy = QUERY_POLICIES[tier]
    if (policy.refetchInterval === false) return
    expect(policy.refetchInterval).toBeGreaterThanOrEqual(policy.staleTime)
    expect(policy.refetchInterval).toBeGreaterThanOrEqual(MIN_REFETCH_INTERVAL_MS)
  })

  it.each(TIERS)('%s never enables background polling', (tier) => {
    expect(QUERY_POLICIES[tier].refetchIntervalInBackground).toBe(false)
  })

  it('orders the tiers from most to least volatile', () => {
    expect(QUERY_POLICIES.live.staleTime).toBeLessThan(QUERY_POLICIES.operational.staleTime)
    expect(QUERY_POLICIES.operational.staleTime).toBeLessThan(QUERY_POLICIES.historical.staleTime)
    expect(QUERY_POLICIES.historical.staleTime).toBeLessThan(QUERY_POLICIES.reference.staleTime)
  })

  it('only the live tier polls by default', () => {
    expect(QUERY_POLICIES.live.refetchInterval).not.toBe(false)
    expect(QUERY_POLICIES.operational.refetchInterval).toBe(false)
    expect(QUERY_POLICIES.historical.refetchInterval).toBe(false)
    expect(QUERY_POLICIES.reference.refetchInterval).toBe(false)
  })
})

describe('clampRefetchInterval', () => {
  it('disables polling for non-finite / non-positive input rather than passing NaN to the scheduler', () => {
    expect(clampRefetchInterval(Number.NaN, 1_000)).toBe(false)
    expect(clampRefetchInterval(0, 1_000)).toBe(false)
    expect(clampRefetchInterval(-5, 1_000)).toBe(false)
    expect(clampRefetchInterval(Number.POSITIVE_INFINITY, 1_000)).toBe(false)
    expect(clampRefetchInterval(false, 1_000)).toBe(false)
    expect(clampRefetchInterval(undefined, 1_000)).toBe(false)
  })

  it('raises a storm-inducing interval up to the stale window', () => {
    expect(clampRefetchInterval(200, 30_000)).toBe(30_000)
    expect(clampRefetchInterval(45_000, 30_000)).toBe(45_000)
  })

  it('enforces the global floor even with a zero stale window', () => {
    expect(clampRefetchInterval(10, 0)).toBe(MIN_REFETCH_INTERVAL_MS)
  })
})

describe('queryPolicy overrides', () => {
  it('cannot introduce a request storm', () => {
    const policy = queryPolicy('historical', { refetchInterval: 250 })
    expect(policy.refetchInterval).toBe(QUERY_POLICIES.historical.staleTime)
  })

  it('cannot re-enable background polling', () => {
    const policy = queryPolicy('live', {
      // @ts-expect-error — the override type excludes this key on purpose.
      refetchIntervalInBackground: true,
    })
    expect(policy.refetchIntervalInBackground).toBe(false)
  })

  it('keeps gcTime at or above an enlarged staleTime', () => {
    const policy = queryPolicy('live', { staleTime: 60 * 60_000 })
    expect(policy.gcTime).toBeGreaterThanOrEqual(policy.staleTime)
  })

  it('honours an explicit refetchInterval: false override', () => {
    expect(queryPolicy('live', { refetchInterval: false }).refetchInterval).toBe(false)
  })

  it('ignores invalid staleTime / gcTime overrides instead of propagating NaN', () => {
    const policy = queryPolicy('operational', { staleTime: Number.NaN, gcTime: -1 })
    expect(policy.staleTime).toBe(QUERY_POLICIES.operational.staleTime)
    expect(policy.gcTime).toBe(QUERY_POLICIES.operational.gcTime)
  })

  it('passes through an explicitly requested retry policy', () => {
    expect(queryPolicy('operational', { retry: 0 }).retry).toBe(0)
    expect(queryPolicy('operational', { retry: 5 }).retry).toBe(5)
  })
})

describe('retry ownership — the ambient QueryClient wins unless asked otherwise', () => {
  const TIERS_ALL: readonly QueryVolatility[] = ['live', 'operational', 'historical', 'reference']

  it.each(TIERS_ALL)('%s omits retry / retryDelay entirely', (tier) => {
    // Presence, not value: TanStack resolves `client defaults < query
    // options`, so ANY emitted key here is un-overridable from the outside.
    const policy = queryPolicy(tier)
    expect('retry' in policy).toBe(false)
    expect('retryDelay' in policy).toBe(false)
  })

  it('lets a QueryClient default of retry:false take effect', () => {
    // The exact regression: an isolated test (or a runtime kill-switch) sets
    // retry:false, the hook-level retry:1 silently won, the request kept
    // retrying with backoff and the error surface never rendered.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const merged = client.defaultQueryOptions({ queryKey: ['x'], ...queryPolicy('live') })
    expect(merged.retry).toBe(false)
  })

  it('preserves the production default when no override is given', () => {
    // Production client default (api/queryClient.ts) is retry: 1 — the same
    // value the live tier declares, so removing the emitted key is a no-op
    // for runtime behaviour.
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })
    const merged = client.defaultQueryOptions({ queryKey: ['x'], ...queryPolicy('live') })
    expect(merged.retry).toBe(1)
    expect(QUERY_POLICIES.live.retry).toBe(1)
  })

  it('an explicit caller override beats the client default', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const merged = client.defaultQueryOptions({
      queryKey: ['x'],
      ...queryPolicy('live', { retry: 3 }),
    })
    expect(merged.retry).toBe(3)
  })

  it('preserves an explicit retry: 0 rather than treating it as absent', () => {
    const policy = queryPolicy('live', { retry: 0 })
    expect('retry' in policy).toBe(true)
    expect(policy.retry).toBe(0)
  })

  it('emits retryDelay only when explicitly supplied', () => {
    const custom = () => 1234
    expect('retryDelay' in queryPolicy('live', { retry: 2 })).toBe(false)
    expect(queryPolicy('live', { retryDelay: custom }).retryDelay).toBe(custom)
  })

  it('retryPolicy() is the deliberate opt-in to the tier intent', () => {
    expect(retryPolicy('operational')).toEqual({ retry: 2, retryDelay: policyRetryDelay })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const merged = client.defaultQueryOptions({
      queryKey: ['x'],
      ...queryPolicy('operational'),
      ...retryPolicy('operational'),
    })
    expect(merged.retry).toBe(2)
  })

  it('paginatedQueryPolicy inherits the same retry ownership', () => {
    expect('retry' in paginatedQueryPolicy('operational')).toBe(false)
  })

  it('still declares per-tier retry intent for documentation and opt-in', () => {
    expect(QUERY_POLICIES.live.retry).toBe(1)
    expect(QUERY_POLICIES.operational.retry).toBe(2)
    expect(QUERY_POLICIES.historical.retry).toBe(2)
    expect(QUERY_POLICIES.reference.retry).toBe(2)
  })
})

describe('policyRetryDelay', () => {
  it('backs off exponentially and caps at 30s', () => {
    expect(policyRetryDelay(0)).toBe(2_000)
    expect(policyRetryDelay(1)).toBe(4_000)
    expect(policyRetryDelay(10)).toBe(30_000)
  })
})

describe('paginatedQueryPolicy', () => {
  it('adds keepPreviousData for intra-scope pagination only', () => {
    const policy = paginatedQueryPolicy('operational')
    expect(policy.placeholderData).toBeTypeOf('function')
    // The base tier is untouched, so a non-paginated query cannot inherit
    // cross-scope data retention by accident.
    expect('placeholderData' in queryPolicy('operational')).toBe(false)
  })
})
