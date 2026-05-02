import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import '@/i18n'
import { useDirtyForm } from '../useDirtyForm'

describe('useDirtyForm', () => {
  let addSpy: ReturnType<typeof vi.spyOn>
  let removeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    addSpy = vi.spyOn(window, 'addEventListener')
    removeSpy = vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('returns localized strings', () => {
    const { result } = renderHook(() => useDirtyForm(false))
    expect(result.current.isDirty).toBe(false)
    expect(result.current.title).toBe('Unsaved changes')
    expect(result.current.message).toBe('You have unsaved changes. Discard them?')
    expect(result.current.discardLabel).toBe('Discard changes')
    expect(result.current.keepEditingLabel).toBe('Keep editing')
  })

  it('does NOT register beforeunload when clean', () => {
    renderHook(() => useDirtyForm(false))
    const beforeUnloadAdds = addSpy.mock.calls.filter(([type]) => type === 'beforeunload')
    expect(beforeUnloadAdds).toHaveLength(0)
  })

  it('registers beforeunload when dirty', () => {
    renderHook(() => useDirtyForm(true))
    const beforeUnloadAdds = addSpy.mock.calls.filter(([type]) => type === 'beforeunload')
    expect(beforeUnloadAdds).toHaveLength(1)
  })

  it('removes the beforeunload listener when dirty flips back to false', () => {
    const { rerender } = renderHook(({ dirty }: { dirty: boolean }) => useDirtyForm(dirty), {
      initialProps: { dirty: true },
    })
    expect(addSpy.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1)

    rerender({ dirty: false })

    const beforeUnloadRemoves = removeSpy.mock.calls.filter(([type]) => type === 'beforeunload')
    expect(beforeUnloadRemoves).toHaveLength(1)
  })

  it('removes the beforeunload listener on unmount', () => {
    const { unmount } = renderHook(() => useDirtyForm(true))
    unmount()
    const beforeUnloadRemoves = removeSpy.mock.calls.filter(([type]) => type === 'beforeunload')
    expect(beforeUnloadRemoves).toHaveLength(1)
  })

  it('handler calls preventDefault and sets returnValue (legacy browser prompt)', () => {
    renderHook(() => useDirtyForm(true))
    const beforeUnloadAdds = addSpy.mock.calls.filter(([type]) => type === 'beforeunload')
    const handler = beforeUnloadAdds[0][1] as EventListener

    const event = {
      preventDefault: vi.fn(),
      returnValue: 'unset',
    } as unknown as BeforeUnloadEvent

    act(() => {
      handler(event)
    })

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.returnValue).toBe('')
  })
})
