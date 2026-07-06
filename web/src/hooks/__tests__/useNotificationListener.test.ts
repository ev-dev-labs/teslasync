import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough'
import type { Alert } from '@/api/types'

// Must mirror the private PREFS_KEY inside the hook so we can seed / read the
// same localStorage slot the hook persists to.
const PREFS_KEY = 'teslasync-web-push-prefs'

// Shared mock state. `vi.hoisted` guarantees this object exists before the
// (hoisted) vi.mock factories run — a plain top-level `const` would be in the
// temporal dead zone when the mocked modules are first imported.
type Listener = (data: unknown) => void
const h = vi.hoisted(() => ({
  sseListeners: new Map<string, Set<(data: unknown) => void>>(),
  sendNotification: vi.fn(),
  navigate: vi.fn(),
  playSound: vi.fn(),
  getSoundPrefs: vi.fn(() => ({ master: true })),
  permission: 'granted' as NotificationPermission,
}))

// ── Mock: useWebPush — control permission + capture sendNotification calls ──
vi.mock('../useWebPush', () => ({
  useWebPush: () => ({
    permission: h.permission,
    sendNotification: h.sendNotification,
  }),
}))

// ── Mock: react-router-dom — stub useNavigate (no Router context in renderHook) ──
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => h.navigate }
})

// ── Mock: react-i18next — a t() that returns the inline default and interpolates ──
vi.mock('react-i18next', () => {
  const t = (key: string, def?: string, opts?: Record<string, unknown>) => {
    const base = def ?? key
    if (!opts) return base
    return base.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts[name] ?? ''))
  }
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) }
})

// ── Mock: sseManager — in-memory listener registry we can fire against ──
vi.mock('@/lib/sseManager', () => ({
  sseManager: {
    subscribe: (event: string, listener: Listener) => {
      if (!h.sseListeners.has(event)) h.sseListeners.set(event, new Set())
      h.sseListeners.get(event)!.add(listener)
    },
    unsubscribe: (event: string, listener: Listener) => {
      h.sseListeners.get(event)?.delete(listener)
    },
  },
}))

// ── Mock: notificationSound — spy the player but keep the real category mapping ──
vi.mock('@/lib/notificationSound', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notificationSound')>(
    '@/lib/notificationSound',
  )
  return {
    ...actual,
    playNotificationSound: h.playSound,
    getNotificationSoundPrefs: h.getSoundPrefs,
  }
})

import { useNotificationListener } from '../useNotificationListener'

type SendArgs = [string, { body?: string; tag?: string }, (() => void)?]
const sendCall = (i = 0) => h.sendNotification.mock.calls[i] as SendArgs

function fire(event: string, data?: unknown) {
  const subs = h.sseListeners.get(event)
  if (!subs) return
  for (const fn of [...subs]) fn(data)
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

describe('useNotificationListener', () => {
  beforeEach(() => {
    h.sseListeners.clear()
    h.sendNotification.mockClear()
    h.navigate.mockClear()
    h.playSound.mockClear()
    h.getSoundPrefs.mockClear()
    h.permission = 'granted'
    localStorage.clear()
    // Notifications only fire while the tab is backgrounded.
    setHidden(true)
  })

  afterEach(() => {
    setHidden(false)
    vi.restoreAllMocks()
  })

  describe('preference loading + normalisation', () => {
    it('initialises with default prefs when nothing is stored', () => {
      const { result } = renderHook(() => useNotificationListener())
      expect(result.current.prefs).toEqual({ alerts: true, exportStatus: true })
    })

    it('merges a partial stored preference over the defaults', () => {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ alerts: false }))
      const { result } = renderHook(() => useNotificationListener())
      expect(result.current.prefs.alerts).toBe(false)
      expect(result.current.prefs.exportStatus).toBe(true)
    })

    it('falls back to defaults when the stored JSON is corrupt', () => {
      localStorage.setItem(PREFS_KEY, '{not-valid-json')
      const { result } = renderHook(() => useNotificationListener())
      expect(result.current.prefs).toEqual({ alerts: true, exportStatus: true })
    })

    it('ignores non-object stored JSON without polluting the prefs object', () => {
      // A bare string previously spread into stray numeric index keys.
      localStorage.setItem(PREFS_KEY, '"a rogue string"')
      const { result } = renderHook(() => useNotificationListener())
      expect(Object.keys(result.current.prefs).sort()).toEqual(['alerts', 'exportStatus'])
      expect(result.current.prefs.alerts).toBe(true)
    })

    it('rejects non-boolean stored values and keeps strict booleans', () => {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ alerts: 'yes', exportStatus: 0 }))
      const { result } = renderHook(() => useNotificationListener())
      expect(result.current.prefs.alerts).toBe(true)
      expect(result.current.prefs.exportStatus).toBe(true)
      expect(typeof result.current.prefs.exportStatus).toBe('boolean')
    })
  })

  describe('setPrefs', () => {
    it('updates state and persists to localStorage', () => {
      const { result } = renderHook(() => useNotificationListener())
      act(() => {
        result.current.setPrefs({ alerts: false, exportStatus: false })
      })
      expect(result.current.prefs).toEqual({ alerts: false, exportStatus: false })
      expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toEqual({
        alerts: false,
        exportStatus: false,
      })
    })

    it('supports a functional updater', () => {
      const { result } = renderHook(() => useNotificationListener())
      act(() => {
        result.current.setPrefs((prev) => ({ ...prev, exportStatus: false }))
      })
      expect(result.current.prefs).toEqual({ alerts: true, exportStatus: false })
    })

    it('does not throw when localStorage persistence fails', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      const { result } = renderHook(() => useNotificationListener())
      expect(() => {
        act(() => {
          result.current.setPrefs({ alerts: false, exportStatus: true })
        })
      }).not.toThrow()
      // In-memory state still reflects the toggle even though it couldn't persist.
      expect(result.current.prefs.alerts).toBe(false)
      spy.mockRestore()
    })
  })

  describe('SSE subscription lifecycle', () => {
    it('subscribes the notification + sound alert handlers and export_status when permitted', () => {
      const { unmount } = renderHook(() => useNotificationListener())
      // One alert handler for OS notifications, one for the audio cue.
      expect(h.sseListeners.get('alert')?.size).toBe(2)
      expect(h.sseListeners.get('export_status')?.size).toBe(1)
      unmount()
      expect(h.sseListeners.get('alert')?.size).toBe(0)
      expect(h.sseListeners.get('export_status')?.size).toBe(0)
    })

    it('skips the notification subscriptions when permission is not granted', () => {
      h.permission = 'default'
      renderHook(() => useNotificationListener())
      // Only the permission-independent sound handler remains.
      expect(h.sseListeners.get('alert')?.size).toBe(1)
      expect(h.sseListeners.get('export_status')?.size ?? 0).toBe(0)
    })
  })

  describe('alert notifications', () => {
    it('fires a browser notification for an alert while the tab is hidden', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { id: 42, vehicle_name: 'Model 3', message: 'Low battery' })
      })
      expect(h.sendNotification).toHaveBeenCalledTimes(1)
      const [title, options] = sendCall()
      expect(title).toBe('TeslaSync Alert')
      expect(options.body).toBe('Model 3 — Low battery')
      expect(options.tag).toBe('alert-42')
    })

    it('prefers the alert title when present', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { id: 5, title: 'Sentry Triggered', message: 'Motion detected' })
      })
      expect(sendCall()[0]).toBe('Sentry Triggered')
    })

    it('does not fire a notification when the tab is visible', () => {
      setHidden(false)
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { id: 1, message: 'x' })
      })
      expect(h.sendNotification).not.toHaveBeenCalled()
    })

    it('suppresses alert notifications when the alerts preference is off', () => {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ alerts: false, exportStatus: true }))
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { id: 1, message: 'x' })
      })
      expect(h.sendNotification).not.toHaveBeenCalled()
    })

    it('ignores quiet-suppressed and test alerts', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { id: 1, message: 'suppressed', quiet_suppressed: true })
      })
      act(() => {
        fire('alert', { id: 2, message: 'test', is_test: true })
      })
      expect(h.sendNotification).not.toHaveBeenCalled()
    })

    it('provides a drill-through onClick that navigates when the alert has context', () => {
      renderHook(() => useNotificationListener())
      const alertData = {
        id: 7,
        vehicle_id: 3,
        type: 'battery',
        severity: 'critical',
        title: 'Low Battery',
        message: 'Battery at 10%',
        vehicle_name: 'Model 3',
        created_at: '2026-01-02T03:04:05Z',
        rule_id: 11,
        rule_signal: 'BatteryLevel',
        rule_severity: 'critical',
      }
      act(() => {
        fire('alert', alertData)
      })
      const onClick = sendCall()[2]
      expect(typeof onClick).toBe('function')

      act(() => {
        onClick?.()
      })

      const expected: Alert = {
        id: 7,
        vehicle_id: 3,
        type: 'battery',
        severity: 'critical',
        title: 'Low Battery',
        message: 'Battery at 10%',
        is_read: false,
        created_at: '2026-01-02T03:04:05Z',
        rule_id: 11,
        rule_signal: 'BatteryLevel',
        rule_severity: 'critical',
      }
      const expectedHref = getAlertDrillthroughHref(expected)
      expect(h.navigate).toHaveBeenCalledWith(expectedHref)
      expect(expectedHref).toContain('/battery')
      expect(expectedHref).toContain('signal=BatteryLevel')
    })

    it('omits the onClick handler when the alert lacks drill-through context', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { id: 9, title: 'Bare', message: 'no context' })
      })
      expect(h.sendNotification).toHaveBeenCalledTimes(1)
      expect(sendCall()[2]).toBeUndefined()
    })

    it('tags the notification with a timestamp when the alert has no id', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1234567890)
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { message: 'no id' })
      })
      expect(sendCall()[1].tag).toBe('alert-1234567890')
    })
  })

  describe('export status notifications', () => {
    it('notifies with the filename when an export is ready', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('export_status', { status: 'ready', filename: 'drives.csv' })
      })
      expect(h.sendNotification).toHaveBeenCalledTimes(1)
      const [title, options] = sendCall()
      expect(title).toBe('Export Ready')
      expect(options.body).toBe('drives.csv is ready for download')
      expect(options.tag).toBe('export-ready')
    })

    it('uses a generic body when a ready export has no filename', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('export_status', { status: 'ready' })
      })
      expect(sendCall()[1].body).toBe('Your data export is ready for download')
    })

    it('surfaces the server error message when an export fails', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('export_status', { status: 'failed', error: 'disk full' })
      })
      const [title, options] = sendCall()
      expect(title).toBe('Export Failed')
      expect(options.body).toBe('disk full')
      expect(options.tag).toBe('export-failed')
    })

    it('uses a default body when a failed export omits an error', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('export_status', { status: 'failed' })
      })
      expect(sendCall()[1].body).toBe(
        'Data export failed. Check the exports page for details.',
      )
    })

    it('does nothing for export statuses other than ready/failed', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('export_status', { status: 'in_progress' })
      })
      expect(h.sendNotification).not.toHaveBeenCalled()
    })

    it('suppresses export notifications when the exportStatus preference is off', () => {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ alerts: true, exportStatus: false }))
      renderHook(() => useNotificationListener())
      act(() => {
        fire('export_status', { status: 'ready', filename: 'x.csv' })
      })
      expect(h.sendNotification).not.toHaveBeenCalled()
    })
  })

  describe('per-channel sound cues', () => {
    it('plays the mapped sound even when the tab is visible and permission is denied', () => {
      h.permission = 'denied'
      setHidden(false)
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { type: 'alert', severity: 'critical' })
      })
      expect(h.playSound).toHaveBeenCalledTimes(1)
      expect(h.playSound.mock.calls[0][0]).toBe('critical_alert')
      // The OS-notification path stays gated behind permission.
      expect(h.sendNotification).not.toHaveBeenCalled()
    })

    it('passes the live sound prefs snapshot to the player', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { type: 'alert', severity: 'warning' })
      })
      expect(h.getSoundPrefs).toHaveBeenCalled()
      expect(h.playSound).toHaveBeenCalledWith('warning_alert', { master: true })
    })

    it('does not play a sound for quiet-suppressed or test alerts', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { severity: 'critical', quiet_suppressed: true })
      })
      act(() => {
        fire('alert', { severity: 'critical', is_test: true })
      })
      expect(h.playSound).not.toHaveBeenCalled()
    })

    it('does not play a sound when the alert maps to no sound category', () => {
      renderHook(() => useNotificationListener())
      act(() => {
        fire('alert', { type: 'vehicle_update' })
      })
      expect(h.playSound).not.toHaveBeenCalled()
    })
  })
})
