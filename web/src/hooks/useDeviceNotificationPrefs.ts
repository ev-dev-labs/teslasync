/**
 * @module hooks/useDeviceNotificationPrefs
 *
 * Per-device notification preferences (PWA-05) and the bridge that mirrors
 * them into the service worker.
 *
 * The server-side layers stay authoritative and are edited through the
 * canonical hooks (`useNotificationPreferences` /
 * `useUpdateNotificationPreference` for event-type routing,
 * `useQuietHours` / `useSaveQuietHours` for install-wide DND,
 * `useTestChannel` for test delivery). Those are install-wide by design.
 *
 * This module adds the layer the API cannot express: what THIS phone, tablet
 * or desktop is willing to buzz for. It is stored locally, mirrored across
 * tabs, and pushed into the service worker so the policy also applies when
 * every tab is closed — which is the only time Web Push matters.
 *
 * The schema, the sanitiser and the decision function all live in
 * `@/sw/notificationPolicy` because the service worker needs them too.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'

import {
  DEFAULT_DEVICE_NOTIFICATION_PREFS,
  sanitizeDeviceNotificationPrefs,
  type DeviceNotificationPrefs,
  type DeviceQuietHours,
  type NotificationCategory,
} from '@/sw/notificationPolicy'
import { PAGE_TO_SW } from '@/sw/swProtocol'

export const DEVICE_NOTIFICATION_PREFS_STORAGE_KEY =
  'teslasync:device-notification-prefs:v1'

/**
 * Dedicated cross-tab channel rather than the shared `@/lib/broadcast` bus,
 * matching `useVersionWatcher` and `useLowBandwidthMode`: device policy is
 * infrastructural and does not belong on the user-facing settings/theme/auth
 * bus that many component tests stub out.
 */
const DEVICE_PREFS_CHANNEL = 'teslasync:device-notification-prefs'

function readStored(): DeviceNotificationPrefs {
  if (typeof window === 'undefined') {
    return sanitizeDeviceNotificationPrefs(DEFAULT_DEVICE_NOTIFICATION_PREFS)
  }
  try {
    const raw = window.localStorage.getItem(DEVICE_NOTIFICATION_PREFS_STORAGE_KEY)
    if (raw == null) {
      return sanitizeDeviceNotificationPrefs(DEFAULT_DEVICE_NOTIFICATION_PREFS)
    }
    return sanitizeDeviceNotificationPrefs(JSON.parse(raw))
  } catch {
    // Corrupt JSON or blocked storage: fail OPEN. Notifications that the user
    // meant to receive must not disappear because a preference blob rotted.
    return sanitizeDeviceNotificationPrefs(DEFAULT_DEVICE_NOTIFICATION_PREFS)
  }
}

let snapshot: DeviceNotificationPrefs = readStored()
let serialized = JSON.stringify(snapshot)
const listeners = new Set<() => void>()
let detach: (() => void) | null = null

function notify(): void {
  for (const listener of listeners) listener()
}

function refresh(): void {
  const next = readStored()
  const nextSerialized = JSON.stringify(next)
  if (nextSerialized === serialized) return
  snapshot = next
  serialized = nextSerialized
  notify()
}

function attach(): void {
  if (detach != null || typeof window === 'undefined') return
  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== DEVICE_NOTIFICATION_PREFS_STORAGE_KEY
      && event.key !== null
    ) {
      return
    }
    refresh()
    void postDeviceNotificationPrefsToServiceWorker(snapshot)
  }
  window.addEventListener('storage', onStorage)

  let channel: BroadcastChannel | null = null
  const onMessage = () => {
    refresh()
    void postDeviceNotificationPrefsToServiceWorker(snapshot)
  }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(DEVICE_PREFS_CHANNEL)
      channel.addEventListener('message', onMessage)
    }
  } catch {
    channel = null
  }

  detach = () => {
    window.removeEventListener('storage', onStorage)
    channel?.removeEventListener('message', onMessage)
    try {
      channel?.close()
    } catch {
      /* already closed */
    }
  }
}

/** Notify sibling tabs that the stored policy changed. */
function announceChange(): void {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(DEVICE_PREFS_CHANNEL)
    channel.postMessage({ changed: true })
    channel.close()
  } catch {
    // Siblings still pick the change up from the `storage` event.
  }
}

/** Current device preferences. Safe to call outside React. */
export function getDeviceNotificationPrefs(): DeviceNotificationPrefs {
  return snapshot
}

export function subscribeDeviceNotificationPrefs(listener: () => void): () => void {
  attach()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && detach != null) {
      detach()
      detach = null
    }
  }
}

/**
 * Push the policy into whichever worker controls this page.
 *
 * Uses `registration.active` rather than `navigator.serviceWorker.controller`
 * so a freshly installed worker that has not yet claimed this client still
 * receives the preferences — otherwise the first push after an update would
 * be evaluated against the shipped defaults.
 */
export async function postDeviceNotificationPrefsToServiceWorker(
  prefs: DeviceNotificationPrefs,
): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const target = registration?.active ?? navigator.serviceWorker.controller
    if (target == null) return false
    target.postMessage({ type: PAGE_TO_SW.deviceNotificationPrefs, prefs })
    return true
  } catch {
    // No worker, or a worker in the middle of being replaced. The next page
    // load re-sends, and the worker's own persisted copy covers the gap.
    return false
  }
}

/**
 * Shallow patch shape. `categories` and `quietHours` are merged field-by-field
 * so a caller can flip one toggle without restating the whole sub-object.
 */
export interface DeviceNotificationPrefsPatch
  extends Partial<Omit<DeviceNotificationPrefs, 'categories' | 'quietHours' | 'version'>> {
  categories?: Partial<Record<NotificationCategory, boolean>>
  quietHours?: Partial<DeviceQuietHours>
}

/**
 * Merge a patch into the stored preferences.
 *
 * The whole object is re-sanitised on every write so a partially-typed patch
 * (or an older tab writing an older shape) can never persist an invalid
 * policy that the service worker would then have to defend against.
 */
export function updateDeviceNotificationPrefs(
  patch: DeviceNotificationPrefsPatch,
): DeviceNotificationPrefs {
  const next = sanitizeDeviceNotificationPrefs({
    ...snapshot,
    ...patch,
    categories: { ...snapshot.categories, ...(patch.categories ?? {}) },
    quietHours: { ...snapshot.quietHours, ...(patch.quietHours ?? {}) },
  })
  const nextSerialized = JSON.stringify(next)

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        DEVICE_NOTIFICATION_PREFS_STORAGE_KEY,
        nextSerialized,
      )
    } catch {
      // Keep the in-memory value; this tab still honours the change.
    }
  }

  if (nextSerialized !== serialized) {
    snapshot = next
    serialized = nextSerialized
    notify()
    announceChange()
  }
  void postDeviceNotificationPrefsToServiceWorker(next)
  return next
}

/** Restore the shipped defaults (deliver everything). */
export function resetDeviceNotificationPrefs(): DeviceNotificationPrefs {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(DEVICE_NOTIFICATION_PREFS_STORAGE_KEY)
    } catch {
      /* fall through to the in-memory reset */
    }
  }
  const next = sanitizeDeviceNotificationPrefs(DEFAULT_DEVICE_NOTIFICATION_PREFS)
  snapshot = next
  serialized = JSON.stringify(next)
  notify()
  announceChange()
  void postDeviceNotificationPrefsToServiceWorker(next)
  return next
}

function getSnapshot(): DeviceNotificationPrefs {
  return snapshot
}

const SERVER_SNAPSHOT = sanitizeDeviceNotificationPrefs(
  DEFAULT_DEVICE_NOTIFICATION_PREFS,
)

function getServerSnapshot(): DeviceNotificationPrefs {
  return SERVER_SNAPSHOT
}

export interface UseDeviceNotificationPrefsResult {
  prefs: DeviceNotificationPrefs
  updatePrefs: (patch: DeviceNotificationPrefsPatch) => void
  resetPrefs: () => void
  /** `true` when at least one filter would suppress some deliveries. */
  hasFilters: boolean
}

export function useDeviceNotificationPrefs(): UseDeviceNotificationPrefsResult {
  const prefs = useSyncExternalStore(
    subscribeDeviceNotificationPrefs,
    getSnapshot,
    getServerSnapshot,
  )

  const updatePrefs = useCallback((patch: DeviceNotificationPrefsPatch) => {
    updateDeviceNotificationPrefs(patch)
  }, [])
  const resetPrefs = useCallback(() => {
    resetDeviceNotificationPrefs()
  }, [])

  const hasFilters = useMemo(
    () =>
      !prefs.enabled
      || prefs.minSeverity !== 'info'
      || prefs.vehicleScope === 'selected'
      || prefs.quietHours.enabled
      || Object.values(prefs.categories).some((allowed) => allowed === false),
    [prefs],
  )

  return { prefs, updatePrefs, resetPrefs, hasFilters }
}

/** Test seam: drop listeners and re-read storage. */
export function __resetDeviceNotificationPrefsForTests(): void {
  detach?.()
  detach = null
  listeners.clear()
  snapshot = readStored()
  serialized = JSON.stringify(snapshot)
}
