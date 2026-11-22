import type { Page, Worker } from '@playwright/test'

export async function installSyntheticSubscription(page: Page, name: string) {
  await page.addInitScript((device) => {
    if (!('PushManager' in window)) return
    const endpoint = `https://push.example.invalid/device-${device}`
    const key = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
    const auth = btoa(String.fromCharCode(...new Uint8Array(16))).replace(/=+$/, '')
    const makeSubscription = () => ({
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: key, auth } }),
      unsubscribe: async () => { sessionStorage.removeItem('synthetic-personal-push'); return true },
    })
    Object.defineProperty(PushManager.prototype, 'getSubscription', {
      configurable: true,
      value: async () => sessionStorage.getItem('synthetic-personal-push') ? makeSubscription() : null,
    })
    Object.defineProperty(PushManager.prototype, 'subscribe', {
      configurable: true,
      value: async () => { sessionStorage.setItem('synthetic-personal-push', '1'); return makeSubscription() },
    })
  }, name)
}

export async function dispatchPush(worker: Worker, payload: unknown) {
  return worker.evaluate(async (data) => {
    let pending: Promise<unknown> | undefined
    let status: number | 'network-error' | null = null
    let notification = 'not-called'
    const originalFetch = globalThis.fetch
    const registration = (globalThis as unknown as { registration: ServiceWorkerRegistration }).registration
    const originalShowNotification = registration.showNotification
    globalThis.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args)
        status = response.status
        return response
      } catch (error) {
        status = 'network-error'
        throw error
      }
    }
    registration.showNotification = async (title, options) => {
      try {
        await originalShowNotification.call(registration, title, options)
        notification = 'shown'
      } catch (error) {
        notification = error instanceof Error ? error.message : String(error)
        throw error
      }
    }
    const event = new Event('push') as Event & {
      data: { json: () => unknown }
      waitUntil: (promise: Promise<unknown>) => void
    }
    Object.defineProperty(event, 'data', { value: { json: () => data } })
    event.waitUntil = (promise) => { pending = promise }
    try {
      globalThis.dispatchEvent(event)
      await pending
      return { status, notification }
    } finally {
      globalThis.fetch = originalFetch
      registration.showNotification = originalShowNotification
    }
  }, payload)
}

export async function notifications(worker: Worker) {
  return worker.evaluate(async () => {
    const registration = (globalThis as unknown as { registration: ServiceWorkerRegistration }).registration
    return (await registration.getNotifications()).map(({ title, data }) => ({ title, data }))
  })
}

export async function clearNotifications(worker: Worker) {
  await worker.evaluate(async () => {
    const registration = (globalThis as unknown as { registration: ServiceWorkerRegistration }).registration
    for (const notification of await registration.getNotifications()) notification.close()
  })
}
