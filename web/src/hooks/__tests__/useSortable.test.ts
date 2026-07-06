import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useSortable } from '../useSortable'

interface Row {
  name: string
  score: number
  rank: number | null
  done: boolean
}

const rows: Row[] = [
  { name: 'Charlie', score: 100, rank: 2, done: true },
  { name: 'Alice', score: 5, rank: null, done: false },
  { name: 'Bob', score: 20, rank: 1, done: true },
]

const names = (list: Row[]) => list.map((r) => r.name)

describe('useSortable', () => {
  it('sorts ascending by the default key on first render', () => {
    const { result } = renderHook(() => useSortable(rows, 'name'))
    expect(result.current.sortKey).toBe('name')
    expect(result.current.sortDir).toBe('asc')
    expect(names(result.current.sorted)).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  it('honours an explicit default direction of desc', () => {
    const { result } = renderHook(() => useSortable(rows, 'name', 'desc'))
    expect(result.current.sortDir).toBe('desc')
    expect(names(result.current.sorted)).toEqual(['Charlie', 'Bob', 'Alice'])
  })

  it('compares numbers numerically, not lexicographically', () => {
    const { result } = renderHook(() => useSortable(rows, 'score'))
    // Lexicographic order would yield ['100', '20', '5']; numeric is 5 < 20 < 100.
    expect(result.current.sorted.map((r) => r.score)).toEqual([5, 20, 100])
    expect(names(result.current.sorted)).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  it('sorts booleans with false before true in ascending order', () => {
    const { result } = renderHook(() => useSortable(rows, 'done'))
    expect(result.current.sorted[0].done).toBe(false)
    expect(result.current.sorted.slice(1).every((r) => r.done)).toBe(true)
  })

  it('pins null/undefined values to the end in ascending order', () => {
    const { result } = renderHook(() => useSortable(rows, 'rank'))
    expect(names(result.current.sorted)).toEqual(['Bob', 'Charlie', 'Alice'])
    const last = result.current.sorted[result.current.sorted.length - 1]
    expect(last.rank).toBeNull()
  })

  it('keeps null values last even when the direction is desc', () => {
    const { result } = renderHook(() => useSortable(rows, 'rank', 'desc'))
    // Non-null ranks descend (2, 1); the null row stays pinned to the end.
    expect(names(result.current.sorted)).toEqual(['Charlie', 'Bob', 'Alice'])
    expect(result.current.sorted[2].rank).toBeNull()
  })

  it('does not mutate the input array', () => {
    const input: Row[] = [...rows]
    const snapshot = names(input)
    renderHook(() => useSortable(input, 'name'))
    expect(names(input)).toEqual(snapshot)
  })

  it('toggle flips direction when called with the active key', () => {
    const { result } = renderHook(() => useSortable(rows, 'name'))
    expect(result.current.sortDir).toBe('asc')

    act(() => result.current.toggle('name'))
    expect(result.current.sortDir).toBe('desc')
    expect(names(result.current.sorted)).toEqual(['Charlie', 'Bob', 'Alice'])

    act(() => result.current.toggle('name'))
    expect(result.current.sortDir).toBe('asc')
    expect(names(result.current.sorted)).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  it('toggle selects a new key and resets direction to asc', () => {
    const { result } = renderHook(() => useSortable(rows, 'name', 'desc'))
    expect(result.current.sortDir).toBe('desc')

    act(() => result.current.toggle('score'))
    expect(result.current.sortKey).toBe('score')
    expect(result.current.sortDir).toBe('asc')
    expect(result.current.sorted.map((r) => r.score)).toEqual([5, 20, 100])
  })

  it('returns an empty array when data is undefined instead of throwing', () => {
    const { result } = renderHook(() => useSortable<Row>(undefined, 'name'))
    expect(result.current.sorted).toEqual([])
    expect(result.current.sortKey).toBe('name')
    expect(result.current.sortDir).toBe('asc')
  })

  it('returns an empty array when data is null instead of throwing', () => {
    const { result } = renderHook(() => useSortable<Row>(null, 'name'))
    expect(result.current.sorted).toEqual([])
  })

  it('keeps the toggle reference stable across re-renders when the key is unchanged', () => {
    const { result, rerender } = renderHook(
      (props: { data: Row[] }) => useSortable(props.data, 'name'),
      { initialProps: { data: rows } },
    )
    const firstToggle = result.current.toggle
    // A re-render with a fresh data array (same key) must not recreate the callback.
    rerender({ data: [...rows] })
    expect(result.current.toggle).toBe(firstToggle)
  })

  it('recomputes the sorted list when the data reference changes', () => {
    const { result, rerender } = renderHook(
      (props: { data: Row[] }) => useSortable(props.data, 'score'),
      { initialProps: { data: rows } },
    )
    expect(result.current.sorted.map((r) => r.score)).toEqual([5, 20, 100])

    const nextRows: Row[] = [
      { name: 'Dana', score: 1, rank: 3, done: false },
      { name: 'Erin', score: 99, rank: 4, done: true },
    ]
    rerender({ data: nextRows })
    expect(result.current.sorted.map((r) => r.name)).toEqual(['Dana', 'Erin'])
  })

  it('returns a referentially stable snapshot when nothing changes', () => {
    const { result, rerender } = renderHook(
      (props: { data: Row[] }) => useSortable(props.data, 'name'),
      { initialProps: { data: rows } },
    )
    const first = result.current
    rerender({ data: rows })
    expect(result.current).toBe(first)
  })
})
