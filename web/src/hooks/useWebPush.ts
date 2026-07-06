import { useCallback, useEffect, useState } from 'react'
import { useSubscribePush, useUnsubscribePush, usePushPublicKey } from '@/api/hooks/usePush'

const isSupported = typeof window !== 'undefined' && 'Notification' in window
const isPushAPISupported =
  typeof window !== 'undefined' &&
  'PushManager' in window &&
  'serviceWorker' in navigator

/**
 * Convert a base64url string (the encoding used by VAPID public keys
 * over the wire) to the Uint8Array shape `PushManager.subscribe()`
 * expects for `applicationServerKey`. This is the standard
 * MDN-documented helper — kept inline because it's the only place we
 * use it.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  // Allocate a fresh ArrayBuffer (not SharedArrayBuffer) so the result
  // is assignable to BufferSource — required by PushManager.subscribe()
  // under TypeScript 5's stricter typed-array generics.
  const buf = new ArrayBuffer(rawData.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i)
  return out
}

/**
 * Hook for managing browser Notification permissions, in-app notifications,
 * and Web Push (VAPID) subscriptions for out-of-tab delivery.
 *
 * The hook returns BOTH the original "in-app toast" path
 * (`sendNotification`, useful while the tab is open) AND the Push API path
 * (`subscribe` / `unsubscribe`) so existing callers keep working.
 */
export function useWebPush() {
  const [permission, setPermission] = useState<NotificationPermission>(
    isSupported ? Notification.permission : 'denied',
  )
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false)
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null)

  const { data: publicKey } = usePushPublicKey()
  const subscribeMut = useSubscribePush()
  const unsubscribeMut = useUnsubscribePush()

  /**
   * Reflect the existing browser-side subscription (if any) into local
   * state so the UI knows whether to render "Enable" or "Disable" on
   * mount. We deliberately read `pushManager.getSubscription()` — that
   * is the only authoritative source for "is THIS device registered".
   * The server's per-device list is a superset (other devices too).
   */
  useEffect(() => {
    if (!isPushAPISupported) return
    let cancelled = false
    void navigator.serviceWorker
      .getRegistration()
      .then(async (reg) => {
        if (!reg || cancelled) return
        const sub = await reg.pushManager.getSubscription()
        if (cancelled) return
        setIsSubscribed(!!sub)
        setCurrentEndpoint(sub?.endpoint ?? null)
      })
      .catch(() => {
        // A failed registration/subscription lookup just means "unknown /
        // not subscribed on this device" — never surface it as an
        // unhandled promise rejection.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) return 'denied'
    const result = await Notification.requestPermission()
    setPermission(result)
    return result
  }, [])

  /**
   * In-app notification (Notification API only — does NOT survive a
   * closed tab). Kept for the alert-toast path; new code targeting
   * closed-tab delivery should use `subscribe()`
   * instead.
   *
   * @deprecated Prefer `subscribe()` for out-of-tab notifications.
   */
  const sendNotification = useCallback(
    (title: string, options?: NotificationOptions, onClick?: () => void) => {
      if (!isSupported || permission !== 'granted') return null
      const n = new Notification(title, {
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        ...options,
      })
      n.onclick = () => {
        window.focus()
        if (onClick) {
          try {
            onClick()
          } catch {
            /* swallow — best-effort navigation */
          }
        }
        n.close()
      }
      return n
    },
    [permission],
  )

  /**
   * Register this browser-device-pairing for Web Push. Returns true on
   * success, false otherwise. Side effects:
   *   1. Asks for Notification permission if not yet granted.
   *   2. Calls pushManager.subscribe() with the server's VAPID public
   *      key as applicationServerKey.
   *   3. POSTs the subscription JSON to /push/subscribe so the server
   *      can deliver to this device.
   *
   * Surfaces toast feedback via the underlying mutation hooks, so the
   * caller does not need to wire its own success/error toasts.
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isPushAPISupported || !publicKey) return false

    let perm = permission
    if (perm !== 'granted') {
      perm = await requestPermission()
      if (perm !== 'granted') return false
    }

    let sub: PushSubscription | null = null
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) return false

      sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
      }
    } catch {
      // The browser refused or could not complete the subscription
      // (push service unavailable, AbortError, permission race, …).
      // Honour this function's documented "returns true on success,
      // false otherwise" contract so callers can render a retry
      // affordance instead of crashing on an unhandled rejection.
      return false
    }

    if (!sub) return false

    const json = sub.toJSON() as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false

    try {
      await subscribeMut.mutateAsync({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      })
      setIsSubscribed(true)
      setCurrentEndpoint(json.endpoint)
      return true
    } catch {
      // Mutation already toasted — leave the browser-side subscription
      // in place so the user can retry without going through the
      // permission prompt again.
      return false
    }
  }, [permission, publicKey, requestPermission, subscribeMut])

  /**
   * Reverse of subscribe(): unregisters the server FIRST so it stops
   * sending immediately, then unsubscribes the browser. Order matters
   * — if we did the browser side first and the server call failed, the
   * server would keep pushing to a dead endpoint until it returned 410.
   */
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isPushAPISupported) return false

    let sub: PushSubscription | null = null
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) return false
      sub = await reg.pushManager.getSubscription()
    } catch {
      // Could not read the browser's registration/subscription state.
      // Report failure rather than throwing (mirrors subscribe()'s
      // "never throws" contract).
      return false
    }

    if (!sub) {
      setIsSubscribed(false)
      setCurrentEndpoint(null)
      return true
    }
    try {
      await unsubscribeMut.mutateAsync(sub.endpoint)
    } catch {
      // Even on server failure, proceed with browser-side unsubscribe
      // so the user gets the immediate effect they asked for. The
      // mutation already toasted.
    }
    try {
      await sub.unsubscribe()
    } catch {
      // Browser-side unsubscribe failed (rare). Still clear local state
      // so the UI reflects the user's intent; the next mount re-syncs
      // against pushManager truth.
    }
    setIsSubscribed(false)
    setCurrentEndpoint(null)
    return true
  }, [unsubscribeMut])

  return {
    permission,
    requestPermission,
    sendNotification,
    isSupported,
    isPushSupported: isPushAPISupported && !!publicKey,
    isSubscribed,
    currentEndpoint,
    subscribe,
    unsubscribe,
  }
}

