import { apiUrl } from '@/api/client'
import { urlBase64ToUint8Array } from '@/lib/webPushKey'

const scope = '/personal-delivery/'
const workerURL = `${scope}sw.js`

export function personalPushSupported(): boolean {
  if (typeof window === 'undefined' || !window.isSecureContext ||
    !('Notification' in window) || !('PushManager' in window) ||
    !('serviceWorker' in navigator)) return false
  try {
    const url = new URL(apiUrl('/smart-delivery/devices'), window.location.origin)
    return url.origin === window.location.origin && url.pathname === '/api/v1/smart-delivery/devices'
  } catch {
    return false
  }
}

async function personalRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  const registration = await navigator.serviceWorker.getRegistration(scope)
  return registration?.scope === new URL(scope, window.location.origin).href ? registration : undefined
}

export async function getPersonalSubscription(): Promise<PushSubscription | null> {
  if (!personalPushSupported()) return null
  const registration = await personalRegistration()
  return registration ? registration.pushManager.getSubscription() : null
}

async function waitForActivation(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active?.state === 'activated') return
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (!worker) throw new Error('Personal delivery worker is unavailable')
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error('Personal delivery worker activation timed out')), 15000)
    const finish = (error?: Error) => {
      window.clearTimeout(timer)
      worker.removeEventListener('statechange', check)
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      if (worker.state === 'activated') finish()
      else if (worker.state === 'redundant') finish(new Error('Personal delivery worker could not activate'))
    }
    worker.addEventListener('statechange', check)
    check()
  })
}

export async function subscribePersonalBrowser(publicKey: string): Promise<PushSubscription> {
  if (!personalPushSupported()) throw new Error('Personal browser delivery is unavailable')
  if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') {
    throw new Error('Notification permission was not granted')
  }
  const registration = await navigator.serviceWorker.register(workerURL, { scope })
  await waitForActivation(registration)
  return (await registration.pushManager.getSubscription()) ?? registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
}

export async function clearPersonalBrowser(): Promise<void> {
  if (!personalPushSupported()) return
  const registration = await personalRegistration()
  if (!registration) return
  const subscription = await registration.pushManager.getSubscription()
  if (subscription && !await subscription.unsubscribe()) throw new Error('Browser unsubscribe failed')
  if (!await registration.unregister()) throw new Error('Personal delivery worker removal failed')
}
