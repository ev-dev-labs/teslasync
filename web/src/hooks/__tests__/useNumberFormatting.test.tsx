import { act, render, renderHook, screen } from '@testing-library/react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import { useNumberFormatting } from '../useNumberFormatting'
import { formatDurationClock } from '@/lib/dateFormat'

beforeEach(() => {
  setGlobalLocale('en-US')
  setGlobalPrecision(2)
})

describe('useNumberFormatting', () => {
  it('updates existing formatters when the settings bridge changes precision', () => {
    const { result } = renderHook(() => useNumberFormatting())
    const original = result.current.fmtNumber
    expect(original(12.3456)).toBe('12.35')

    act(() => setGlobalPrecision(3))
    expect(result.current.fmtNumber(12.3456)).toBe('12.346')
    expect(result.current.fmtPercent(12.3456)).toBe('12.346%')
    expect(result.current.fmtWithUnit(12.3456, 'kW')).toBe('12.346 kW')
    expect(result.current.fmtNumber).not.toBe(original)
    expect(result.current.fmtInt(1234)).toBe('1,234')

    act(() => setGlobalPrecision(0))
    expect(result.current.fmtNumber(12.3456)).toBe('12')
    expect(result.current.fmtInt(1234)).toBe('1,234')
  })

  it('updates locale and keeps callback identities stable when preferences are unchanged', () => {
    const { result, rerender } = renderHook(() => useNumberFormatting())
    const original = result.current
    rerender()
    expect(result.current).toBe(original)

    act(() => setGlobalPrecision(2))
    expect(result.current).toBe(original)
    act(() => setGlobalLocale('de-DE'))
    expect(result.current.fmtNumber(1234.56)).toBe('1.234,56')
    expect(result.current.fmtInt(1234)).toBe('1.234')
  })

  it('preserves diagnostic resolution while honoring higher selected precision', () => {
    const { result } = renderHook(() => useNumberFormatting())
    expect(result.current.fmtScientificNumber(3.91234, 3)).toBe('3.912')
    expect(result.current.fmtScientificNumber(null, 3)).toBe('—')
    expect(result.current.fmtScientificNumber(0, 3)).toBe('0.000')
    act(() => setGlobalPrecision(4))
    expect(result.current.fmtScientificNumber(3.91234, 3)).toBe('3.9123')
    act(() => setGlobalPrecision(0))
    expect(result.current.fmtScientificNumber(3.91234, 3)).toBe('3.912')
  })

  it('uses selected precision for scaled byte measurements but not integer bytes', () => {
    const { result } = renderHook(() => useNumberFormatting())
    expect(result.current.formatBytes(1280)).toBe('1.25 KB')
    expect(result.current.formatBytes(12)).toBe('12 B')
    act(() => setGlobalPrecision(1))
    expect(result.current.formatBytes(1280)).toBe('1.3 KB')
    expect(result.current.formatBytes(null)).toBe('—')
    expect(result.current.formatBytes(0)).toBe('0 B')
  })

  it('updates mounted, memoized duration readings without changing clock notation', () => {
    function DurationReadings() {
      const { formatDurationMs, formatDurationMsCompact, formatDurationMsLong } = useNumberFormatting()
      const measured = useMemo(() => [
        formatDurationMs(250.125),
        formatDurationMsCompact(123_000),
        formatDurationMsLong(1534.56),
      ].join(' / '), [formatDurationMs, formatDurationMsCompact, formatDurationMsLong])
      return <output>{measured} / {formatDurationClock(65_000)}</output>
    }

    render(<DurationReadings />)
    expect(screen.getByRole('status')).toHaveTextContent('250.13ms / 2.05m / 1.53s / 1:05')
    act(() => setGlobalPrecision(0))
    expect(screen.getByRole('status')).toHaveTextContent('250ms / 2m / 2s / 1:05')
    act(() => {
      setGlobalPrecision(3)
      setGlobalLocale('de-DE')
    })
    expect(screen.getByRole('status')).toHaveTextContent('250,125ms / 2,050m / 1,535s / 1:05')
  })
})
