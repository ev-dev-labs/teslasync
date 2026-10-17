import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useSubscribePush, useUnsubscribePush, usePushPublicKey } from '@/api/hooks/usePush'

const isSupported = typeof window !== 'undefined' && 'Notification' in window
const isPushAPISupported =
  typeof window !== 'undefined' &&
  'PushManager' in window &&
  'serviceWorker' in navigator

const permissionListeners = new Set<() => void>()
let permissionTimer: number | undefined
let cachedPermission: NotificationPermission = isSupported ? Notification.permission : 'denied'

function getPermissionSnapshot(): NotificationPermission {
  return cachedPermission
}

function updatePermission(permission: NotificationPermission) {
  if (permission === cachedPermission) return
  cachedPermission = permission
  for (const listener of permissionListeners) listener()
}

function refreshPermission() {
  updatePermission(isSupported ? Notification.permission : 'denied')
}

function subscribePermission(listener: () => void) {
  if (permissionListeners.size === 0) {
    refreshPermission()
    window.addEventListener('focus', refreshPermission)
    document.addEventListener('visibilitychange', refreshPermission)
    // Browser settings can change while the tab stays focused; reading permission
    // never prompts the user. Share one poll across all mounted consumers.
    if (isSupported) permissionTimer = window.setInterval(refreshPermission, 1000)
  }
  permissionListeners.add(listener)
  return () => {
    permissionListeners.delete(listener)
    if (permissionListeners.size === 0) {
      window.removeEventListener('focus', refreshPermission)
      document.removeEventListener('visibilitychange', refreshPermission)
      window.clearInterval(permissionTimer)
      permissionTimer = undefined
    }
  }
}

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
  const permission = useSyncExternalStore(
    subscribePermission, getPermissionSnapshot, getPermissionSnapshot,
  )
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false)
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null)
  const [browserSubscriptionStatus, setBrowserSubscriptionStatus] = useState<
    'checking' | 'error' | 'absent' | 'subscribed' | 'unsupported'
  >(isSupported && isPushAPISupported ? 'checking' : 'unsupported')
  const [browserSubscriptionError, setBrowserSubscriptionError] = useState<Error | null>(null)
  const [lookupAttempt, setLookupAttempt] = useState(0)
  const retryBrowserSubscription = useCallback(() => {
    if (!isSupported || !isPushAPISupported) return
    setBrowserSubscriptionStatus('checking')
    setBrowserSubscriptionError(null)
    setLookupAttempt((attempt) => attempt + 1)
  }, [])

  const { data: publicKey } = usePushPublicKey()
  const subscribeMut = useSubscribePush()
  const unsubscribeMut = useUnsubscribePush({ notifySuccess: false })
  const pendingServerRemovals = useRef(new Set<string>())

  /**
   * Reflect the existing browser-side subscription (if any) into local
   * state so the UI knows whether to render "Enable" or "Disable" on
   * mount. We deliberately read `pushManager.getSubscription()` — that
   * is the only authoritative source for "is THIS device registered".
   * The server's per-device list is a superset (other devices too).
   */
  useEffect(() => {
    if (!isSupported || !isPushAPISupported) return
    let cancelled = false
    void Promise.resolve()
      .then(() => navigator.serviceWorker.getRegistration())
      .then(async (reg) => {
        if (cancelled) return
        const sub = reg ? await reg.pushManager.getSubscription() : null
        if (cancelled) return
        setIsSubscribed(!!sub)
        setCurrentEndpoint(sub?.endpoint ?? null)
        setBrowserSubscriptionStatus(sub ? 'subscribed' : 'absent')
        setBrowserSubscriptionError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setBrowserSubscriptionStatus('error')
        setBrowserSubscriptionError(error instanceof Error ? error : new Error(String(error)))
      })
    return () => {
      cancelled = true
    }
  }, [lookupAttempt])

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) return 'denied'
    const result = await Notification.requestPermission()
    updatePermission(result)
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
    if (!isSupported || !isPushAPISupported || !publicKey) return false

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
    setIsSubscribed(true)
    setCurrentEndpoint(sub.endpoint)
    setBrowserSubscriptionStatus('subscribed')
    setBrowserSubscriptionError(null)

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
    let reg: ServiceWorkerRegistration | undefined
    try {
      reg = await navigator.serviceWorker.getRegistration()
      sub = reg ? await reg.pushManager.getSubscription() : null
    } catch (error) {
      // Could not read the browser's registration/subscription state.
      // Report failure rather than throwing (mirrors subscribe()'s
      // "never throws" contract).
      setBrowserSubscriptionStatus('error')
      setBrowserSubscriptionError(error instanceof Error ? error : new Error(String(error)))
      return false
    }

    const endpoints = new Set(pendingServerRemovals.current)
    if (currentEndpoint) endpoints.add(currentEndpoint)
    if (sub) endpoints.add(sub.endpoint)
    let serverRemoved = true
    for (const endpoint of endpoints) {
      try {
        await unsubscribeMut.mutateAsync(endpoint)
        pendingServerRemovals.current.delete(endpoint)
      } catch {
        // Browser removal can succeed while this server endpoint remains.
        // Retain its identity for retries after getSubscription() returns null.
        serverRemoved = false
        pendingServerRemovals.current.add(endpoint)
      }
    }
    let browserRemoved = true
    try {
      if (sub) browserRemoved = await sub.unsubscribe()
    } catch {
      browserRemoved = false
    }
    try {
      const remaining = reg ? await reg.pushManager.getSubscription() : null
      setIsSubscribed(!!remaining)
      setCurrentEndpoint(remaining?.endpoint ?? null)
      setBrowserSubscriptionStatus(remaining ? 'subscribed' : 'absent')
      setBrowserSubscriptionError(null)
      return serverRemoved && browserRemoved && !remaining
    } catch (error) {
      setBrowserSubscriptionStatus('error')
      setBrowserSubscriptionError(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }, [currentEndpoint, unsubscribeMut])

  return {
    permission,
    requestPermission,
    sendNotification,
    isSupported,
    isPushSupported: isPushAPISupported && !!publicKey,
    isPushAPISupported,
    browserSubscriptionStatus,
    browserSubscriptionError,
    retryBrowserSubscription,
    isSubscribed,
    currentEndpoint,
    subscribe,
    unsubscribe,
  }
}
