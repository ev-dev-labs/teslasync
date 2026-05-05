import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AS_OF_QUERY_PARAM, useAsOfDate } from '../useAsOfDate'

function wrapperWith(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  )
}

describe('useAsOfDate', () => {
  it('returns null when the URL has no as_of param', () => {
    const { result } = renderHook(() => useAsOfDate(), {
      wrapper: wrapperWith('/page'),
    })
    expect(result.current.asOf).toBeNull()
  })

  it('exposes the canonical query parameter name', () => {
    expect(AS_OF_QUERY_PARAM).toBe('as_of')
  })

  it('returns a valid RFC 3339 timestamp from the URL', () => {
    const { result } = renderHook(() => useAsOfDate(), {
      wrapper: wrapperWith('/page?as_of=2024-11-12T14%3A30%3A00Z'),
    })
    expect(result.current.asOf).toBe('2024-11-12T14:30:00Z')
  })

  it('drops malformed timestamps and returns null', () => {
    const { result } = renderHook(() => useAsOfDate(), {
      wrapper: wrapperWith('/page?as_of=garbage'),
    })
    expect(result.current.asOf).toBeNull()
  })

  it('passes through well-formed timestamps even when the calendar overflows (Date.parse leniency)', () => {
    // JavaScript Date.parse normalizes "2024-02-31T00:00:00Z" to
    // 2024-03-02 instead of returning NaN, so the hook surfaces the
    // raw string verbatim. Validation against impossible calendar
    // values is the picker's job, not the URL parser's.
    const { result } = renderHook(() => useAsOfDate(), {
      wrapper: wrapperWith('/page?as_of=2024-02-31T00%3A00%3A00Z'),
    })
    expect(result.current.asOf).toBe('2024-02-31T00:00:00Z')
  })

  it('writes a valid timestamp via setAsOf', () => {
    const { result } = renderHook(() => useAsOfDate(), {
      wrapper: wrapperWith('/page'),
    })
    act(() => result.current.setAsOf('2024-11-12T14:30:00Z'))
    expect(result.current.asOf).toBe('2024-11-12T14:30:00Z')
  })

  it('refuses to write a malformed timestamp', () => {
    const { result } = renderHook(() => useAsOfDate(), {
      wrapper: wrapperWith('/page'),
    })
    act(() => result.current.setAsOf('not-a-date'))
    expect(result.current.asOf).toBeNull()
  })

  it('clears the param when setAsOf(null) is called', () => {
    const { result } = renderHook(() => useAsOfDate(), {
      wrapper: wrapperWith('/page?as_of=2024-11-12T14%3A30%3A00Z'),
    })
    expect(result.current.asOf).toBe('2024-11-12T14:30:00Z')
    act(() => result.current.setAsOf(null))
    expect(result.current.asOf).toBeNull()
  })

  it('clears the param when clear() is called', () => {
    const { result } = renderHook(() => useAsOfDate(), {
      wrapper: wrapperWith('/page?as_of=2024-11-12T14%3A30%3A00Z'),
    })
    expect(result.current.asOf).toBe('2024-11-12T14:30:00Z')
    act(() => result.current.clear())
    expect(result.current.asOf).toBeNull()
  })

  it('accepts a UTC offset such as +05:30', () => {
    const { result } = renderHook(() => useAsOfDate(), {
      wrapper: wrapperWith('/page?as_of=2024-11-12T14%3A30%3A00%2B05%3A30'),
    })
    expect(result.current.asOf).toBe('2024-11-12T14:30:00+05:30')
  })
})
