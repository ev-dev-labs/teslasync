/**
 * @module hooks/useServiceWorkerBridge
 *
 * The page's half of the service-worker protocol (`@/sw/swProtocol`).
 *
 * Three jobs:
 *
 *   1. **Mirror device state into the worker.** The notification policy and
 *      the low-bandwidth flag are decided by the page but enforced by the
 *      worker, which keeps running after every tab is closed. They are
 *      re-sent on mount, on change, and whenever the controlling worker is
 *      replaced by an update.
 *   2. **Read back what is cached.** `GET /api/v1/...` reads the service
 *      worker stored for offline use are reported with the exact instant they
 *      were captured, so the UI can disclose *"showing data cached at 14:02"*
 *      instead of silently implying it is live (PWA-02).
 *   3. **Stay honest when there is no worker.** Every entry point degrades to
 *      `null`/`false` rather than throwing, because a dev server, a
 *      non-secure origin, Firefox private browsing, and an install where the
 *      user cleared site data all legitimately have no worker.
 */

import { useCallback, useEffect, useState } from 'react'

import {
  isLowBandwidthActive,
  subscribeLowBandwidth,
  useLowBandwidthMode,
} from '@/hooks/useLowBandwidthMode'
import {
  postDeviceNotificationPrefsToServiceWorker,
  useDeviceNotificationPrefs,
} from '@/hooks/useDeviceNotificationPrefs'
import {
  PAGE_TO_SW,
  isSwStatusMessage,
  type CachedApiEntry,
  type SwStatusMessage,
} from '@/sw/swProtocol'

/** How long to wait for the worker to answer a status request. */
export const SW_STATUS_TIMEOUT_MS = 2_000

function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

/** Push the low-bandwidth flag into the worker. Best-effort. */
export async function postLowBandwidthToServiceWorker(
  enabled: boolean,
): Promise<boolean> {
  if (!serviceWorkerSupported()) return false
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const target = registration?.active ?? navigator.serviceWorker.controller
    if (target == null) return false
    target.postMessage({ type: PAGE_TO_SW.lowBandwidth, enabled })
    return true
  } catch {
    return false
  }
}

/**
 * Ask the worker to describe itself and its cached API reads.
 *
 * Uses a `MessageChannel` so the reply is correlated to this request rather
 * than to whichever listener happens to be attached — two panels asking at
 * once must not read each other's answers. Resolves `null` on timeout so a
 * wedged worker can never hang a render forever.
 */
export function requestServiceWorkerStatus(
  timeoutMs = SW_STATUS_TIMEOUT_MS,
): Promise<SwStatusMessage | null> {
  if (!serviceWorkerSupported()) return Promise.resolve(null)
  if (typeof MessageChannel === 'undefined') return Promise.resolve(null)

  return new Promise<SwStatusMessage | null>((resolve) => {
    let settled = false
    const finish = (value: SwStatusMessage | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        const target = registration?.active ?? navigator.serviceWorker.controller
        if (target == null) {
          finish(null)
          return
        }
        const channel = new MessageChannel()
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        channel.port1.onmessage = (event: MessageEvent) => {
          const data = event.data
          finish(isSwStatusMessage(data) && data.requestId === requestId ? data : null)
          channel.port1.close()
        }
        target.postMessage({ type: PAGE_TO_SW.requestStatus, requestId }, [
          channel.port2,
        ])
        setTimeout(() => finish(null), timeoutMs)
      })
      .catch(() => finish(null))
  })
}

/**
 * Keep the worker's copy of the device state in sync.
 *
 * Mount ONCE near the application root. Re-sends on `controllerchange` so an
 * update never resets the policy to the shipped defaults.
 */
export function useServiceWorkerBridge(): void {
  const { prefs } = useDeviceNotificationPrefs()
  const { enabled: lowBandwidth } = useLowBandwidthMode()

  useEffect(() => {
    void postDeviceNotificationPrefsToServiceWorker(prefs)
  }, [prefs])

  useEffect(() => {
    void postLowBandwidthToServiceWorker(lowBandwidth)
  }, [lowBandwidth])

  useEffect(() => {
    if (!serviceWorkerSupported()) return undefined
    const resend = () => {
      void postDeviceNotificationPrefsToServiceWorker(prefs)
      void postLowBandwidthToServiceWorker(isLowBandwidthActive())
    }
    navigator.serviceWorker.addEventListener('controllerchange', resend)
    // Also covers a network-level change that flips the automatic policy
    // while no React state changed.
    const stop = subscribeLowBandwidth(() => {
      void postLowBandwidthToServiceWorker(isLowBandwidthActive())
    })
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', resend)
      stop()
    }
  }, [prefs])
}

export interface ServiceWorkerCacheStatus {
  /** `null` while loading, or when no worker is available to ask. */
  status: SwStatusMessage | null
  entries: CachedApiEntry[]
  /**
   * OLDEST `cachedAt` across all entries, or `null` when nothing is cached.
   *
   * This is the honest number for a blanket "everything on screen is cached"
   * disclosure: a page typically renders several cached reads at once, and
   * quoting the newest of them understates how stale the worst one is. A
   * banner that says "cached 2 minutes ago" while a panel below it is showing
   * an eleven-hour-old value is worse than no banner at all.
   */
  oldestCachedAt: number | null
  /**
   * NEWEST `cachedAt` across all entries, or `null` when nothing is cached.
   * Use only to describe a RANGE alongside {@link oldestCachedAt}, or for a
   * single known entry — never on its own as a blanket age.
   */
  newestCachedAt: number | null
  /** Entries whose capture time could be read. */
  timestampedCount: number
  loading: boolean
  refresh: () => void
}

/**
 * Cached-read disclosure data for the UI.
 *
 * Deliberately NOT a TanStack Query: the answer comes from Cache Storage, not
 * from the API, and wiring it through the query client would make it a
 * dependency of the very offline path it is describing.
 */
export function useServiceWorkerCacheStatus(): ServiceWorkerCacheStatus {
  const [status, setStatus] = useState<SwStatusMessage | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void requestServiceWorkerStatus().then((next) => {
      if (cancelled) return
      setStatus(next)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [nonce])

  // Re-read when connectivity flips: the disclosure matters most at exactly
  // the moment the network disappears.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const bump = () => setNonce((value) => value + 1)
    window.addEventListener('online', bump)
    window.addEventListener('offline', bump)
    return () => {
      window.removeEventListener('online', bump)
      window.removeEventListener('offline', bump)
    }
  }, [])

  const refresh = useCallback(() => setNonce((value) => value + 1), [])
  const entries = status?.entries ?? []
  const timestamps = entries
    .map((entry) => entry.cachedAt)
    .filter((value): value is number => value != null)
  const oldestCachedAt = timestamps.length === 0 ? null : Math.min(...timestamps)
  const newestCachedAt = timestamps.length === 0 ? null : Math.max(...timestamps)

  return {
    status,
    entries,
    oldestCachedAt,
    newestCachedAt,
    timestampedCount: timestamps.length,
    loading,
    refresh,
  }
}
