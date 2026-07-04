/**
 * useAchievementUnlocks unit tests.
 *
 * Covers every runtime export of the module:
 *   - isAchievementUnlockedEvent — the runtime type-guard that rejects
 *     malformed / partial SSE frames.
 *   - MAX_RECENT               — the queue cap contract.
 *   - useAchievementUnlocks    — subscribe/unsubscribe lifecycle, newest-first
 *     queueing, id de-duplication, bounded overflow, malformed-frame rejection,
 *     dismissal, and stable-callback identity.
 *
 * The SSE transport is mocked at the module boundary (`@/lib/sseManager`) so
 * no real EventSource / network is opened; the mock records subscribers so the
 * tests can synchronously fire `achievement_unlocked` frames.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import type { LifetimeAchievement } from './useAnalytics'

// --- Mock sseManager --------------------------------------------------------
type Listener = (data: unknown) => void
const sseListeners = new Map<string, Set<Listener>>()

vi.mock('@/lib/sseManager', () => ({
  sseManager: {
    subscribe: (event: string, listener: Listener) => {
      if (!sseListeners.has(event)) sseListeners.set(event, new Set())
      sseListeners.get(event)!.add(listener)
    },
    unsubscribe: (event: string, listener: Listener) => {
      sseListeners.get(event)?.delete(listener)
    },
  },
}))

import {
  MAX_RECENT,
  isAchievementUnlockedEvent,
  useAchievementUnlocks,
  type AchievementUnlockedEvent,
} from './useAchievementUnlocks'

const CHANNEL = 'achievement_unlocked'

function makeAchievement(id: string): LifetimeAchievement {
  return {
    id,
    name: `Achievement ${id}`,
    description: `Description for ${id}`,
    icon: 'trophy',
    unlocked: true,
    unlocked_at: '2026-07-04T00:00:00Z',
    progress: 100,
    target: 100,
    current: 100,
  }
}

function makeEvent(
  id: string,
  overrides: Partial<AchievementUnlockedEvent> = {},
): AchievementUnlockedEvent {
  return {
    vehicle_id: 42,
    unlocked_at: '2026-07-04T00:00:00Z',
    achievement: makeAchievement(id),
    ...overrides,
  }
}

/** Dispatch a raw frame to every subscriber on the achievement channel. */
function fireUnlock(data: unknown) {
  const subs = sseListeners.get(CHANNEL)
  if (!subs) return
  for (const fn of subs) fn(data)
}

beforeEach(() => {
  sseListeners.clear()
})

describe('isAchievementUnlockedEvent', () => {
  it('accepts a well-formed frame with a non-empty string id', () => {
    expect(isAchievementUnlockedEvent(makeEvent('first-drive'))).toBe(true)
  })

  it('rejects null, undefined and non-object primitives', () => {
    expect(isAchievementUnlockedEvent(null)).toBe(false)
    expect(isAchievementUnlockedEvent(undefined)).toBe(false)
    expect(isAchievementUnlockedEvent('first-drive')).toBe(false)
    expect(isAchievementUnlockedEvent(7)).toBe(false)
    expect(isAchievementUnlockedEvent(true)).toBe(false)
  })

  it('rejects frames missing the achievement object', () => {
    expect(isAchievementUnlockedEvent({})).toBe(false)
    expect(isAchievementUnlockedEvent({ achievement: null })).toBe(false)
    expect(isAchievementUnlockedEvent({ achievement: 'nope' })).toBe(false)
  })

  it('rejects an achievement with a missing, blank, or non-string id', () => {
    expect(isAchievementUnlockedEvent({ achievement: {} })).toBe(false)
    expect(isAchievementUnlockedEvent({ achievement: { id: '' } })).toBe(false)
    expect(isAchievementUnlockedEvent({ achievement: { id: 5 } })).toBe(false)
    expect(isAchievementUnlockedEvent({ achievement: { id: null } })).toBe(false)
  })
})

describe('MAX_RECENT', () => {
  it('exposes a positive, finite queue cap', () => {
    expect(MAX_RECENT).toBe(25)
    expect(Number.isInteger(MAX_RECENT)).toBe(true)
    expect(MAX_RECENT).toBeGreaterThan(0)
  })
})

describe('useAchievementUnlocks', () => {
  it('subscribes to the achievement_unlocked channel on mount and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useAchievementUnlocks())
    expect(sseListeners.get(CHANNEL)?.size).toBe(1)

    unmount()
    expect(sseListeners.get(CHANNEL)?.size ?? 0).toBe(0)
  })

  it('starts with an empty queue and a stable dismiss callback', () => {
    const { result } = renderHook(() => useAchievementUnlocks())
    expect(result.current.recent).toEqual([])
    expect(typeof result.current.dismiss).toBe('function')
  })

  it('queues an inbound unlock and preserves its payload fields', () => {
    const { result } = renderHook(() => useAchievementUnlocks())

    act(() => {
      fireUnlock(makeEvent('road-warrior', { vehicle_id: 7, unlocked_at: '2026-01-01T12:00:00Z' }))
    })

    expect(result.current.recent).toHaveLength(1)
    expect(result.current.recent[0].achievement.id).toBe('road-warrior')
    expect(result.current.recent[0].vehicle_id).toBe(7)
    expect(result.current.recent[0].unlocked_at).toBe('2026-01-01T12:00:00Z')
  })

  it('orders the queue newest-first across multiple distinct unlocks', () => {
    const { result } = renderHook(() => useAchievementUnlocks())

    act(() => {
      fireUnlock(makeEvent('alpha'))
    })
    act(() => {
      fireUnlock(makeEvent('beta'))
    })

    expect(result.current.recent).toHaveLength(2)
    expect(result.current.recent[0].achievement.id).toBe('beta')
    expect(result.current.recent[1].achievement.id).toBe('alpha')
  })

  it('de-duplicates a re-broadcast of the same achievement id', () => {
    const { result } = renderHook(() => useAchievementUnlocks())

    act(() => {
      fireUnlock(makeEvent('century-club'))
    })
    act(() => {
      // Same id re-delivered (e.g. Redis Pub/Sub fan-out across SSE pods).
      fireUnlock(makeEvent('century-club', { vehicle_id: 99 }))
    })

    expect(result.current.recent).toHaveLength(1)
    // The first-seen frame is retained, not the duplicate.
    expect(result.current.recent[0].vehicle_id).toBe(42)
  })

  it('ignores malformed frames without mutating the queue', () => {
    const { result } = renderHook(() => useAchievementUnlocks())

    act(() => {
      fireUnlock(null)
      fireUnlock(undefined)
      fireUnlock({})
      fireUnlock({ achievement: null })
      fireUnlock({ achievement: {} })
      fireUnlock({ achievement: { id: '' } })
    })

    expect(result.current.recent).toEqual([])
  })

  it('bounds the queue to MAX_RECENT, dropping the oldest overflow', () => {
    const { result } = renderHook(() => useAchievementUnlocks())

    const total = MAX_RECENT + 5
    act(() => {
      for (let i = 0; i < total; i++) {
        fireUnlock(makeEvent(`ach-${i}`))
      }
    })

    expect(result.current.recent).toHaveLength(MAX_RECENT)
    // Newest fired sits at the head; oldest survivor is total-MAX_RECENT.
    expect(result.current.recent[0].achievement.id).toBe(`ach-${total - 1}`)
    expect(result.current.recent[MAX_RECENT - 1].achievement.id).toBe(`ach-${total - MAX_RECENT}`)
    // The very first frames were evicted.
    expect(result.current.recent.some(e => e.achievement.id === 'ach-0')).toBe(false)
  })

  it('dismiss(id) removes only the matching entry', () => {
    const { result } = renderHook(() => useAchievementUnlocks())

    act(() => {
      fireUnlock(makeEvent('keep-me'))
      fireUnlock(makeEvent('remove-me'))
    })
    expect(result.current.recent).toHaveLength(2)

    act(() => {
      result.current.dismiss('remove-me')
    })

    expect(result.current.recent).toHaveLength(1)
    expect(result.current.recent[0].achievement.id).toBe('keep-me')
  })

  it('dismiss with an unknown id is a no-op', () => {
    const { result } = renderHook(() => useAchievementUnlocks())

    act(() => {
      fireUnlock(makeEvent('solo'))
    })
    act(() => {
      result.current.dismiss('does-not-exist')
    })

    expect(result.current.recent).toHaveLength(1)
    expect(result.current.recent[0].achievement.id).toBe('solo')
  })

  it('keeps a referentially stable dismiss callback across re-renders', () => {
    const { result } = renderHook(() => useAchievementUnlocks())
    const firstDismiss = result.current.dismiss

    act(() => {
      fireUnlock(makeEvent('trigger-rerender'))
    })

    expect(result.current.recent).toHaveLength(1)
    expect(result.current.dismiss).toBe(firstDismiss)
  })
})
