import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChartLegendState } from './useChartLegendState'

const KEY_PREFIX = 'teslasync.chart.'
const KEY_SUFFIX = '.hidden'

describe('useChartLegendState', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('starts with an empty hidden set when localStorage is empty', () => {
    const { result } = renderHook(() => useChartLegendState('test.empty'))
    expect(result.current.hidden.size).toBe(0)
    expect(result.current.isHidden('any')).toBe(false)
  })

  it('toggle adds a key to hidden set and persists to localStorage', () => {
    const { result } = renderHook(() => useChartLegendState('test.toggle'))
    act(() => {
      result.current.toggle('series-a')
    })
    expect(result.current.isHidden('series-a')).toBe(true)
    expect(result.current.hidden.has('series-a')).toBe(true)
    const stored = window.localStorage.getItem(`${KEY_PREFIX}test.toggle${KEY_SUFFIX}`)
    expect(stored).toBeTruthy()
    expect(JSON.parse(stored!)).toEqual(['series-a'])
  })

  it('toggle removes a previously hidden key', () => {
    const { result } = renderHook(() => useChartLegendState('test.untoggle'))
    act(() => {
      result.current.toggle('series-a')
    })
    expect(result.current.isHidden('series-a')).toBe(true)
    act(() => {
      result.current.toggle('series-a')
    })
    expect(result.current.isHidden('series-a')).toBe(false)
  })

  it('rehydrates hidden set from localStorage on mount', () => {
    window.localStorage.setItem(
      `${KEY_PREFIX}test.persist${KEY_SUFFIX}`,
      JSON.stringify(['speed', 'power']),
    )
    const { result } = renderHook(() => useChartLegendState('test.persist'))
    expect(result.current.isHidden('speed')).toBe(true)
    expect(result.current.isHidden('power')).toBe(true)
    expect(result.current.isHidden('battery')).toBe(false)
  })

  it('setHidden(key, true/false) sets visibility explicitly', () => {
    const { result } = renderHook(() => useChartLegendState('test.set'))
    act(() => {
      result.current.setHidden('a', true)
    })
    expect(result.current.isHidden('a')).toBe(true)
    act(() => {
      result.current.setHidden('a', false)
    })
    expect(result.current.isHidden('a')).toBe(false)
  })

  it('reset clears the hidden set', () => {
    const { result } = renderHook(() => useChartLegendState('test.reset'))
    act(() => {
      result.current.toggle('a')
      result.current.toggle('b')
    })
    expect(result.current.hidden.size).toBeGreaterThanOrEqual(1)
    act(() => {
      result.current.reset()
    })
    expect(result.current.hidden.size).toBe(0)
  })

  it('isolates state between different chartIds', () => {
    const a = renderHook(() => useChartLegendState('chart.a'))
    const b = renderHook(() => useChartLegendState('chart.b'))
    act(() => {
      a.result.current.toggle('series')
    })
    expect(a.result.current.isHidden('series')).toBe(true)
    expect(b.result.current.isHidden('series')).toBe(false)
  })

  it('survives malformed localStorage values without crashing', () => {
    window.localStorage.setItem(`${KEY_PREFIX}test.bad${KEY_SUFFIX}`, 'not json')
    const { result } = renderHook(() => useChartLegendState('test.bad'))
    expect(result.current.hidden.size).toBe(0)
  })

  it('ignores non-string entries in stored array', () => {
    window.localStorage.setItem(
      `${KEY_PREFIX}test.mixed${KEY_SUFFIX}`,
      JSON.stringify(['valid', 42, null, { x: 1 }, 'also-valid']),
    )
    const { result } = renderHook(() => useChartLegendState('test.mixed'))
    expect(result.current.hidden.has('valid')).toBe(true)
    expect(result.current.hidden.has('also-valid')).toBe(true)
    expect(result.current.hidden.size).toBe(2)
  })
})
