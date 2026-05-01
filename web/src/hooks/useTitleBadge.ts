import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { notificationKeys, useUnreadCount } from '@/api/hooks/useNotifications'
import { useSettings } from '@/hooks/useSettings'
import { sseManager } from '@/lib/sseManager'
import { setBasePrefix } from '@/lib/titleStore'

/**
 * Mirrors the unread-notification count into `document.title` as a
 * `"(N) "` prefix (capped at `"99+"`). Disappears when the count
 * reaches zero or when the user disables `tab_badge_enabled` in
 * Settings → Notifications.
 *
 * The hook also subscribes to the SSE `alert` channel and invalidates
 * the unread-count query so the badge updates within a few hundred
 * milliseconds of an alert firing, instead of waiting for the next
 * 30-second poll tick.
 *
 * Mount once near the root of the app (e.g. `<Layout>`).
 */
export function useTitleBadge(): void {
  const qc = useQueryClient()
  const { data: count = 0 } = useUnreadCount()
  const { settings } = useSettings()
  const enabled = settings.tab_badge_enabled !== false

  // Refresh unread count when an alert SSE event arrives so the badge
  // reflects the new count without waiting for the periodic refetch.
  useEffect(() => {
    const onAlert = () => {
      qc.invalidateQueries({ queryKey: notificationKeys.unreadCount })
    }
    sseManager.subscribe('alert', onAlert)
    return () => sseManager.unsubscribe('alert', onAlert)
  }, [qc])

  useEffect(() => {
    if (!enabled || count === 0) {
      setBasePrefix('')
      return
    }
    const display = count > 99 ? '99+' : String(count)
    setBasePrefix(`(${display}) `)
  }, [count, enabled])

  // Always clear the prefix on unmount so a hot-reload or remount of
  // the host component does not leave a stale badge.
  useEffect(() => {
    return () => setBasePrefix('')
  }, [])
}
