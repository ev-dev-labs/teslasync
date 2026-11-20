import { expect, test, type Page, type Worker } from '@playwright/test'
import { createHash } from 'node:crypto'
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi'

test.use({ serviceWorkers: 'allow' })
test.afterAll(async () => { await closeMockApiFixtures() })

async function dispatchPush(worker: Worker, payload: unknown) {
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

async function notifications(worker: Worker) {
  return worker.evaluate(async () => {
    const registration = (globalThis as unknown as {
      registration: { getNotifications: () => Promise<Array<{ title: string; data: unknown }>> }
    }).registration
    return (await registration.getNotifications()).map(({ title, data }) => ({ title, data }))
  })
}

async function installFixtures(page: Page, subject: string, theme: 'dark' | 'light') {
  const api = await installApiMocks(page, 'populated', theme)
  if (!api) throw new Error('Missing isolated API fixtures')
  await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
    json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
  }))
  await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
    if (route.request().method() !== 'GET') return route.fallback()
    return fulfillApiFixture(route, api, {
      json: {
        scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'),
        pack_id: theme === 'light' ? 'v6' : 'blueprint', app_wide: true,
      },
    })
  })
  await page.route(url => url.pathname === '/api/v1/geofences', route => fulfillApiFixture(route, api, {
    json: [{
      id: 9, name: 'Synthetic charging place', polygon_wkt: 'POLYGON EMPTY',
      enabled: true, needs_review: false, is_charging_location: true, origin: 'manual',
      alert_on_entry: false, alert_on_exit: false, latitude: 47.1, longitude: -122.1, radius: 100,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    }],
  }))
  await page.route(url => url.pathname.startsWith('/api/v1/smart-delivery') ||
    url.pathname.startsWith('/api/v1/smart-charging') || url.pathname === '/api/v1/action-center',
  async route => {
    expect(route.request().headers()['x-teslasync-expected-principal']).toBe(`subject:${subject}`)
    await forwardLocalApiFixture(route, api, route.request().headers())
  })
  return api
}

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark' },
] as const) {
  test(`verified personal charging delivery: ${variant.name}`, async ({ page, context }) => {
    test.skip(process.env.SMART_PERSONAL_REAL_BACKEND !== '1', 'Requires the isolated real-handler fixture')
    test.setTimeout(120_000)
    const origin = process.env.E2E_BASE_URL
    if (!origin) throw new Error('A local fixture server is required')
    const subject = `synthetic-personal-a-${variant.name}`
    const otherSubject = `synthetic-personal-b-${variant.name}`
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await context.grantPermissions(['notifications'], { origin })
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }])
    await seedBrowserState(page, variant.theme, '/settings', { allowServiceWorkers: true })
    await page.addInitScript((name) => {
      if (!('PushManager' in window)) return
      const endpoint = `https://push.example.invalid/device-${name}`
      const key = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
      const makeSubscription = () => ({
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: key, auth: 'tBHItJI5svbpez7KI4CCXg' } }),
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
    }, variant.name)
    const api = await installFixtures(page, subject, variant.theme)
    await page.goto('/settings/smart-charging?vehicle_id=7')
    await waitForHarnessReady(page, api)
    await expect(page.getByText(/Charging push is off by default/)).toBeVisible()
    const previousResponse = await page.request.get(`${origin}/__fixture/latest-push`)
    const previousToken = previousResponse.status() === 200 ? (await previousResponse.json()).token : null
    await page.getByRole('button', { name: 'Connect this browser' }).click()
    await expect.poll(async () => {
      const response = await page.request.get(`${origin}/__fixture/latest-push`)
      if (response.status() !== 200) return false
      const payload = await response.json()
      return payload.kind === 'verify' && payload.token !== previousToken
    }).toBe(true)
    const verification = await (await page.request.get(`${origin}/__fixture/latest-push`)).json()
    await expect.poll(() => context.serviceWorkers().some(worker =>
      worker.url().endsWith('/personal-delivery/sw.js'))).toBe(true)
    const worker = context.serviceWorkers().find(item => item.url().endsWith('/personal-delivery/sw.js'))
    if (!worker) throw new Error('Personal delivery worker did not start')
    expect(await dispatchPush(worker, verification)).toEqual({ status: 200, notification: 'shown' })
    await expect.poll(() => notifications(worker)).toEqual([
      { title: 'TeslaSync device confirmation', data: { url: '/settings/smart-charging' } },
    ])
    await worker.evaluate(async () => {
      const registration = (globalThis as unknown as {
        registration: { getNotifications: () => Promise<Array<{ close: () => void }>> }
      }).registration
      for (const notification of await registration.getNotifications()) notification.close()
    })
    const consent = page.getByRole('switch', { name: 'Allow charging readiness notifications on This browser' })
    await expect(consent).toBeEnabled()
    await expect(consent).not.toBeChecked()
    await consent.click()
    await expect(consent).toBeChecked()

    await page.getByRole('button', { name: 'Add a trip plan' }).click()
    await page.getByLabel(/Known charging place/).selectOption('9')
    const inputTime = (ms: number) => new Date(ms).toISOString().slice(0, 16)
    await page.getByLabel(/Check from/).fill(inputTime(Date.now() - 10 * 60_000))
    await page.getByLabel(/Planned departure/).fill(inputTime(Date.now() + 6 * 60 * 60_000))
    await page.getByLabel(/Estimated round-trip use, low/).fill('35')
    await page.getByLabel(/Estimated round-trip use, high/).fill('45')
    await page.getByLabel(/Desired return reserve/).fill('20')
    await page.getByRole('switch', { name: 'Enable readiness checks for this plan' }).click()
    await page.getByRole('button', { name: 'Save plan' }).click()
    await expect(page.getByText(/Status: Active/)).toBeVisible()
    expect((await page.request.post(`${origin}/__fixture/process`)).status()).toBe(204)
    const push = await (await page.request.get(`${origin}/__fixture/latest-push`)).json()
    expect(push.kind).toBe('charging')
    expect(Object.keys(push).sort()).toEqual(['kind', 'token'])
    await assertMockApiComplete(page, api, { preserveServiceWorkers: true })
    await page.close()

    await context.addCookies([{ name: 'personal_test_subject', value: otherSubject, url: origin }])
    expect(await dispatchPush(worker, push)).toEqual({ status: 404, notification: 'not-called' })
    expect(await notifications(worker)).toEqual([])
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }])
    expect(await dispatchPush(worker, push)).toEqual({ status: 200, notification: 'shown' })
    await expect.poll(() => notifications(worker)).toEqual([
      { title: 'Charging readiness', data: { url: '/action-center?vehicle_id=7' } },
    ])

    const next = await context.newPage()
    await next.setViewportSize({ width: variant.width, height: variant.height })
    await seedBrowserState(next, variant.theme, '/action-center', { allowServiceWorkers: true })
    const nextApi = await installFixtures(next, subject, variant.theme)
    await next.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(next, nextApi, { initialRenderTimeoutMs: 30_000 })
    const card = next.getByRole('article', { name: 'Plug in before your planned trip' })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Snooze for 1 hour' }).click()
    await expect(card).toHaveCount(0)
    await assertMockApiComplete(next, nextApi)
  })
}
