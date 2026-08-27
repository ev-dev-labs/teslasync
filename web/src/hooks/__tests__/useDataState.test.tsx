import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useDataState, useCombinedDataState } from '../useDataState'
import { deriveDataState, type DataState } from '@/api/dataState'

describe('useDataState', () => {
  it('keeps a stable identity while the query fields are unchanged', () => {
    const refetch = vi.fn()
    const rows = [{ id: 1 }]
    const { result, rerender } = renderHook(
      ({ isFetching }: { isFetching: boolean }) =>
        useDataState({
          data: rows,
          isFetching,
          dataUpdatedAt: 1_000,
          refetch,
        }),
      { initialProps: { isFetching: false } },
    )

    const first = result.current
    rerender({ isFetching: false })
    // A fresh `source` object every render must NOT churn the derived state —
    // consumers pass it into memoised children and effect dependency arrays.
    expect(result.current).toBe(first)

    rerender({ isFetching: true })
    expect(result.current).not.toBe(first)
    expect(result.current.isRefreshing).toBe(true)
  })

  it('routes a refresh failure to refreshError, never to fatalError', () => {
    const { result } = renderHook(() =>
      useDataState({
        data: [1],
        error: new Error('502'),
        isError: true,
        dataUpdatedAt: 1_000,
      }),
    )
    expect(result.current.status).toBe('stale')
    expect(result.current.fatalError).toBeNull()
    expect(result.current.refreshError?.message).toBe('502')
    expect(result.current.data).toEqual([1])
  })

  it('reports the requested provenance on a healthy read', () => {
    const { result } = renderHook(() =>
      useDataState({ data: [1], isSuccess: true, dataUpdatedAt: 1_000 }, { provenance: 'historical' }),
    )
    expect(result.current.provenance).toBe('historical')
  })
})

describe('useCombinedDataState', () => {
  it('collapses a mixed panel to partial rather than to a failure', () => {
    const ok = deriveDataState({ data: [1], isSuccess: true, dataUpdatedAt: 1_000 })
    const failed = deriveDataState({ isError: true, error: new Error('down') })
    const states: DataState<unknown>[] = [ok, failed]

    const { result, rerender } = renderHook(() => useCombinedDataState(states))
    expect(result.current.status).toBe('partial')
    expect(result.current.fatalError).toBeNull()

    // Same array identity → same memoised result.
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
