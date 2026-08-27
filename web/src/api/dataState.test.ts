import { describe, it, expect } from 'vitest'

import {
  averageKnown,
  combineDataStates,
  deriveDataState,
  isFatal,
  isKnown,
  knownNumber,
  knownString,
  sumKnown,
  type DataState,
} from './dataState'

const NOW = 1_700_000_000_000
const now = () => NOW

describe('deriveDataState — retained data survives refresh failure', () => {
  it('keeps cached rows and reports stale when a background refetch errors', () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const state = deriveDataState(
      {
        data: rows,
        error: new Error('500 Internal Server Error'),
        isError: true,
        isFetching: false,
        fetchStatus: 'idle',
        dataUpdatedAt: NOW - 30_000,
      },
      { provenance: 'historical', now },
    )

    // The single most important assertion in this file: the payload is not
    // dropped just because the refresh failed.
    expect(state.data).toBe(rows)
    expect(state.hasData).toBe(true)
    expect(state.status).toBe('stale')
    expect(state.refreshError?.message).toContain('500')
    // Nothing may replace page content, so there is no fatal error.
    expect(state.fatalError).toBeNull()
    expect(isFatal(state)).toBe(false)
    expect(state.ageMs).toBe(30_000)
  })

  it('downgrades live provenance to cached once a refresh fails', () => {
    const state = deriveDataState(
      { data: { soc: 62 }, isError: true, error: new Error('boom'), dataUpdatedAt: NOW - 1_000 },
      { provenance: 'live', now },
    )
    expect(state.provenance).toBe('cached')
    expect(state.data).toEqual({ soc: 62 })
  })

  it('reports initialFailure only when nothing is retained', () => {
    const state = deriveDataState(
      { data: undefined, isError: true, error: new Error('nope') },
      { provenance: 'live', now },
    )
    expect(state.status).toBe('initialFailure')
    expect(state.hasData).toBe(false)
    expect(state.fatalError?.message).toBe('nope')
    expect(state.refreshError).toBeNull()
    expect(isFatal(state)).toBe(true)
    // A failed first load establishes nothing about provenance.
    expect(state.provenance).toBe('unknown')
  })

  it('reports initial (not failure) while the first load is pending', () => {
    const state = deriveDataState({ isPending: true, isFetching: true, fetchStatus: 'fetching' }, { now })
    expect(state.status).toBe('initial')
    expect(state.fatalError).toBeNull()
  })

  it('treats an offline-paused refresh as stale, not as an error', () => {
    const state = deriveDataState(
      { data: [1], fetchStatus: 'paused', dataUpdatedAt: NOW - 5_000 },
      { provenance: 'live', now },
    )
    expect(state.status).toBe('stale')
    expect(state.isRefreshBlocked).toBe(true)
    expect(state.refreshError).toBeNull()
    expect(state.data).toEqual([1])
  })

  it('marks retained data stale once it exceeds maxAgeMs', () => {
    const fresh = deriveDataState(
      { data: [1], isSuccess: true, dataUpdatedAt: NOW - 1_000 },
      { maxAgeMs: 60_000, now },
    )
    const old = deriveDataState(
      { data: [1], isSuccess: true, dataUpdatedAt: NOW - 120_000 },
      { maxAgeMs: 60_000, now },
    )
    expect(fresh.status).toBe('ok')
    expect(old.status).toBe('stale')
    expect(old.data).toEqual([1])
  })

  it('surfaces partial and unavailable without hiding the payload', () => {
    const partial = deriveDataState({ data: [1], isSuccess: true, dataUpdatedAt: NOW }, { partial: true, now })
    const unavailable = deriveDataState(
      { data: [], isSuccess: true, dataUpdatedAt: NOW },
      { unavailable: true, now },
    )
    expect(partial.status).toBe('partial')
    expect(partial.data).toEqual([1])
    expect(unavailable.status).toBe('unavailable')
    expect(unavailable.data).toEqual([])
  })

  it('flags a refresh in flight over retained data', () => {
    const state = deriveDataState(
      { data: [1], isFetching: true, fetchStatus: 'fetching', dataUpdatedAt: NOW - 100 },
      { now },
    )
    expect(state.isRefreshing).toBe(true)
    expect(state.status).toBe('ok')
  })

  it('forwards refetch as a retry handle', () => {
    let calls = 0
    const state = deriveDataState(
      { data: [1], isError: true, error: new Error('x'), refetch: () => { calls += 1 }, dataUpdatedAt: NOW },
      { now },
    )
    state.retry?.()
    expect(calls).toBe(1)
  })
})

describe('combineDataStates', () => {
  const ok = (): DataState<unknown> =>
    deriveDataState({ data: [1], isSuccess: true, dataUpdatedAt: NOW - 1_000 }, { now })
  const failed = (): DataState<unknown> =>
    deriveDataState({ isError: true, error: new Error('down') }, { now })
  const staleWithData = (): DataState<unknown> =>
    deriveDataState({ data: [2], isError: true, error: new Error('refresh'), dataUpdatedAt: NOW - 9_000 }, { now })

  it('reports partial — never initialFailure — when some sources still render', () => {
    const combined = combineDataStates([ok(), failed()])
    expect(combined.status).toBe('partial')
    expect(combined.fatalError).toBeNull()
  })

  it('reports initialFailure only when every source failed its first load', () => {
    const combined = combineDataStates([failed(), failed()])
    expect(combined.status).toBe('initialFailure')
    expect(combined.fatalError).not.toBeNull()
  })

  it('takes the oldest contributing source as the panel freshness', () => {
    const combined = combineDataStates([ok(), staleWithData()])
    expect(combined.ageMs).toBe(9_000)
    expect(combined.updatedAt).toBe(NOW - 9_000)
    expect(combined.status).toBe('stale')
    expect(combined.refreshError).not.toBeNull()
  })

  it('is initial for an empty source list', () => {
    expect(combineDataStates([]).status).toBe('initial')
  })
})

describe('unknown-honest value helpers', () => {
  it('never coerces an unknown reading to 0', () => {
    expect(knownNumber(undefined)).toBeNull()
    expect(knownNumber(null)).toBeNull()
    expect(knownNumber(Number.NaN)).toBeNull()
    expect(knownNumber(Number.POSITIVE_INFINITY)).toBeNull()
    expect(knownNumber('')).toBeNull()
    expect(knownNumber('   ')).toBeNull()
    expect(knownNumber('not-a-number')).toBeNull()
    expect(knownNumber({})).toBeNull()
  })

  it('preserves a genuine zero', () => {
    expect(knownNumber(0)).toBe(0)
    expect(knownNumber('0')).toBe(0)
    expect(knownNumber(-0.5)).toBe(-0.5)
  })

  it('distinguishes unknown strings from empty strings', () => {
    expect(knownString('')).toBeNull()
    expect(knownString('  ')).toBeNull()
    expect(knownString(42 as unknown as string)).toBeNull()
    expect(knownString(' ok ')).toBe('ok')
  })

  it('isKnown narrows', () => {
    expect(isKnown(0)).toBe(true)
    expect(isKnown(null)).toBe(false)
    expect(isKnown(undefined)).toBe(false)
  })

  it('sums only known members and returns null when none are known', () => {
    expect(sumKnown([1, null, 2, undefined, Number.NaN])).toBe(3)
    expect(sumKnown([null, undefined])).toBeNull()
    expect(sumKnown([])).toBeNull()
    expect(sumKnown([0])).toBe(0)
  })

  it('excludes unknown members from the average denominator', () => {
    // If unknowns were coerced to 0 this would be 5, silently halving the metric.
    expect(averageKnown([10, null, undefined])).toBe(10)
    expect(averageKnown([null])).toBeNull()
    expect(averageKnown([2, 4])).toBe(3)
  })
})
