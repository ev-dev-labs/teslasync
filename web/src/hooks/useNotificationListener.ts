import { useEffect, useState, useCallback } from 'react'
import { sseManager } from '../lib/sseManager'
import { useWebPush } from './useWebPush'

const PREFS_KEY = 'teslasync-web-push-prefs'

export interface WebPushPreferences {
  alerts: boolean
  exportStatus: boolean
}

const DEFAULT_PREFS: WebPushPreferences = {
  alerts: true,
  exportStatus: true,
}

function loadPrefs(): WebPushPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: WebPushPreferences) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

interface AlertEventData {
  id?: number
  title?: string
  message?: string
  severity?: string
  vehicle_name?: string
  quiet_suppressed?: boolean
  is_test?: boolean
}

interface ExportStatusData {
  status?: string
  filename?: string
  format?: string
  error?: string
}

/**
 * Listens to SSE events via the singleton sseManager and fires browser
 * Notifications for alerts and export-status updates. Only fires when
 * the app tab is hidden (document.hidden) to avoid double-notifying
 * alongside in-app toasts.
 *
 * Available backend SSE event types on /api/v1/events:
 *   - vehicle_update  (raw telemetry — too noisy for notifications)
 *   - alert           (alert triggers — mapped to browser notification)
 *   - export_status   (export lifecycle — notify on ready/failed)
 *
 * Note: charge_complete and drive_end are NOT separate SSE event types.
 * Those would require dedicated backend events to be added.
 */
export function useNotificationListener() {
  const { permission, sendNotification } = useWebPush()
  const [prefs, setPrefsState] = useState<WebPushPreferences>(loadPrefs)

  const setPrefs = useCallback((next: WebPushPreferences | ((prev: WebPushPreferences) => WebPushPreferences)) => {
    setPrefsState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      savePrefs(resolved)
      return resolved
    })
  }, [])

  useEffect(() => {
    if (permission !== 'granted') return

    const onAlert = (raw: unknown) => {
      if (!prefs.alerts) return
      // Only notify when the tab is not visible to avoid doubling in-app toasts
      if (!document.hidden) return

      const data = raw as AlertEventData
      if (data.quiet_suppressed || data.is_test) return

      const title = data.title ?? 'TeslaSync Alert'
      const body = [data.vehicle_name, data.message].filter(Boolean).join(' — ')

      sendNotification(title, {
        body: body || undefined,
        tag: `alert-${data.id ?? Date.now()}`,
      })
    }

    const onExportStatus = (raw: unknown) => {
      if (!prefs.exportStatus) return
      if (!document.hidden) return

      const data = raw as ExportStatusData
      if (data.status === 'ready') {
        sendNotification('Export Ready', {
          body: data.filename
            ? `${data.filename} is ready for download`
            : 'Your data export is ready for download',
          tag: 'export-ready',
        })
      } else if (data.status === 'failed') {
        sendNotification('Export Failed', {
          body: data.error ?? 'Data export failed. Check the exports page for details.',
          tag: 'export-failed',
        })
      }
    }

    sseManager.subscribe('alert', onAlert)
    sseManager.subscribe('export_status', onExportStatus)

    return () => {
      sseManager.unsubscribe('alert', onAlert)
      sseManager.unsubscribe('export_status', onExportStatus)
    }
  }, [permission, prefs, sendNotification])

  return { prefs, setPrefs }
}
