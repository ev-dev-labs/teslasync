import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import { usePageTitle } from '../usePageTitle'
import {
  getBaseTitle,
  setBasePrefix,
  setFlashPrefix,
  __resetTitleStoreForTests,
} from '@/lib/titleStore'

// usePageTitle writes through the titleStore singleton (module-level
// state owning the single window <title>). We exercise the real store
// rather than mocking it — that composition IS the behaviour under test —
// and reset it to defaults around every case so the module-scoped
// baseTitle / basePrefix / flashPrefix never leak between tests.
describe('usePageTitle', () => {
  beforeEach(() => {
    __resetTitleStoreForTests()
  })

  afterEach(() => {
    __resetTitleStoreForTests()
  })

  it('sets the canonical title to "{title} — TeslaSync"', () => {
    renderHook(() => usePageTitle('Dashboard'))
    expect(getBaseTitle()).toBe('Dashboard — TeslaSync')
    expect(document.title).toBe('Dashboard — TeslaSync')
  })

  it('restores the previous base title when the host unmounts', () => {
    const { unmount } = renderHook(() => usePageTitle('Battery Health'))
    expect(document.title).toBe('Battery Health — TeslaSync')

    unmount()
    expect(getBaseTitle()).toBe('TeslaSync')
    expect(document.title).toBe('TeslaSync')
  })

  it('updates the title when the title prop changes', () => {
    const { rerender } = renderHook(({ title }) => usePageTitle(title), {
      initialProps: { title: 'Trips' },
    })
    expect(document.title).toBe('Trips — TeslaSync')

    rerender({ title: 'Drives' })
    expect(document.title).toBe('Drives — TeslaSync')
  })

  it('round-trips back to the app default after change-then-unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ title }) => usePageTitle(title),
      { initialProps: { title: 'First' } },
    )
    rerender({ title: 'Second' })
    expect(document.title).toBe('Second — TeslaSync')

    unmount()
    // The captured "previous" title threads through each effect cleanup,
    // so a full mount → change → unmount lifecycle returns to 'TeslaSync'
    // rather than leaving 'First — TeslaSync' stuck in the store.
    expect(document.title).toBe('TeslaSync')
  })

  it('preserves an unread-count badge prefix painted by another hook', () => {
    setBasePrefix('(3) ')
    renderHook(() => usePageTitle('Inbox'))
    // The badge prefix is owned by useTitleBadge; usePageTitle must not
    // clobber it when it writes the canonical title.
    expect(document.title).toBe('(3) Inbox — TeslaSync')
  })

  it('re-applies the badge prefix after the title changes', () => {
    setBasePrefix('(5) ')
    const { rerender } = renderHook(({ title }) => usePageTitle(title), {
      initialProps: { title: 'One' },
    })
    expect(document.title).toBe('(5) One — TeslaSync')

    rerender({ title: 'Two' })
    expect(document.title).toBe('(5) Two — TeslaSync')
  })

  it('lets a critical-alert flash prefix take priority over the badge', () => {
    setBasePrefix('(3) ')
    setFlashPrefix('(!) ALERT — ')
    renderHook(() => usePageTitle('Inbox'))
    expect(document.title).toBe('(!) ALERT — Inbox — TeslaSync')
  })

  it('collapses an empty title to the bare app name (no dangling separator)', () => {
    renderHook(() => usePageTitle(''))
    expect(getBaseTitle()).toBe('TeslaSync')
    expect(document.title).toBe('TeslaSync')
    expect(document.title).not.toContain(' — ')
  })

  it('collapses a whitespace-only title to the bare app name', () => {
    renderHook(() => usePageTitle('   '))
    expect(getBaseTitle()).toBe('TeslaSync')
    expect(document.title).toBe('TeslaSync')
  })

  it('trims surrounding whitespace from a real title', () => {
    renderHook(() => usePageTitle('  Charging Sessions  '))
    expect(document.title).toBe('Charging Sessions — TeslaSync')
  })

  it('treats a nullish title (untyped JS caller) as empty rather than crashing', () => {
    expect(() =>
      renderHook(() => usePageTitle(undefined as unknown as string)),
    ).not.toThrow()
    expect(getBaseTitle()).toBe('TeslaSync')
    expect(document.title).toBe('TeslaSync')
  })
})
