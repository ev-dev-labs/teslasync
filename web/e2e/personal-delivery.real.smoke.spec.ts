import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi'
import { clearNotifications, dispatchPush, installSyntheticSubscription, notifications } from './personalDeliveryFixture'

test.use({ serviceWorkers: 'allow' })
test.afterAll(async () => { await closeMockApiFixtures() })

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
  if (subject.includes('-early-stop-')) {
    const inspectionReads = new Map<string, object | null>([
      ['/api/v1/vehicles/7/settings', {}],
      ['/api/v1/vehicles/7/silence', {}],
      ['/api/v1/motor/latest', null],
      ['/api/v1/tire-pressure/latest', null],
      ['/api/v1/vehicle-config/latest', null],
      ['/api/v1/charge-autopilot/decision', null],
    ])
    await page.route(url => inspectionReads.has(url.pathname), route => {
      if (route.request().method() !== 'GET') return route.fallback()
      return fulfillApiFixture(route, api, { json: inspectionReads.get(new URL(route.request().url()).pathname) ?? null })
    })
  }
  await page.route(url => url.pathname.startsWith('/api/v1/smart-delivery') ||
    url.pathname.startsWith('/api/v1/smart-charging') || url.pathname === '/api/v1/action-center' ||
    (subject.includes('-early-stop-') && url.pathname === '/api/v1/charging-telemetry/latest'),
  async route => {
    const url = new URL(route.request().url())
    const headers = await route.request().allHeaders()
    if (url.pathname === '/api/v1/smart-charging/solar/connection/callback') {
      expect(route.request().isNavigationRequest()).toBe(true)
      await forwardLocalApiFixture(route, api, headers)
      return
    }
    if (url.pathname === '/api/v1/charging-telemetry/latest') {
      expect(route.request().method()).toBe('GET')
      expect(url.searchParams.get('vehicle_id')).toBe('7')
    } else {
      expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`)
    }
    if (route.request().method() === 'GET' &&
      ['/api/v1/smart-charging/shared-chargers', '/api/v1/smart-charging/shared-trips'].includes(url.pathname)) {
      // Shared planning is exercised by its own mounted journeys, not this server.
      await fulfillApiFixture(route, api, { json: { data: { can_manage: false, owned: [], invitations: [] } } })
      return
    }
    await forwardLocalApiFixture(route, api, headers)
  })
  return api
}

test('solar consent produces a private read-only charging opportunity', async ({ page, context }) => {
  test.skip(process.env.SMART_PERSONAL_REAL_BACKEND !== '1', 'Requires the isolated real-handler fixture')
  test.setTimeout(120_000)
  const origin = process.env.E2E_BASE_URL
  if (!origin) throw new Error('A local fixture server is required')
  const subject = 'synthetic-personal-a-solar'
  const foreign = 'synthetic-personal-b-solar'
  const title = 'There may be surplus solar available to charge'
  const writes: string[] = []
  context.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/') && request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`)
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }])
  await seedBrowserState(page, 'light', '/settings', { allowServiceWorkers: true })
  const api = await installFixtures(page, subject, 'light')
  expect((await page.request.post(`${origin}/__fixture/solar-clock`)).status()).toBe(204)
  await page.goto('/settings/smart-charging?vehicle_id=7#solar-charging')
  await waitForHarnessReady(page, api)
  const settings = page.getByRole('region', { name: 'Solar charging opportunities' })
  await expect(settings.getByText(/^Off by default/)).toBeVisible()
  await expect(settings.getByText(title)).toHaveCount(0)
  await settings.getByLabel('Tesla Energy site ID').fill('44')
  await settings.getByRole('button', { name: 'Connect read-only Tesla Energy' }).click()
  await page.getByRole('link', { name: 'Allow read-only access' }).click()
  await expect(page).toHaveURL(/vehicle_id=7&solar=connected#solar-charging$/)
  await expect(settings.getByText('Solar checks are off for this vehicle.')).toBeVisible()
  await settings.getByLabel('Home charger').selectOption('9')
  await settings.getByRole('button', { name: 'Enable solar checks for this vehicle' }).click()
  await expect(settings.getByText(/^No current opportunity/)).toBeVisible()
  expect((await page.request.post(`${origin}/__fixture/process-solar`)).status()).toBe(204)
  await page.goto('/action-center?vehicle_id=7')
  const card = page.getByRole('article', { name: title })
  await expect(card).toBeVisible()
  await expect(card.getByText(/across 4 readings/)).toBeVisible()
  await card.getByRole('button', { name: 'Open source' }).click()
  await expect(page).toHaveURL(/vehicle_id=7#solar-charging$/)
  await expect(settings.getByText(title)).toBeVisible()
  await expect(settings.getByRole('link', { name: 'Review charging activity' })).toBeVisible()

  await assertMockApiComplete(page, api, { preserveServiceWorkers: true })
  const foreignPage = await context.newPage()
  await context.addCookies([{ name: 'personal_test_subject', value: foreign, url: origin }])
  const foreignApi = await installFixtures(foreignPage, foreign, 'light')
  await foreignPage.goto('/action-center?vehicle_id=7')
  await waitForHarnessReady(foreignPage, foreignApi)
  await expect(foreignPage.getByRole('article', { name: title })).toHaveCount(0)
  await foreignPage.close()
  await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }])
  await page.reload()
  await expect(settings.getByText(title)).toBeVisible()
  await settings.getByRole('button', { name: 'Disconnect Tesla Energy and remove all solar plans' }).click()
  await expect(settings.getByLabel('Tesla Energy site ID')).toBeVisible()
  await expect(settings.getByText(title)).toHaveCount(0)
  await page.goto('/action-center?vehicle_id=7')
  await waitForHarnessReady(page, api)
  await expect(page.getByRole('article', { name: title })).toHaveCount(0)
  await assertMockApiComplete(page, api, { preserveServiceWorkers: true })
  expect(writes.filter(path => /smart-charging\/solar|commands/.test(path))).toEqual([
    'POST /api/v1/smart-charging/solar/connection', 'PUT /api/v1/smart-charging/solar',
    'DELETE /api/v1/smart-charging/solar/connection',
  ])
})

const deliveryLayouts = [
  { name: 'desktop', width: 1440, height: 900, theme: 'light' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark' },
] as const

for (const variant of deliveryLayouts) {
  test(`household backup charging: ${variant.name}`, async ({ page, context }) => {
    test.skip(process.env.SMART_PERSONAL_REAL_BACKEND !== '1', 'Requires the isolated real-handler fixture')
    test.setTimeout(120_000)
    const origin = process.env.E2E_BASE_URL
    if (!origin) throw new Error('A local fixture server is required')
    const subject = `synthetic-personal-a-backup-${variant.name}`
    const foreign = `synthetic-personal-b-backup-${variant.name}`
    const title = 'Vehicle charging is drawing from household backup'
    const reviewPath = '/settings/smart-charging?vehicle_id=7#backup-charging'
    const writes: string[] = []
    const applicationErrors: Array<{ name: string; message: string; route: string }> = []
    context.on('request', request => {
      const { pathname } = new URL(request.url())
      if (pathname.startsWith('/api/v1/') && request.method() !== 'GET') writes.push(`${request.method()} ${pathname}`)
      if (pathname === '/api/v1/web-errors' && request.method() === 'POST') {
        const { name, message, route } = request.postDataJSON()
        applicationErrors.push({ name, message, route })
      }
    })
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await context.grantPermissions(['notifications'], { origin })
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }])
    await seedBrowserState(page, variant.theme, '/settings', { allowServiceWorkers: true })
    await installSyntheticSubscription(page, `backup-${variant.name}`)
    const api = await installFixtures(page, subject, variant.theme)
    const tick = async (target: Page, phase: string) => {
      expect((await target.request.post(`${origin}/__fixture/backup-tick?phase=${phase}`)).status()).toBe(204)
    }
    const latest = async (target: Page) => {
      const response = await target.request.get(`${origin}/__fixture/latest-push`)
      return response.status() === 200 ? await response.json() as { kind: string; token: string } : null
    }
    await tick(page, 'prepare')
    await page.goto(reviewPath)
    await waitForHarnessReady(page, api)
    const settings = page.getByRole('region', { name: 'Charging on household backup' })
    const start = settings.getByRole('button', { name: 'Watch this outage for one hour' })
    await expect(settings.getByText(/^Off by default/)).toBeVisible()
    await expect(settings.getByText(/^Verify a browser and enable charging notifications/)).toBeVisible()
    await expect(start).toBeDisabled()
    const previous = await latest(page)
    await page.getByRole('button', { name: 'Connect this browser' }).click()
    await expect.poll(async () => {
      const verification = await latest(page)
      return verification?.kind === 'verify' && verification.token !== previous?.token
    }).toBe(true)
    const verification = await latest(page)
    await expect.poll(() => context.serviceWorkers().some(worker => worker.url().endsWith('/personal-delivery/sw.js'))).toBe(true)
    const worker = context.serviceWorkers().find(item => item.url().endsWith('/personal-delivery/sw.js'))
    if (!worker || !verification) throw new Error('Personal delivery device verification did not start')
    expect(await dispatchPush(worker, verification)).toEqual({ status: 200, notification: 'shown' })
    await clearNotifications(worker)
    const consent = page.getByRole('switch', { name: 'Allow charging readiness notifications on This browser' })
    await expect(consent).toBeEnabled()
    await consent.click()
    await expect(consent).toBeChecked()
    await settings.getByLabel('Backed-up charging place').selectOption('9')
    const browser = settings.getByLabel('Verified browser', { exact: true })
    await expect(browser.getByRole('option', { name: /^Browser \d+$/ })).toHaveCount(1)
    await browser.selectOption({ index: 1 })
    await settings.getByRole('switch', { name: /I verified this charger/ }).click()
    await expect(start).toBeDisabled()
    await settings.getByRole('switch', { name: /I confirmed a current utility outage/ }).click()
    await start.click()
    await expect(settings.getByText(/^Watching until/)).toBeVisible()
    await tick(page, 'initial')
    expect(await latest(page)).toEqual(verification)
    await tick(page, 'qualified')
    const push = await latest(page)
    expect(push).toMatchObject({ kind: 'backup-charging' })
    if (!push) throw new Error('Expected one opaque private charging push')
    expect(Object.keys(push).sort()).toEqual(['kind', 'token'])
    await assertMockApiComplete(page, api, { preserveServiceWorkers: true })
    await page.close()

    await context.addCookies([{ name: 'personal_test_subject', value: foreign, url: origin }])
    expect(await dispatchPush(worker, push)).toEqual({ status: 404, notification: 'not-called' })
    const foreignPage = await context.newPage()
    const foreignApi = await installFixtures(foreignPage, foreign, variant.theme)
    await foreignPage.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(foreignPage, foreignApi)
    await expect(foreignPage.getByRole('article', { name: title })).toHaveCount(0)
    await assertMockApiComplete(foreignPage, foreignApi, { preserveServiceWorkers: true })
    await foreignPage.close()
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }])
    expect(await dispatchPush(worker, push)).toEqual({ status: 200, notification: 'shown' })
    expect(await dispatchPush(worker, push)).toEqual({ status: 404, notification: 'not-called' })
    const shown = await notifications(worker)
    expect(shown).toEqual([{ title: 'Charging readiness', data: { url: expect.stringMatching(
      /^\/settings\/smart-charging\?vehicle_id=7&backup_watch_id=\d+#backup-charging$/,
    ) } }])
    const next = await context.newPage()
    await next.setViewportSize({ width: variant.width, height: variant.height })
    await seedBrowserState(next, variant.theme, '/action-center', { allowServiceWorkers: true })
    const nextApi = await installFixtures(next, subject, variant.theme)
    await next.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(next, nextApi)
    const card = next.getByRole('article', { name: title })
    await expect(card).toContainText(/Two consistent readings/)
    await expect(card).toContainText(/not a backup runtime forecast/)
    await card.getByRole('button', { name: 'Open source' }).click()
    await expect(next).toHaveURL(origin + shown[0].data.url)
    const review = next.getByRole('region', { name: 'Charging on household backup' })
    await expect(review.getByText(title)).toBeVisible()
    await expect(review.getByRole('link', { name: 'Review charging telemetry' })).toHaveAttribute('href', '/vehicles/7#vehicle-systems')
    await tick(next, 'recovered')
    await next.reload()
    await expect(review.getByText(/^This watch ended/)).toBeVisible()
    await expect(review.getByText(title)).toHaveCount(0)
    await review.getByRole('button', { name: 'Stop and remove this watch' }).click()
    await expect(review.getByText(/^This private watch is no longer available/)).toBeVisible()
    await next.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(next, nextApi)
    await expect(card).toHaveCount(0)
    expect(await latest(next)).toEqual(push)
    await assertMockApiComplete(next, nextApi, { preserveServiceWorkers: true })
    expect(applicationErrors).toEqual([])
    const appBookkeeping = new Set(['POST /api/v1/pinned', 'POST /api/v1/web-vitals'])
    expect(writes.filter(write => !write.includes('/smart-delivery/') && !appBookkeeping.has(write))).toEqual([
      'POST /api/v1/smart-charging/backup-charging',
      'DELETE /api/v1/smart-charging/backup-charging',
    ])
  })
}

for (const variant of deliveryLayouts) {
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
    await installSyntheticSubscription(page, variant.name)
    const api = await installFixtures(page, subject, variant.theme)
    expect((await page.request.post(`${origin}/__fixture/process?phase=prepare`)).status()).toBe(204)
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
    await clearNotifications(worker)
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
    if (variant.name === 'desktop') {
      await page.getByRole('switch', { name: 'Estimate outbound and return separately' }).click()
      await page.getByLabel(/Outbound use, low/).fill('20')
      await page.getByLabel(/Outbound use, high/).fill('25')
      await page.getByLabel(/Return use, low/).fill('20')
      await page.getByLabel(/Return use, high/).fill('30')
    } else {
      await page.getByLabel(/Estimated round-trip use, low/).fill('35')
      await page.getByLabel(/Estimated round-trip use, high/).fill('45')
    }
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
    if (variant.name === 'desktop') {
      await expect(card).toContainText(/estimated charge at the destination is 20(?:\.0+)?-25(?:\.0+)?%/)
      await expect(card).toContainText(/estimated return charge is 0(?:\.0+)?-5(?:\.0+)?%/)
      await card.getByRole('button', { name: 'Open source' }).click()
      await expect(next).toHaveURL(/\/settings\/smart-charging\?vehicle_id=7$/)
      await next.getByRole('button', { name: 'Record or update destination charging' }).click()
      await next.getByLabel(/Planned charge added at destination/).fill('35')
      await next.getByRole('button', { name: 'Save plan' }).click()
      await expect(next.getByText(/Planned destination charge: 35(?:\.0+)?% added; not confirmed/)).toBeVisible()
      expect((await next.request.post(`${origin}/__fixture/process`)).status()).toBe(204)
      expect(await (await next.request.get(`${origin}/__fixture/latest-push`)).json()).toEqual(push)
      await next.goto('/action-center?vehicle_id=7')
      await waitForHarnessReady(next, nextApi)
      await expect(card).toHaveCount(0)
    } else {
      await card.getByRole('button', { name: 'Snooze for 1 hour' }).click()
      await expect(card).toHaveCount(0)
    }
    await assertMockApiComplete(next, nextApi)
  })
}

for (const variant of deliveryLayouts) {
  test(`early charging interruption: ${variant.name}`, async ({ page, context }) => {
    test.skip(process.env.SMART_PERSONAL_REAL_BACKEND !== '1', 'Requires the isolated real-handler fixture')
    test.setTimeout(120_000)
    const origin = process.env.E2E_BASE_URL
    if (!origin) throw new Error('A local fixture server is required')
    const subject = `synthetic-personal-a-early-stop-${variant.name}`
    const foreign = `synthetic-personal-b-early-stop-${variant.name}`
    const title = 'Inspect charging before your planned departure'
    const settings = '/settings/smart-charging?vehicle_id=7'
    const inbox = '/action-center?vehicle_id=7'
    const writes: string[] = []
    context.on('request', request => {
      const { pathname } = new URL(request.url())
      if (pathname.startsWith('/api/v1/') && request.method() !== 'GET') writes.push(`${request.method()} ${pathname}`)
    })
    const phase = async (name: string) => {
      expect((await context.request.post(`${origin}/__fixture/process-early-stop?phase=${name}`)).status()).toBe(204)
    }
    const latestPush = async () => {
      const response = await context.request.get(`${origin}/__fixture/latest-push`)
      return response.status() === 200 ? response.json() : null
    }
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await context.grantPermissions(['notifications'], { origin })
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }])
    await seedBrowserState(page, variant.theme, '/settings', { allowServiceWorkers: true })
    await installSyntheticSubscription(page, `early-stop-${variant.name}`)
    const api = await installFixtures(page, subject, variant.theme)
    await phase('prepare')
    await page.goto(settings)
    await waitForHarnessReady(page, api)

    const previous = await latestPush()
    await page.getByRole('button', { name: 'Connect this browser' }).click()
    await expect.poll(async () => {
      const current = await latestPush()
      return current?.kind === 'verify' && current.token !== previous?.token
    }).toBe(true)
    const verification = await latestPush()
    await expect.poll(() => context.serviceWorkers().some(worker =>
      worker.url().endsWith('/personal-delivery/sw.js'))).toBe(true)
    const worker = context.serviceWorkers().find(item => item.url().endsWith('/personal-delivery/sw.js'))
    if (!worker) throw new Error('Personal delivery worker did not start')
    expect(await dispatchPush(worker, verification)).toEqual({ status: 200, notification: 'shown' })
    await clearNotifications(worker)
    const consent = page.getByRole('switch', { name: 'Allow charging readiness notifications on This browser' })
    await expect(consent).toBeEnabled()
    await consent.click()
    await expect(consent).toBeChecked()

    await page.getByRole('button', { name: 'Add a trip plan' }).click()
    const watch = page.getByRole('switch', { name: 'Watch for early charging interruptions' })
    await expect(watch).not.toBeChecked()
    await page.getByLabel(/Known charging place/).selectOption('9')
    const inputTime = (ms: number) => new Date(ms).toISOString().slice(0, 16)
    await page.getByLabel(/Check from/).fill(inputTime(Date.now() - 10 * 60_000))
    await page.getByLabel(/Planned departure/).fill(inputTime(Date.now() + 6 * 60 * 60_000))
    await page.getByLabel(/Estimated round-trip use, low/).fill('35')
    await page.getByLabel(/Estimated round-trip use, high/).fill('45')
    await page.getByLabel(/Desired return reserve/).fill('20')
    await watch.press('Space')
    await expect(watch).toBeChecked()
    await page.getByRole('switch', { name: 'Enable readiness checks for this plan' }).click()
    await page.getByRole('button', { name: 'Save plan' }).click()
    await expect(page.getByText(/Status: Active/)).toBeVisible()
    await assertMockApiComplete(page, api, { preserveServiceWorkers: true })
    await page.close()

    await phase('grace')
    expect(await latestPush()).toEqual(verification)
    await phase('elapsed')
    const push = await latestPush()
    expect(push.kind).toBe('charging')
    expect(Object.keys(push).sort()).toEqual(['kind', 'token'])
    await context.addCookies([{ name: 'personal_test_subject', value: foreign, url: origin }])
    expect(await dispatchPush(worker, push)).toEqual({ status: 404, notification: 'not-called' })
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }])
    expect(await dispatchPush(worker, push)).toEqual({ status: 200, notification: 'shown' })
    await expect.poll(() => notifications(worker)).toEqual([
      { title: 'Charging readiness', data: { url: inbox } },
    ])

    const next = await context.newPage()
    await next.setViewportSize({ width: variant.width, height: variant.height })
    await seedBrowserState(next, variant.theme, '/action-center', { allowServiceWorkers: true })
    const nextApi = await installFixtures(next, subject, variant.theme)
    await next.goto(inbox)
    await waitForHarnessReady(next, nextApi)
    const card = next.getByRole('article', { name: title })
    await expect(card).toBeVisible()
    await expect(card).toContainText('the vehicle reported no charging power')
    const beforeInspection = writes.slice()
    const inspection = next.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === '/api/v1/charging-telemetry/latest' && url.searchParams.get('vehicle_id') === '7'
        && response.request().method() === 'GET'
    })
    await card.getByRole('button', { name: 'Open source' }).click()
    await expect(next).toHaveURL(/\/vehicles\/7#vehicle-systems$/)
    const source = await inspection
    expect(source.ok()).toBe(true)
    expect(await source.json()).toMatchObject({ charging_state: 'NoPower' })
    await expect(next.getByRole('region', { name: 'Returned charging measurements' })).toContainText('NoPower')
    expect(writes).toEqual(beforeInspection)
    expect(await next.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await phase('resumed')
    await next.goto(inbox)
    await waitForHarnessReady(next, nextApi)
    await expect(card).toHaveCount(0)
    expect(await latestPush()).toEqual(push)
    await next.goto(settings)
    await next.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(next.getByText(/Status: Paused/)).toBeVisible()
    await assertMockApiComplete(next, nextApi, { preserveServiceWorkers: true })
    expect(writes.filter(write => /\/commands|\/charge\/(start|stop)|\/schedule\/apply|\/wake/.test(write))).toEqual([])
  })
}

test('reviewed public charging fee reaches only the verified browser', async ({ page, context }) => {
  test.skip(process.env.SMART_PERSONAL_REAL_BACKEND !== '1', 'Requires the isolated real-handler fixture')
  test.setTimeout(120_000)
  const origin = process.env.E2E_BASE_URL
  if (!origin) throw new Error('A local fixture server is required')
  const subject = 'synthetic-personal-a-public-fee'
  const otherSubject = 'synthetic-personal-b-public-fee'
  await page.setViewportSize({ width: 390, height: 844 })
  await context.grantPermissions(['notifications'], { origin })
  await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }])
  await seedBrowserState(page, 'dark', '/settings', { allowServiceWorkers: true })
  await installSyntheticSubscription(page, 'public-fee')
  const api = await installFixtures(page, subject, 'dark')
  await page.goto('/settings/smart-charging?vehicle_id=7#public-fee')
  await waitForHarnessReady(page, api)
  const fee = page.getByRole('region', { name: 'Public charging fee reminders' })
  await expect(fee.getByText(/No active public-site fee review/)).toBeVisible()
  await page.getByRole('button', { name: 'Connect this browser' }).click()
  await expect.poll(async () => {
    const result = await page.request.get(`${origin}/__fixture/latest-push`)
    return result.status() === 200 && (await result.json()).kind
  }).toBe('verify')
  const verification = await (await page.request.get(`${origin}/__fixture/latest-push`)).json()
  await expect.poll(() => context.serviceWorkers().some(worker => worker.url().endsWith('/personal-delivery/sw.js'))).toBe(true)
  const worker = context.serviceWorkers().find(item => item.url().endsWith('/personal-delivery/sw.js'))
  if (!worker) throw new Error('Personal delivery worker did not start')
  expect(await dispatchPush(worker, verification)).toEqual({ status: 200, notification: 'shown' })
  await clearNotifications(worker)
  await fee.getByRole('button', { name: 'Review public fee terms' }).click()
  await fee.getByLabel('Reviewed public charging place').selectOption('9')
  await fee.getByLabel(/public terms URL/).fill('https://example.test/fee-policy')
  await fee.getByLabel(/^Currency code/).fill('USD')
  await fee.getByLabel(/^Fee amount per minute/).fill('0.55')
  await fee.getByLabel(/^Grace period after completion/).fill('5')
  await fee.getByRole('switch', { name: /verified this location/ }).click()
  await fee.getByRole('switch', { name: /I reviewed fixed terms/ }).click()
  await fee.getByRole('switch', { name: /Send fee reminders/ }).click()
  await fee.getByRole('button', { name: 'Save reviewed terms' }).click()
  await expect(fee.getByText(/Terms for Synthetic charging place were reviewed/)).toBeVisible()
  await assertMockApiComplete(page, api, { preserveServiceWorkers: true })
  await page.close()

  expect((await context.request.post(`${origin}/__fixture/process-public-fee`)).status()).toBe(204)
  const push = await (await context.request.get(`${origin}/__fixture/latest-push`)).json()
  expect(push.kind).toBe('public-fee')
  expect(Object.keys(push).sort()).toEqual(['kind', 'token'])
  await context.addCookies([{ name: 'personal_test_subject', value: otherSubject, url: origin }])
  expect(await dispatchPush(worker, push)).toEqual({ status: 404, notification: 'not-called' })
  await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }])
  expect(await dispatchPush(worker, push)).toEqual({ status: 200, notification: 'shown' })
  const path = '/settings/smart-charging?vehicle_id=7&fee_session_id=51#public-fee'
  await expect.poll(() => notifications(worker)).toEqual([{ title: 'A charging fee may start soon', data: { url: path } }])

  const next = await context.newPage()
  await next.setViewportSize({ width: 390, height: 844 })
  await seedBrowserState(next, 'dark', '/settings', { allowServiceWorkers: true })
  const nextApi = await installFixtures(next, subject, 'dark')
  await next.goto(path)
  await waitForHarnessReady(next, nextApi)
  const review = next.getByRole('region', { name: 'Public charging fee reminders' })
  await expect(review.getByText(/The reviewed fee is \$0.55 per minute/)).toBeVisible()
  await expect(review.getByRole('link', { name: /Read the operator/ })).toHaveAttribute('href', 'https://example.test/fee-policy')
  await review.getByRole('button', { name: 'Turn off fee reminders' }).click()
  await expect(review.getByRole('link', { name: /Read the operator/ })).toHaveCount(0)
  await expect(review.getByText(/No active public-site fee review/)).toBeVisible()
  await assertMockApiComplete(next, nextApi)
})
