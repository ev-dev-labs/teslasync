import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettings } from '@/hooks/useSettings'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { sseManager } from '@/lib/sseManager'
import { setFlashPrefix } from '@/lib/titleStore'

const FLASH_INTERVAL_MS = 600
// Total alternations including the initial frame; 6 → ALERT, normal,
// ALERT, normal, ALERT, normal (i.e. 3 ALERT frames followed by a
// final normal-state restore).
const FLASH_FRAMES = 6

interface AlertEventData {
  severity?: string
  quiet_suppressed?: boolean
  is_test?: boolean
}

/**
 * Briefly prefixes `document.title` with `"(!) ALERT — "` when a
 * `severity = "critical"` alert SSE event arrives AND the tab is in
 * the background (`document.hidden`). Skips:
 *   - test alerts and quiet-hours-suppressed alerts
 *   - users with `prefers-reduced-motion: reduce`
 *   - users who disabled `critical_flash_enabled` in Settings
 *
 * The flash is cancelled immediately when the user refocuses the
 * tab (`visibilitychange`) so the title does not keep oscillating
 * once they are paying attention.
 *
 * Mount once near the root of the app (e.g. `<Layout>`).
 */
export function useCriticalAlertFlash(): void {
  const { settings } = useSettings()
  const { reduce } = useMotionPreference()
  const { t } = useTranslation()
  const enabled = settings.critical_flash_enabled !== false
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled || reduce) return

    const flashLabel = t('alerts.tabFlash', '(!) ALERT — ')

    const stopFlash = () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setFlashPrefix('')
    }

    const onAlert = (raw: unknown) => {
      const data = (raw ?? {}) as AlertEventData
      if (data.severity !== 'critical') return
      if (data.quiet_suppressed || data.is_test) return
      // Use document.hidden (rather than !document.hasFocus()) so we
      // only flash when the tab is actually in the background, not
      // when the window is merely unfocused but visible.
      if (typeof document !== 'undefined' && !document.hidden) return

      // Reset any in-flight flash so a back-to-back alert restarts
      // the sequence cleanly instead of overlapping ticks.
      stopFlash()

      // Paint the first frame immediately so the user sees the alert
      // without waiting for the first interval tick (~600 ms).
      setFlashPrefix(flashLabel)
      let i = 1
      intervalRef.current = window.setInterval(() => {
        setFlashPrefix(i % 2 === 0 ? flashLabel : '')
        i++
        if (i >= FLASH_FRAMES) {
          stopFlash()
        }
      }, FLASH_INTERVAL_MS)
    }

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        // User returned to the tab — stop flashing immediately.
        stopFlash()
      }
    }

    sseManager.subscribe('alert', onAlert)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    return () => {
      sseManager.unsubscribe('alert', onAlert)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      stopFlash()
    }
  }, [enabled, reduce, t])
}
