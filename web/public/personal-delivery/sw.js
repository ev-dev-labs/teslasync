self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload
    try {
      payload = event.data?.json()
    } catch {
      return
    }
    if (!payload || typeof payload.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.token)) return

    let path
    if (payload.kind === 'verify' && Number.isSafeInteger(payload.device_id) && payload.device_id > 0) {
      path = `/api/v1/smart-delivery/devices/${payload.device_id}/verify`
    } else if (payload.kind === 'charging') {
      path = '/api/v1/smart-delivery/deliveries/claim'
    } else {
      return
    }

    try {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: payload.token }),
      })
      if (!response.ok) return
      const result = await response.json()
      const notification = result?.data
      if (typeof notification?.title !== 'string' || typeof notification?.body !== 'string' ||
        typeof notification?.url !== 'string') return
      const url = new URL(notification.url, self.location.origin)
      if (url.origin !== self.location.origin ||
        !['/action-center', '/settings/smart-charging'].includes(url.pathname)) return
      await self.registration.showNotification(notification.title, {
        body: notification.body,
        badge: '/icons/badge-72.png',
        data: { url: `${url.pathname}${url.search}` },
      })
    } catch {
      // An expired session or revoked consent must not reveal recommendation details.
    }
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    try {
      const url = new URL(event.notification.data?.url, self.location.origin)
      if (url.origin === self.location.origin &&
        ['/action-center', '/settings/smart-charging'].includes(url.pathname)) {
        await self.clients.openWindow(`${url.pathname}${url.search}`)
      }
    } catch {
      // Old or malformed notification data is not a navigation target.
    }
  })())
})
