import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  _resetCursorSyncStore,
  clearCursorSync,
  getCursorSyncPosition,
  setCursorSyncPosition,
  useCursorSyncPosition,
} from '../cursorSync'

describe('cursorSync store', () => {
  beforeEach(() => {
    _resetCursorSyncStore()
  })

  it('getCursorSyncPosition returns null for unknown syncIds', () => {
    expect(getCursorSyncPosition('missing')).toBeNull()
  })

  it('setCursorSyncPosition stores the value and getCursorSyncPosition reads it back', () => {
    setCursorSyncPosition('a', '12:34')
    expect(getCursorSyncPosition('a')).toBe('12:34')
    setCursorSyncPosition('a', 42)
    expect(getCursorSyncPosition('a')).toBe(42)
  })

  it('setCursorSyncPosition with null clears the entry', () => {
    setCursorSyncPosition('a', 'value')
    setCursorSyncPosition('a', null)
    expect(getCursorSyncPosition('a')).toBeNull()
  })

  it('clearCursorSync removes a single syncId without touching others', () => {
    setCursorSyncPosition('a', 1)
    setCursorSyncPosition('b', 2)
    clearCursorSync('a')
    expect(getCursorSyncPosition('a')).toBeNull()
    expect(getCursorSyncPosition('b')).toBe(2)
  })

  it('useCursorSyncPosition subscribes and re-renders on store changes', () => {
    const { result } = renderHook(() => useCursorSyncPosition('chart-1'))
    expect(result.current).toBeNull()

    act(() => {
      setCursorSyncPosition('chart-1', 'noon')
    })
    expect(result.current).toBe('noon')

    act(() => {
      setCursorSyncPosition('chart-1', 99)
    })
    expect(result.current).toBe(99)

    act(() => {
      clearCursorSync('chart-1')
    })
    expect(result.current).toBeNull()
  })

  it('useCursorSyncPosition returns null when syncId is undefined', () => {
    const { result } = renderHook(() => useCursorSyncPosition(undefined))
    expect(result.current).toBeNull()
    // Updates to other syncIds do not trigger a re-render to a non-null value.
    act(() => {
      setCursorSyncPosition('whatever', 'x')
    })
    expect(result.current).toBeNull()
  })

  it('useCursorSyncPosition only re-renders subscribers of its own syncId', () => {
    const renderSpy = vi.fn()
    renderHook(() => {
      renderSpy()
      return useCursorSyncPosition('alpha')
    })
    const initialRenderCount = renderSpy.mock.calls.length

    act(() => {
      setCursorSyncPosition('beta', 'irrelevant')
    })
    // Subscribers re-run getSnapshot but React bails out when the snapshot
    // value is identical (both null), so no extra render happens.
    expect(renderSpy.mock.calls.length).toBe(initialRenderCount)

    act(() => {
      setCursorSyncPosition('alpha', 'mine')
    })
    expect(renderSpy.mock.calls.length).toBeGreaterThan(initialRenderCount)
  })

  it('setCursorSyncPosition is a no-op when the value is unchanged', () => {
    setCursorSyncPosition('idem', 7)
    const renderSpy = vi.fn()
    renderHook(() => {
      renderSpy()
      return useCursorSyncPosition('idem')
    })
    const initialRenderCount = renderSpy.mock.calls.length
    act(() => {
      setCursorSyncPosition('idem', 7)
    })
    expect(renderSpy.mock.calls.length).toBe(initialRenderCount)
  })

  it('different syncIds maintain independent positions', () => {
    setCursorSyncPosition('foo', 1)
    setCursorSyncPosition('bar', 2)
    setCursorSyncPosition('baz', 3)
    expect(getCursorSyncPosition('foo')).toBe(1)
    expect(getCursorSyncPosition('bar')).toBe(2)
    expect(getCursorSyncPosition('baz')).toBe(3)
  })

  it('_resetCursorSyncStore clears every entry and listener', () => {
    setCursorSyncPosition('x', 'y')
    _resetCursorSyncStore()
    expect(getCursorSyncPosition('x')).toBeNull()
  })
})
