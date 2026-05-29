import { useCallback, useEffect, useState } from 'react'
import { sseManager } from '@/lib/sseManager'
import type { LifetimeAchievement } from './useAnalytics'

/**
 * `achievement_unlocked` SSE payload shape, mirroring the Go
 * `achievementUnlockedEvent` struct in internal/api/lifetime_handler.go.
 *
 * camelCaseKeys is a no-op here because we subscribe to the raw SSE stream
 * (not via resilientFetch) — the keys arrive snake_case.
 */
export interface AchievementUnlockedEvent {
  vehicle_id: number
  unlocked_at: string
  achievement: LifetimeAchievement
}

/**
 * useAchievementUnlocks — subscribes to the realtime `achievement_unlocked`
 * SSE stream and exposes an in-memory queue of unlocks received during the
 * current browser session.
 *
 * The list:
 * is newest-first
 * is bounded (MAX_RECENT) to avoid runaway memory if the backend ever fires
 *   a burst (e.g. seed data on first run)
 * de-dupes by `achievement.id` so a re-broadcast (rare but possible if
 *   multiple SSE pods receive the Redis Pub/Sub fan-out) does not double-fire
 *   the celebration toast
 * is purely transient — refreshing the page clears the list. Persistent
 *   surfacing is the dashboard widget, which queries the canonical
 *   `unlocked_at` from the lifetime stats response.
 *
 * Consumers (`AchievementUnlockListener`) should `dismiss(id)` an entry once
 * the toast for it has been shown, so re-renders don't re-show toasts for
 * already-acknowledged unlocks.
 */
const MAX_RECENT = 25

export function useAchievementUnlocks(): {
  recent: AchievementUnlockedEvent[]
  dismiss: (achievementId: string) => void
} {
  const [recent, setRecent] = useState<AchievementUnlockedEvent[]>([])

  useEffect(() => {
    const onUnlock = (data: unknown) => {
      const payload = data as AchievementUnlockedEvent | null | undefined
      if (!payload || !payload.achievement || !payload.achievement.id) return
      setRecent(prev => {
        // De-dup: if we've already queued this id, ignore the new event
        // rather than pushing a duplicate.
        if (prev.some(e => e.achievement.id === payload.achievement.id)) return prev
        const next = [payload, ...prev]
        if (next.length > MAX_RECENT) next.length = MAX_RECENT
        return next
      })
    }

    sseManager.subscribe('achievement_unlocked', onUnlock)
    return () => {
      sseManager.unsubscribe('achievement_unlocked', onUnlock)
    }
  }, [])

  const dismiss = useCallback((achievementId: string) => {
    setRecent(prev => prev.filter(e => e.achievement.id !== achievementId))
  }, [])

  return { recent, dismiss }
}
