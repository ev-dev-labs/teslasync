import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useAutosave,
  loadAutosave,
  loadAutosaveEnvelope,
  clearAutosave,
} from '../useAutosave'

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('writes the draft to localStorage after the debounce window', () => {
    const data = { name: 'partial', count: 1 }
    renderHook(() => useAutosave({ key: 'tc1', data, debounceMs: 1500 }))

    expect(localStorage.getItem('teslasync.draft.tc1')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(1500)
    })

    const stored = localStorage.getItem('teslasync.draft.tc1')
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!)
    expect(parsed.version).toBe(1)
    expect(typeof parsed.savedAt).toBe('number')
    expect(parsed.data).toEqual(data)
  })

  it('debounces multiple updates into a single write', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const { rerender } = renderHook(
      ({ data }: { data: { v: number } }) => useAutosave({ key: 'tc2', data, debounceMs: 1000 }),
      { initialProps: { data: { v: 1 } } },
    )

    rerender({ data: { v: 2 } })
    rerender({ data: { v: 3 } })
    rerender({ data: { v: 4 } })

    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(setItemSpy).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(setItemSpy).toHaveBeenCalledTimes(1)
    const written = JSON.parse(localStorage.getItem('teslasync.draft.tc2')!)
    expect(written.data).toEqual({ v: 4 })

    setItemSpy.mockRestore()
  })

  it('does not write when paused', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    renderHook(() =>
      useAutosave({ key: 'tc3', data: { name: 'hi' }, debounceMs: 500, paused: true }),
    )

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(setItemSpy).not.toHaveBeenCalled()
    setItemSpy.mockRestore()
  })

  it('cancels the pending write on unmount', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const { unmount } = renderHook(() =>
      useAutosave({ key: 'tc4', data: { v: 1 }, debounceMs: 1000 }),
    )

    unmount()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(setItemSpy).not.toHaveBeenCalled()
    setItemSpy.mockRestore()
  })

  it('survives a localStorage write failure', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    renderHook(() => useAutosave({ key: 'tc5', data: { v: 1 }, debounceMs: 100 }))

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(100)
      })
    }).not.toThrow()

    setItemSpy.mockRestore()
  })
})

describe('loadAutosave', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when no draft is stored', () => {
    expect(loadAutosave('missing')).toBeNull()
  })

  it('returns the data payload when versions match', () => {
    const envelope = { version: 1, savedAt: Date.now(), data: { foo: 'bar' } }
    localStorage.setItem('teslasync.draft.tc6', JSON.stringify(envelope))
    expect(loadAutosave('tc6')).toEqual({ foo: 'bar' })
  })

  it('returns null when the version does not match', () => {
    const envelope = { version: 1, savedAt: Date.now(), data: { foo: 'bar' } }
    localStorage.setItem('teslasync.draft.tc7', JSON.stringify(envelope))
    expect(loadAutosave('tc7', 2)).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    localStorage.setItem('teslasync.draft.tc8', '{not json')
    expect(loadAutosave('tc8')).toBeNull()
  })

  it('returns null when the envelope is missing required fields', () => {
    localStorage.setItem('teslasync.draft.tc9', JSON.stringify({ data: { foo: 'bar' } }))
    expect(loadAutosave('tc9')).toBeNull()
  })
})

describe('loadAutosaveEnvelope', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the savedAt timestamp alongside the data', () => {
    const savedAt = Date.now()
    localStorage.setItem(
      'teslasync.draft.tc10',
      JSON.stringify({ version: 1, savedAt, data: { v: 9 } }),
    )
    const envelope = loadAutosaveEnvelope<{ v: number }>('tc10')
    expect(envelope).toEqual({ version: 1, savedAt, data: { v: 9 } })
  })
})

describe('clearAutosave', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('removes the stored draft', () => {
    localStorage.setItem(
      'teslasync.draft.tc11',
      JSON.stringify({ version: 1, savedAt: Date.now(), data: {} }),
    )
    clearAutosave('tc11')
    expect(localStorage.getItem('teslasync.draft.tc11')).toBeNull()
  })

  it('is a no-op when no draft exists', () => {
    expect(() => clearAutosave('never-saved')).not.toThrow()
  })
})
