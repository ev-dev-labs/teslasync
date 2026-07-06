import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { sseManager } from '../lib/sseManager'
import { useWebPush } from './useWebPush'
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough'
import {
  getNotificationSoundPrefs,
  mapNotificationToCategory,
  playNotificationSound,
} from '@/lib/notificationSound'
import type { Alert } from '@/api/types'

const PREFS_KEY = 'teslasync-web-push-prefs'

export interface WebPushPreferences {
  alerts: boolean
  exportStatus: boolean
}

const DEFAULT_PREFS: WebPushPreferences = {
  alerts: true,
  exportStatus: true,
}

// Merge only the known boolean keys from persisted JSON over the defaults.
// Guards against a corrupt/legacy payload that parses to a non-object (e.g.
// a bare string or number, which would otherwise spread stray index keys onto
// the prefs object) or carries non-boolean values for a known key.
function normalizePrefs(raw: unknown): WebPushPreferences {
  const out: WebPushPreferences = { ...DEFAULT_PREFS }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (typeof r.alerts === 'boolean') out.alerts = r.alerts
    if (typeof r.exportStatus === 'boolean') out.exportStatus = r.exportStatus
  }
  return out
}

function loadPrefs(): WebPushPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    return normalizePrefs(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function savePrefs(prefs: WebPushPreferences) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Quota exceeded / private-mode / storage disabled: keep the in-memory
    // update so the current tab still reflects the toggle even though it
    // cannot be persisted across reloads.
  }
}

interface AlertEventData {
  id?: number
  title?: string
  message?: string
  severity?: string
  vehicle_name?: string
  vehicle_id?: number
  rule_id?: number | null
  rule_signal?: string | null
  rule_severity?: string | null
  type?: string
  created_at?: string
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
  const { t } = useTranslation()
  const [prefs, setPrefsState] = useState<WebPushPreferences>(loadPrefs)
  const navigate = useNavigate()

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

      const title = data.title ?? t('browserNotifications.toast.alertTitle', 'TeslaSync Alert')
      const body = [data.vehicle_name, data.message].filter(Boolean).join(' — ')

      // Build a drill-through URL so clicking the OS notification deep-links
      // into the relevant context page. When we don't have enough metadata,
      // fall back to focusing the tab without navigating.
      const hasContext = !!(data.created_at || data.rule_signal || data.vehicle_id)
      const onClick = hasContext
        ? () => {
            const alert: Alert = {
              id: data.id ?? 0,
              vehicle_id: data.vehicle_id ?? 0,
              type: data.type ?? 'notification',
              severity: data.severity ?? 'info',
              title: data.title ?? '',
              message: data.message ?? '',
              is_read: false,
              created_at: data.created_at ?? new Date().toISOString(),
              rule_id: data.rule_id ?? null,
              rule_signal: data.rule_signal ?? null,
              rule_severity: data.rule_severity ?? null,
            }
            navigate(getAlertDrillthroughHref(alert))
          }
        : undefined

      sendNotification(title, {
        body: body || undefined,
        tag: `alert-${data.id ?? Date.now()}`,
      }, onClick)
    }

    const onExportStatus = (raw: unknown) => {
      if (!prefs.exportStatus) return
      if (!document.hidden) return

      const data = raw as ExportStatusData
      if (data.status === 'ready') {
        sendNotification(t('browserNotifications.toast.exportReadyTitle', 'Export Ready'), {
          body: data.filename
            ? t('browserNotifications.toast.exportReadyBody', '{{filename}} is ready for download', {
                filename: data.filename,
              })
            : t('browserNotifications.toast.exportReadyBodyGeneric', 'Your data export is ready for download'),
          tag: 'export-ready',
        })
      } else if (data.status === 'failed') {
        sendNotification(t('browserNotifications.toast.exportFailedTitle', 'Export Failed'), {
          body:
            data.error ??
            t('browserNotifications.toast.exportFailedBody', 'Data export failed. Check the exports page for details.'),
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
  }, [permission, prefs, sendNotification, navigate, t])

  // Per-channel notification sounds live in their own effect because audio
  // cues are independent of the OS browser
  // notification permission and fire even while the tab is visible —
  // they complement the in-app toast / OS notification, they don't
  // replace them.
  useEffect(() => {
    const onAlertSound = (raw: unknown) => {
      const data = raw as AlertEventData
      if (data.quiet_suppressed || data.is_test) return
      const category = mapNotificationToCategory({
        type: data.type ?? 'alert',
        severity: data.severity ?? null,
      })
      if (!category) return
      // Pull prefs at fire-time (not effect-creation time) so toggling a
      // channel in Settings takes effect on the very next event without
      // re-subscribing the SSE handler.
      playNotificationSound(category, getNotificationSoundPrefs())
    }
    sseManager.subscribe('alert', onAlertSound)
    return () => {
      sseManager.unsubscribe('alert', onAlertSound)
    }
  }, [])

  return { prefs, setPrefs }
}
