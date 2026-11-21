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

function isBackupChargingReview(url) {
  return url.pathname === '/settings/smart-charging' && url.hash === '#backup-charging' &&
    /^[1-9]\d*$/.test(url.searchParams.get('vehicle_id') ?? '') &&
    /^[1-9]\d*$/.test(url.searchParams.get('backup_watch_id') ?? '')
}

function isCabinPrepReview(url) {
  const vehicle = url.searchParams.get('vehicle_id')
  return url.pathname === '/preconditioning-effectiveness' && url.hash === '#cabin-prep-reminder' &&
    /^[1-9]\d*$/.test(vehicle ?? '') && url.searchParams.get('cabin_vehicle_id') === vehicle
}

function isParkReserveReview(url) {
  const vehicle = url.searchParams.get('vehicle_id')
  return url.pathname === '/vampire-drain' && url.hash === '#park-reserve' &&
    /^[1-9]\d*$/.test(vehicle ?? '') && url.searchParams.get('park_vehicle_id') === vehicle &&
    /^[1-9]\d*$/.test(url.searchParams.get('park_plan_id') ?? '')
}

function isWindowRainReview(url) {
  const vehicle = url.searchParams.get('vehicle_id')
  return url.pathname === '/security-access' && url.hash === '#window-rain' &&
    /^[1-9]\d*$/.test(vehicle ?? '') && url.searchParams.get('rain_vehicle_id') === vehicle &&
    /^[1-9]\d*$/.test(url.searchParams.get('rain_plan_id') ?? '')
}

function isParkedClosureReview(url) {
  return isParkedSecurityReview(url, 'parked-closure', 'closure')
}

function isParkedUnlockReview(url) {
  return isParkedSecurityReview(url, 'parked-unlock', 'unlock')
}

function isParkedSecurityReview(url, anchor, prefix) {
  const vehicle = url.searchParams.get('vehicle_id')
  return url.pathname === '/security-access' && url.hash === `#${anchor}` &&
    /^[1-9]\d*$/.test(vehicle ?? '') && url.searchParams.get(`${prefix}_vehicle_id`) === vehicle &&
    /^[1-9]\d*$/.test(url.searchParams.get(`${prefix}_plan_id`) ?? '') &&
    /^[1-9]\d*$/.test(url.searchParams.get(`${prefix}_park_id`) ?? '')
}

const privateReviews = new Map([
  ['commute', isCommuteComparison],
  ['public-fee', isPublicFeeReview],
  ['backup-charging', isBackupChargingReview],
  ['cabin-prep', isCabinPrepReview],
  ['park-reserve', isParkReserveReview],
  ['window-rain', isWindowRainReview],
  ['parked-closure', isParkedClosureReview],
  ['parked-unlock', isParkedUnlockReview],
])

function pathForNotification(url) {
  return `${url.pathname}${url.search}${[...privateReviews.values()].some(check => check(url)) ? url.hash : ''}`
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
    } else if (payload.kind === 'charging' || privateReviews.has(payload.kind)) {
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
        body: JSON.stringify(privateReviews.has(payload.kind)
          ? { token: payload.token, kind: payload.kind }
          : { token: payload.token }),
      })
      if (!response.ok) return
      const result = await response.json()
      const notification = result?.data
      if (typeof notification?.title !== 'string' || typeof notification?.body !== 'string' ||
        typeof notification?.url !== 'string') return
      const url = new URL(notification.url, self.location.origin)
      const allowed = (privateReviews.get(payload.kind) ?? isChargingDestination)(url)
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
        (isChargingDestination(url) || [...privateReviews.values()].some(check => check(url)))) {
        await self.clients.openWindow(pathForNotification(url))
      }
    } catch {
      // Old or malformed notification data is not a navigation target.
    }
  })())
})
