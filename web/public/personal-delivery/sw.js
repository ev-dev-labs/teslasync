function isCommuteComparison(url) {
  return url.pathname === '/settings/smart-commute' &&
    /^[1-9]\d*$/.test(url.searchParams.get('vehicle_id') ?? '') &&
    /^[a-f0-9]{32}$/.test(url.searchParams.get('traffic_occurrence_id') ?? '')
}

function isChargingDestination(url) {
  return ['/action-center', '/settings/smart-charging'].includes(url.pathname) &&
    !url.searchParams.has('fee_session_id')
}

function isPublicFeeReview(url) {
  return url.pathname === '/settings/smart-charging' && url.hash === '#public-fee' &&
    /^[1-9]\d*$/.test(url.searchParams.get('vehicle_id') ?? '') &&
    /^[1-9]\d*$/.test(url.searchParams.get('fee_session_id') ?? '')
}

function pathForNotification(url) {
  return `${url.pathname}${url.search}${isPublicFeeReview(url) ? url.hash : ''}`
}

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
    } else if (['charging', 'commute', 'public-fee'].includes(payload.kind)) {
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
        body: JSON.stringify(payload.kind === 'commute' || payload.kind === 'public-fee'
          ? { token: payload.token, kind: payload.kind }
          : { token: payload.token }),
      })
      if (!response.ok) return
      const result = await response.json()
      const notification = result?.data
      if (typeof notification?.title !== 'string' || typeof notification?.body !== 'string' ||
        typeof notification?.url !== 'string') return
      const url = new URL(notification.url, self.location.origin)
      const allowed = payload.kind === 'commute' ? isCommuteComparison(url)
        : payload.kind === 'public-fee' ? isPublicFeeReview(url) : isChargingDestination(url)
      if (url.origin !== self.location.origin || !allowed) return
      await self.registration.showNotification(notification.title, {
        body: notification.body,
        badge: '/icons/badge-72.png',
        data: { url: pathForNotification(url) },
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
        (isChargingDestination(url) || isCommuteComparison(url) || isPublicFeeReview(url))) {
        await self.clients.openWindow(pathForNotification(url))
      }
    } catch {
      // Old or malformed notification data is not a navigation target.
    }
  })())
})
