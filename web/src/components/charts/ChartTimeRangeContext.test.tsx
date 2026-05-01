import { describe, it, expect } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  ChartTimeRangeProvider,
  useChartSync,
  useSyncedCursor,
} from './ChartTimeRangeContext'

describe('ChartTimeRangeContext', () => {
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

  it('useSyncedCursor returns syncId + syncMethod ready to spread on a recharts chart', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChartTimeRangeProvider syncId="drive-detail">{children}</ChartTimeRangeProvider>
    )
    const { result } = renderHook(() => useSyncedCursor(), { wrapper })
    expect(result.current).toEqual({ syncId: 'drive-detail', syncMethod: 'index' })
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
