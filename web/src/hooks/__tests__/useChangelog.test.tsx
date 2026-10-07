import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  compareVersions,
  openChangelogModal,
  OPEN_CHANGELOG_MODAL_EVENT,
  SEEN_VERSION_KEY,
  LAST_SHOWN_KEY,
  useChangelog,
} from '../useChangelog'
import { CHANGELOG, LATEST_VERSION } from '@/generated/changelog'

describe('compareVersions', () => {
  it('returns 0 when versions are identical', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('returns -1 when a < b across each component', () => {
    expect(compareVersions('1.2.3', '2.0.0')).toBe(-1)
    expect(compareVersions('1.2.3', '1.3.0')).toBe(-1)
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1)
  })

  it('returns 1 when a > b', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
    expect(compareVersions('1.10.0', '1.9.99')).toBe(1)
  })

  it('treats pre-release tags as lower than release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
  })

  it('orders pre-release tags lexicographically when cores match', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1)
  })

  it('falls back to lexicographic compare when format is unparseable', () => {
    expect(compareVersions('foo', 'bar')).toBe(1)
    expect(compareVersions('a', 'a')).toBe(0)
  })
})

describe('useChangelog', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('reports unseen on first visit (no seenVersion stored)', () => {
    const { result } = renderHook(() => useChangelog())
    expect(result.current.seenVersion).toBeNull()
    expect(result.current.hasUnseen).toBe(true)
    expect(result.current.newEntries.length).toBe(CHANGELOG.length)
    expect(result.current.canAutoShow).toBe(true)
  })

  it('reports no-unseen when seenVersion equals latest', () => {
    localStorage.setItem(SEEN_VERSION_KEY, LATEST_VERSION)
    const { result } = renderHook(() => useChangelog())
    expect(result.current.seenVersion).toBe(LATEST_VERSION)
    expect(result.current.hasUnseen).toBe(false)
    expect(result.current.newEntries.length).toBe(0)
    expect(result.current.canAutoShow).toBe(false)
  })

  it('reports newEntries as the suffix above seenVersion', () => {
    if (CHANGELOG.length < 2) return
    const olderVersion = CHANGELOG[1].version
    localStorage.setItem(SEEN_VERSION_KEY, olderVersion)
    const { result } = renderHook(() => useChangelog())
    expect(result.current.hasUnseen).toBe(true)
    // Only entries strictly above `olderVersion` should be returned.
    expect(result.current.newEntries.length).toBeGreaterThan(0)
    for (const entry of result.current.newEntries) {
      expect(compareVersions(entry.version, olderVersion)).toBe(1)
    }
  })

  it('markSeen() writes the latest version + a shown timestamp', () => {
    const { result } = renderHook(() => useChangelog())
    act(() => {
      result.current.markSeen()
    })
    expect(localStorage.getItem(SEEN_VERSION_KEY)).toBe(LATEST_VERSION)
    expect(localStorage.getItem(LAST_SHOWN_KEY)).not.toBeNull()
    expect(result.current.hasUnseen).toBe(false)
  })

  it('canAutoShow honours the 24h throttle even when unseen entries exist', () => {
    // Stamp a recent shown timestamp without writing seenVersion → still
    // unseen, but throttled.
    localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()))
    const { result } = renderHook(() => useChangelog())
    expect(result.current.hasUnseen).toBe(true)
    expect(result.current.canAutoShow).toBe(false)
  })

  it('canAutoShow flips back to true once 24h has elapsed', () => {
    localStorage.setItem(LAST_SHOWN_KEY, String(Date.now() - 25 * 60 * 60 * 1000))
    const { result } = renderHook(() => useChangelog())
    expect(result.current.canAutoShow).toBe(true)
  })

  it('exposes the immutable generated CHANGELOG list', () => {
    const { result } = renderHook(() => useChangelog())
    expect(result.current.entries).toBe(CHANGELOG)
    expect(result.current.latestVersion).toBe(LATEST_VERSION)
  })
})

describe('openChangelogModal', () => {
  it('dispatches OPEN_CHANGELOG_MODAL_EVENT on the window', () => {
    let fired = false
    const handler = () => {
      fired = true
    }
    window.addEventListener(OPEN_CHANGELOG_MODAL_EVENT, handler)
    try {
      openChangelogModal()
    } finally {
      window.removeEventListener(OPEN_CHANGELOG_MODAL_EVENT, handler)
    }
    expect(fired).toBe(true)
  })
})
