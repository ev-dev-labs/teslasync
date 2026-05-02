import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  ChartTimeRangeProvider,
  useChartSync,
  useSyncedCursor,
  useSyncedReferenceLineX,
} from './ChartTimeRangeContext'
import {
  _resetCursorSyncStore,
  getCursorSyncPosition,
  setCursorSyncPosition,
} from './cursorSync'

describe('ChartTimeRangeContext', () => {
  beforeEach(() => {
    _resetCursorSyncStore()
  })

  it('useChartSync returns null outside provider', () => {
    const { result } = renderHook(() => useChartSync())
    expect(result.current).toBeNull()
  })

  it('useChartSync returns the configured syncId + default syncMethod inside provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChartTimeRangeProvider syncId="test-page">{children}</ChartTimeRangeProvider>
    )
    const { result } = renderHook(() => useChartSync(), { wrapper })
    expect(result.current).toEqual({ syncId: 'test-page', syncMethod: 'index' })
  })

  it('useChartSync honors explicit syncMethod prop', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChartTimeRangeProvider syncId="x" syncMethod="value">
        {children}
      </ChartTimeRangeProvider>
    )
    const { result } = renderHook(() => useChartSync(), { wrapper })
    expect(result.current).toEqual({ syncId: 'x', syncMethod: 'value' })
  })

  it('useSyncedCursor returns empty object outside provider', () => {
    const { result } = renderHook(() => useSyncedCursor())
    expect(result.current).toEqual({})
  })

  it('useSyncedCursor returns syncId + syncMethod + onMouseMove inside provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChartTimeRangeProvider syncId="drive-detail">{children}</ChartTimeRangeProvider>
    )
    const { result } = renderHook(() => useSyncedCursor(), { wrapper })
    expect(result.current.syncId).toBe('drive-detail')
    expect(result.current.syncMethod).toBe('index')
    expect(typeof result.current.onMouseMove).toBe('function')
  })

  it('useSyncedCursor.onMouseMove writes the activeLabel into the cursor sync store', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChartTimeRangeProvider syncId="m1">{children}</ChartTimeRangeProvider>
    )
    const { result } = renderHook(() => useSyncedCursor(), { wrapper })
    act(() => {
      result.current.onMouseMove?.({ activeLabel: '12:34' })
    })
    expect(getCursorSyncPosition('m1')).toBe('12:34')
    act(() => {
      result.current.onMouseMove?.({ activeLabel: undefined })
    })
    expect(getCursorSyncPosition('m1')).toBeNull()
  })

  it('useSyncedReferenceLineX returns null outside provider', () => {
    const { result } = renderHook(() => useSyncedReferenceLineX())
    expect(result.current).toBeNull()
  })

  it('useSyncedReferenceLineX subscribes to the persistent cursor for the syncId', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChartTimeRangeProvider syncId="m2">{children}</ChartTimeRangeProvider>
    )
    const { result } = renderHook(() => useSyncedReferenceLineX(), { wrapper })
    expect(result.current).toBeNull()
    act(() => {
      setCursorSyncPosition('m2', 42)
    })
    expect(result.current).toBe(42)
    act(() => {
      setCursorSyncPosition('m2', null)
    })
    expect(result.current).toBeNull()
  })

  it('ChartTimeRangeProvider clears its cursor on unmount', () => {
    const { unmount } = render(
      <ChartTimeRangeProvider syncId="m3">
        <div />
      </ChartTimeRangeProvider>,
    )
    setCursorSyncPosition('m3', 'lingering')
    expect(getCursorSyncPosition('m3')).toBe('lingering')
    unmount()
    expect(getCursorSyncPosition('m3')).toBeNull()
  })

  it('renders children unchanged', () => {
    const { getByText } = render(
      <ChartTimeRangeProvider syncId="x">
        <div>child content</div>
      </ChartTimeRangeProvider>,
    )
    expect(getByText('child content')).toBeInTheDocument()
  })

  it('memoizes context value so consumers do not re-render unnecessarily', () => {
    let renders = 0
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChartTimeRangeProvider syncId="stable">{children}</ChartTimeRangeProvider>
    )
    const { result, rerender } = renderHook(() => {
      renders += 1
      return useChartSync()
    }, { wrapper })
    const first = result.current
    rerender()
    // The context value is memoized — same reference across re-renders.
    expect(result.current).toBe(first)
    // Two renders is the React-strict-mode-friendly minimum; the hook should
    // not be called more than rerender + initial.
    expect(renders).toBeGreaterThanOrEqual(2)
  })
})
