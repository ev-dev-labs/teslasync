import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFormDraft } from '../useFormDraft'

interface SampleForm {
  name: string
  count: number
}

const sampleInitial: SampleForm = { name: '', count: 0 }
const sampleEdited: SampleForm = { name: 'partial', count: 7 }

function storageKey(version: number, key: string): string {
  return `teslasync:draft:v${version}:${key}`
}

describe('useFormDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('mounts with no stored draft → hasDraft=false, value=initial', () => {
    const { result } = renderHook(() => useFormDraft<SampleForm>('tc-empty', sampleInitial))
    expect(result.current.hasDraft).toBe(false)
    expect(result.current.draftSavedAt).toBeNull()
    expect(result.current.value).toEqual(sampleInitial)
    expect(localStorage.getItem(storageKey(1, 'tc-empty'))).toBeNull()
  })

  it('persists to localStorage after the debounce window on setValue', () => {
    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-persist', sampleInitial, { debounceMs: 800 }),
    )

    act(() => {
      result.current.setValue(sampleEdited)
    })

    // Before debounce fires, no write yet.
    expect(localStorage.getItem(storageKey(1, 'tc-persist'))).toBeNull()

    act(() => {
      vi.advanceTimersByTime(800)
    })

    const raw = localStorage.getItem(storageKey(1, 'tc-persist'))
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.version).toBe(1)
    expect(typeof parsed.savedAt).toBe('number')
    expect(parsed.value).toEqual(sampleEdited)
  })

  it('debounces multiple updates into a single write', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-debounce', sampleInitial, { debounceMs: 1000 }),
    )

    act(() => {
      result.current.setValue({ name: 'a', count: 1 })
      result.current.setValue({ name: 'ab', count: 2 })
      result.current.setValue({ name: 'abc', count: 3 })
    })

    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(setItemSpy).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(setItemSpy).toHaveBeenCalledTimes(1)
    const written = JSON.parse(localStorage.getItem(storageKey(1, 'tc-debounce'))!)
    expect(written.value).toEqual({ name: 'abc', count: 3 })

    setItemSpy.mockRestore()
  })

  it('does not persist initial values on mount (no setValue → no write)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    renderHook(() => useFormDraft<SampleForm>('tc-mount', sampleInitial, { debounceMs: 100 }))

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(setItemSpy).not.toHaveBeenCalled()
    setItemSpy.mockRestore()
  })

  it('honors skipPersist predicate', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-skip', sampleInitial, {
        debounceMs: 100,
        skipPersist: v => v.name === 'skip-me',
      }),
    )

    act(() => {
      result.current.setValue({ name: 'skip-me', count: 1 })
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(setItemSpy).not.toHaveBeenCalled()

    act(() => {
      result.current.setValue({ name: 'persist-me', count: 2 })
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(setItemSpy).toHaveBeenCalledTimes(1)

    setItemSpy.mockRestore()
  })

  it('hydrates a previously saved draft on remount', () => {
    const envelope = { version: 1, savedAt: Date.now(), value: sampleEdited }
    localStorage.setItem(storageKey(1, 'tc-rehydrate'), JSON.stringify(envelope))

    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-rehydrate', sampleInitial),
    )

    expect(result.current.hasDraft).toBe(true)
    expect(result.current.draftSavedAt).toBeInstanceOf(Date)
    expect(result.current.value).toEqual(sampleEdited)
  })

  it('discardDraft removes storage entry and resets to initial', () => {
    const envelope = { version: 1, savedAt: Date.now(), value: sampleEdited }
    localStorage.setItem(storageKey(1, 'tc-discard'), JSON.stringify(envelope))

    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-discard', sampleInitial),
    )
    expect(result.current.value).toEqual(sampleEdited)

    act(() => {
      result.current.discardDraft()
    })

    expect(result.current.hasDraft).toBe(false)
    expect(result.current.draftSavedAt).toBeNull()
    expect(result.current.value).toEqual(sampleInitial)
    expect(localStorage.getItem(storageKey(1, 'tc-discard'))).toBeNull()
  })

  it('bumping version invalidates older drafts (different storage key)', () => {
    const envelope = { version: 1, savedAt: Date.now(), value: sampleEdited }
    localStorage.setItem(storageKey(1, 'tc-version'), JSON.stringify(envelope))

    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-version', sampleInitial, { version: 2 }),
    )

    // Draft was for v1; current hook is v2 → ignore old draft.
    expect(result.current.hasDraft).toBe(false)
    expect(result.current.value).toEqual(sampleInitial)
  })

  it('treats expired drafts as missing and removes them on read', () => {
    const oldEnvelope = {
      version: 1,
      savedAt: Date.now() - 60_000, // 1 minute ago
      value: sampleEdited,
    }
    localStorage.setItem(storageKey(1, 'tc-expire'), JSON.stringify(oldEnvelope))

    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-expire', sampleInitial, { maxAgeMs: 1000 }),
    )

    expect(result.current.hasDraft).toBe(false)
    expect(result.current.value).toEqual(sampleInitial)
    expect(localStorage.getItem(storageKey(1, 'tc-expire'))).toBeNull()
  })

  it('survives a localStorage write failure (quota exceeded)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-quota', sampleInitial, { debounceMs: 100 }),
    )

    act(() => {
      result.current.setValue(sampleEdited)
    })

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(100)
      })
    }).not.toThrow()

    // Hook still functions in memory: value reflects the setValue call.
    expect(result.current.value).toEqual(sampleEdited)

    setItemSpy.mockRestore()
  })

  it('flush() persists synchronously and cancels the pending debounce', () => {
    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-flush', sampleInitial, { debounceMs: 5000 }),
    )

    act(() => {
      result.current.setValue(sampleEdited)
    })

    expect(localStorage.getItem(storageKey(1, 'tc-flush'))).toBeNull()

    act(() => {
      result.current.flush()
    })

    const raw = localStorage.getItem(storageKey(1, 'tc-flush'))
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).value).toEqual(sampleEdited)
  })

  it('rehydrates when the key changes mid-mount', () => {
    const envelope = { version: 1, savedAt: Date.now(), value: { name: 'fromB', count: 5 } }
    localStorage.setItem(storageKey(1, 'tc-key-b'), JSON.stringify(envelope))

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useFormDraft<SampleForm>(key, sampleInitial),
      { initialProps: { key: 'tc-key-a' } },
    )

    expect(result.current.hasDraft).toBe(false)
    expect(result.current.value).toEqual(sampleInitial)

    rerender({ key: 'tc-key-b' })

    expect(result.current.hasDraft).toBe(true)
    expect(result.current.value).toEqual({ name: 'fromB', count: 5 })
  })

  it('cleans up corrupt JSON entries on read', () => {
    localStorage.setItem(storageKey(1, 'tc-corrupt'), '{not valid json')

    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-corrupt', sampleInitial),
    )

    expect(result.current.hasDraft).toBe(false)
    expect(result.current.value).toEqual(sampleInitial)
    expect(localStorage.getItem(storageKey(1, 'tc-corrupt'))).toBeNull()
  })

  it('persists immediately when debounceMs is 0', () => {
    const { result } = renderHook(() =>
      useFormDraft<SampleForm>('tc-sync', sampleInitial, { debounceMs: 0 }),
    )

    act(() => {
      result.current.setValue(sampleEdited)
    })

    const raw = localStorage.getItem(storageKey(1, 'tc-sync'))
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).value).toEqual(sampleEdited)
  })
})
