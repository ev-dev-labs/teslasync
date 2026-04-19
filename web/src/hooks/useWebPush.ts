import { useState, useCallback } from 'react'

const isSupported = typeof window !== 'undefined' && 'Notification' in window

/**
 * Hook for managing browser Notification API permissions and sending
 * notifications. Uses the basic Notification API (not Push API with
 * VAPID keys) — works when the app tab is open.
 */
export function useWebPush() {
  const [permission, setPermission] = useState<NotificationPermission>(
    isSupported ? Notification.permission : 'denied',
  )

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) return 'denied'
    const result = await Notification.requestPermission()
    setPermission(result)
    return result
  }, [])

  const sendNotification = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (!isSupported || permission !== 'granted') return null
      const n = new Notification(title, {
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        ...options,
      })
      // Focus the app tab when the notification is clicked
      n.onclick = () => {
        window.focus()
        n.close()
      }
      return n
    },
    [permission],
  )

  return { permission, requestPermission, sendNotification, isSupported }
}
