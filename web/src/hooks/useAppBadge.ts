import { useEffect } from 'react'
import { useUnreadCount } from '@/api/hooks/useNotifications'
import { useSettings } from '@/hooks/useSettings'

interface NavigatorWithBadge {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/**
 * Mirrors the unread-notification count onto the OS app icon (Badging API).
 *
 * Installed apps on supported platforms, including iOS 16.4+, paint the
 * badge on the launcher / taskbar / dock icon; browsers without the API
 * simply no-op. Shares the `tab_badge_enabled` preference with the
 * tab title/favicon badges — one toggle for every unread surface.
 *
 * The count syncs while an app tab is open. The service worker does not
 * badge on push: it cannot read the user's tab_badge_enabled preference,
 * so doing so would override an explicit opt-out.
 */
export function useAppBadge(): void {
  const { data: count = 0 } = useUnreadCount()
  const { settings } = useSettings()
  const enabled = settings.tab_badge_enabled !== false

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const nav = navigator as NavigatorWithBadge
    if (typeof nav.setAppBadge !== 'function') return

    if (!enabled || count <= 0) {
      void nav.clearAppBadge?.().catch(() => {
        // Badge clearing is best-effort; a failure leaves a stale badge
        // that the next successful sync corrects.
      })
      return
    }

    void nav.setAppBadge(count).catch(() => {
      // Unsupported entry point (non-installed context on some platforms)
      // or a transient failure — the tab badges still carry the signal.
    })
  }, [count, enabled])

  // A stale badge must not survive logout/teardown: the next launch
  // re-syncs from the live unread count.
  useEffect(() => {
    return () => {
      const nav = navigator as NavigatorWithBadge | undefined
      if (typeof nav?.clearAppBadge === 'function') {
        void nav.clearAppBadge().catch(() => {})
      }
    }
  }, [])
}
