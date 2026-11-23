import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks, mockAppSettings, seedBrowserState,
} from './mockApi'
import { clearNotifications, dispatchPush, installSyntheticSubscription, notifications } from './personalDeliveryFixture'

test.use({ serviceWorkers: 'allow' })
test.afterAll(async () => { await closeMockApiFixtures() })

test('reviewed commute checks deliver only the intended private decision', async ({ context, page, request }) => {
  test.setTimeout(120_000)
  test.skip(process.env.SMART_COMMUTE_REAL_BACKEND !== '1', 'Covered by the real-handler private notifications job')
  const fixture = await request.get('/__fixture/traffic')
  expect(fixture.ok()).toBe(true)
  const { drive, now, mode } = await fixture.json() as {
    drive: { id: number }; now: string; mode: 'compare' | 'wake_timeout' | 'arrival_deadline' | 'route_energy';
  }
  const withDeadline = mode === 'arrival_deadline'
  const withEnergy = mode === 'route_energy'
  const withNavigation = !withDeadline && !withEnergy
  const asleep = mode === 'wake_timeout'
  const theme = asleep ? 'dark' : 'light'
  const owner = 'synthetic-traffic-owner'
  const foreignSubject = 'other-synthetic-user'
  const origin = process.env.E2E_BASE_URL
  if (!origin) throw new Error('A local commute fixture server is required')
  const setSession = (subject: string) =>
    context.addCookies([{ name: 'commute_test_subject', value: subject, url: origin }])
  const getTraffic = async () => {
    const result = await request.get('/__fixture/traffic')
    expect(result.ok()).toBe(true)
    return await result.json() as {
      outbound: number; pushes: number; latest_push: { kind: string; token: string } | null;
      tesla: { checks: number; wakes: number; sends: number };
    }
  }
  await context.grantPermissions(['notifications'], { origin })
  await setSession(owner)
  await installSyntheticSubscription(page, 'commute')
  const writes: string[] = []
  async function prepare(tab: Page, subject: string) {
    if (asleep) await tab.setViewportSize({ width: 390, height: 844 })
    await tab.clock.setFixedTime(new Date(now))
    await seedBrowserState(tab, theme, '/settings/smart-commute', { allowServiceWorkers: true })
    const api = await installApiMocks(tab, 'populated', theme)
    if (!api) throw new Error('Missing isolated API fixtures')
    await tab.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
      json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
    }))
    await tab.route('**/api/v1/settings', route => fulfillApiFixture(route, api, {
      json: { ...mockAppSettings, tz_display_default: 'user', timezone_user: 'America/Los_Angeles' },
    }))
    await tab.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
      if (route.request().method() !== 'GET') return route.fallback()
      return fulfillApiFixture(route, api, {
        json: {
          scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'),
          pack_id: asleep ? 'blueprint' : 'v6', app_wide: true,
        },
      })
    })
    await tab.route(url => url.pathname === '/api/v1/vehicles', route => fulfillApiFixture(route, api, {
      json: [{ id: 42, display_name: 'Synthetic vehicle A' }],
    }))
    await tab.route('**/api/v1/vehicles/42/state', route => fulfillApiFixture(route, api, {
      json: { live: true, state: { vehicle_id: 42, state: 'online', speed: 0, updated_at: now } },
    }))
    await tab.route(url => url.pathname === '/api/v1/drives', route => fulfillApiFixture(route, api, { json: [drive] }))
    await tab.route(url => url.pathname.startsWith('/api/v1/smart-commute') ||
      url.pathname.startsWith('/api/v1/smart-delivery') ||
      url.pathname === '/api/v1/action-center' ||
      /^\/api\/v1\/action-center\/[^/]+\/history$/.test(url.pathname), async route => {
      const outgoing = route.request()
      expect(outgoing.headers()['x-teslasync-expected-principal']).toBe(`subject:${subject}`)
      if (outgoing.method() !== 'GET') writes.push(`${outgoing.method()} ${new URL(outgoing.url()).pathname}`)
      await forwardLocalApiFixture(route, api, { ...outgoing.headers(), 'x-test-subject': subject })
    })
    return api
  }

  const ownerAPI = await prepare(page, owner)
  await page.goto('/settings/smart-commute?vehicle_id=42')
  await expect(page.getByText(/Commute push starts off/)).toBeVisible()
  expect((await getTraffic()).pushes).toBe(0)
  await page.getByRole('button', { name: 'Connect this browser' }).click()
  await expect.poll(async () => (await getTraffic()).latest_push?.kind).toBe('verify')
  await expect.poll(() => context.serviceWorkers().some(worker => worker.url().endsWith('/personal-delivery/sw.js'))).toBe(true)
  const worker = context.serviceWorkers().find(item => item.url().endsWith('/personal-delivery/sw.js'))
  if (!worker) throw new Error('Personal delivery worker did not start')
  expect(await dispatchPush(worker, (await getTraffic()).latest_push)).toEqual({ status: 200, notification: 'shown' })
  await clearNotifications(worker)
  const pushConsent = page.getByRole('switch', { name: 'Allow commute traffic notifications on This browser' })
  await expect(pushConsent).toBeEnabled()
  await expect(pushConsent).not.toBeChecked()
  await pushConsent.click()
  await expect(pushConsent).toBeChecked()
  const enabled = page.getByRole('switch', { name: /Enable Smart Commute/ })
  await expect(enabled).not.toBeChecked()
  await expect(page.getByLabel('Time zone for local analysis')).toHaveCount(0)
  await enabled.click()
  await page.getByRole('switch', { name: /Allow local analysis/ }).click()
  await page.getByRole('button', { name: 'Use routine', exact: true }).click()
  await page.getByLabel('Routine name').fill('Synthetic office')
  await page.getByLabel('Local departure time').fill('08:00')
  await page.getByRole('button', { name: 'Save routine', exact: true }).click()
  await page.getByRole('button', { name: 'Set up traffic checks' }).click()
  await page.getByLabel('Representative drive').selectOption(String(drive.id))
  await page.getByRole('button', { name: 'Preview points locally' }).click()
  await expect(page.getByLabel('Coordinates that can be shared with HERE')).toContainText('47.1, -122.1')
  const consent = page.getByRole('button', { name: 'Enable traffic checks' })
  await expect(consent).toBeDisabled()
  expect((await getTraffic()).outbound).toBe(0)
  await page.getByRole('switch', { name: /Allow sharing this trace with HERE/ }).click()
  const energyConsent = page.getByRole('switch', { name: 'Compare routes using local driving energy history' })
  await expect(energyConsent).not.toBeChecked()
  if (withEnergy) {
    await energyConsent.click()
    await expect(page.getByText(/never sends their routes, temperatures, or energy use to HERE/)).toBeVisible()
  }
  if (withDeadline) {
    const deadline = page.getByLabel('Arrival deadline (optional)')
    await deadline.fill('08:00')
    await expect(consent).toBeDisabled()
    await deadline.fill('08:38')
    await expect(page.getByText(/does not require calendar access/)).toBeVisible()
  }
  await consent.click()
  await expect(page.getByRole('button', { name: 'Disconnect HERE' })).toBeVisible()
  await assertMockApiComplete(page, ownerAPI, { preserveServiceWorkers: true })
  await page.close()

  expect((await request.post('/__fixture/traffic')).status()).toBe(204)
  expect((await request.post('/__fixture/traffic')).status()).toBe(204)
  const result = await getTraffic()
  expect(result.outbound).toBe(withDeadline ? 2 : 1)
  expect(result.pushes).toBe(withEnergy ? 1 : 2)
  expect(result.tesla).toEqual({ checks: 0, wakes: 0, sends: 0 })
  if (!withEnergy) {
    expect(result.latest_push?.kind).toBe('commute')
    expect(Object.keys(result.latest_push ?? {}).sort()).toEqual(['kind', 'token'])
    await setSession(foreignSubject)
    expect(await dispatchPush(worker, result.latest_push)).toEqual({ status: 404, notification: 'not-called' })
    expect(await notifications(worker)).toEqual([])
    await setSession(owner)
    expect(await dispatchPush(worker, result.latest_push)).toEqual({ status: 200, notification: 'shown' })
    await expect.poll(() => notifications(worker)).toEqual([
      { title: 'Smart Commute', data: { url: expect.stringMatching(/^\/settings\/smart-commute\?vehicle_id=42&traffic_occurrence_id=[a-f0-9]{32}$/) } },
    ])
    expect(await dispatchPush(worker, result.latest_push)).toEqual({ status: 404, notification: 'not-called' })
  }
  const following = await context.newPage()
  const followingAPI = await prepare(following, owner)
  await following.goto('/action-center?vehicle_id=42')
  const before = writes.length
  await expect(following.getByText(withDeadline
    ? 'Leave earlier to make your arrival deadline'
    : withEnergy ? 'Compare a lower-energy route before departure'
    : 'A faster route is available before your departure', { exact: true })).toBeVisible()
  await following.getByRole('button', { name: 'Compare routes', exact: true }).click()
  if (withDeadline) {
    await expect(following.getByText('Alternative route: 46 min via Synthetic Bypass', { exact: true })).toBeVisible()
    await expect(following.getByText(/Faster alternative|Estimated saving/)).toHaveCount(0)
    await expect(following.getByText(/Estimated latest departure:.*7:52.*Your arrival deadline:.*8:38/i)).toBeVisible()
  } else if (withEnergy) {
    await expect(following.getByText(/Fastest offered route: 30 min estimated by HERE; 4 comparable drives used/)).toBeVisible()
    await expect(following.getByText(/Lower-energy alternative: 36 min estimated by HERE; 4 comparable drives used/)).toBeVisible()
    await expect(following.getByText(/do not measure or guarantee energy use on your next trip/)).toBeVisible()
    await expect(following.getByText(/Faster alternative|Estimated saving/)).toHaveCount(0)
  } else {
    await expect(following.getByText('Usual route: 43 min via Synthetic Parkway', { exact: true })).toBeVisible()
    await expect(following.getByText('Faster alternative: 29 min via Synthetic Bypass', { exact: true })).toBeVisible()
    await expect(following.getByText('Estimated saving: 14 min', { exact: true })).toBeVisible()
  }
  await expect(following.getByText('Synthetic office · Synthetic vehicle A', { exact: true })).toBeVisible()
  expect(writes.length).toBe(before)
  const link = following.url()
  expect(new URL(link).searchParams.get('traffic_occurrence_id')).toMatch(/^[a-f0-9]{32}$/)
  expect(await notifications(worker)).toEqual(withEnergy ? [] : [{ title: 'Smart Commute', data: { url: link.slice(origin.length) } }])
  await assertMockApiComplete(following, followingAPI, { preserveServiceWorkers: true })
  expect(followingAPI.requests.filter(item => /\/commands?(?:\/|$)/.test(item.path))).toEqual([])

  const foreign = await context.newPage()
  const foreignAPI = await prepare(foreign, foreignSubject)
  await foreign.goto(link)
  await expect(foreign.getByText(/This comparison is no longer available/)).toBeVisible()
  await expect(foreign.getByText(/Synthetic Parkway|Synthetic Bypass|Faster alternative|Estimated latest departure|Lower-energy alternative/)).toHaveCount(0)
  await expect(foreign.getByRole('button', { name: /Send Synthetic office/ })).toHaveCount(0)
  await assertMockApiComplete(foreign, foreignAPI, { preserveServiceWorkers: true })
  await foreign.close()

  const actionLabel = 'Send Synthetic office to Synthetic vehicle A'
  const send = following.getByRole('button', { name: actionLabel, exact: true })
  if (withNavigation) {
    const address = '100 Synthetic Office Way'
    const dialog = following.getByRole('dialog', { name: actionLabel })
    const confirmAddress = dialog.getByLabel('Destination address')
    const check = dialog.getByRole('button', { name: 'Check vehicle connection' })
    const allowWake = dialog.getByRole('button', { name: asleep ? 'Wake and send' : 'Allow wake and send', exact: true })
    const navWrites = () => writes.filter(write => write.endsWith('/navigation'))
    await send.press('Enter')
    await expect(dialog).toContainText('Confirm the destination address for Synthetic office.')
    await expect(dialog).toContainText('calculates its own route, not the HERE alternative.')
    await expect(check).toBeDisabled()
    expect(navWrites()).toEqual([])
    expect((await getTraffic()).tesla).toEqual({ checks: 0, wakes: 0, sends: 0 })
    await confirmAddress.fill(address)
    await check.press('Enter')
    await expect(allowWake).toBeVisible()
    await expect(dialog).toContainText(asleep ? 'Tesla reports the vehicle is asleep.' : 'Tesla reports the vehicle is online.')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).press('Enter')
    await expect(send).toBeFocused()
    expect((await getTraffic()).tesla).toEqual({ checks: 1, wakes: 0, sends: 0 })

    await send.press('Enter')
    await expect(confirmAddress).toHaveValue('')
    await confirmAddress.fill(address)
    await check.press('Enter')
    await allowWake.press('Enter')
    await expect(dialog).toHaveCount(0)
    const outcome = asleep ? /Delivery could not be confirmed/ : /Tesla accepted the destination/
    await expect(following.getByText(outcome)).toBeVisible()
    await expect(following.getByText(address, { exact: true })).toHaveCount(0)
    await expect(send).toHaveCount(0)
    expect((await getTraffic()).tesla).toEqual({ checks: 3, wakes: asleep ? 1 : 0, sends: 1 })
    expect(navWrites()).toHaveLength(3)

    await following.reload()
    await expect(following.getByText(outcome)).toBeVisible()
    await expect(send).toHaveCount(0)
    expect((await getTraffic()).tesla).toEqual({ checks: 3, wakes: asleep ? 1 : 0, sends: 1 })
    expect(navWrites()).toHaveLength(3)

    expect((await request.post('/__fixture/traffic/observed-departure')).status()).toBe(204)
    await following.reload()
    await expect(following.getByText(/This comparison is no longer available/)).toBeVisible()
    await expect(send).toHaveCount(0)
    expect((await getTraffic()).tesla).toEqual({ checks: 3, wakes: asleep ? 1 : 0, sends: 1 })
    expect(navWrites()).toHaveLength(3)
  } else {
    await expect(send).toHaveCount(0)
  }

  await following.getByRole('button', { name: 'Skip today', exact: true }).click()
  await expect(following.getByText(/This comparison is no longer available/)).toBeVisible()
  await following.getByRole('button', { name: 'Disconnect HERE', exact: true }).click()
  await expect(following.getByRole('button', { name: 'Set up traffic checks' })).toBeVisible()
  expect((await request.post('/__fixture/traffic')).status()).toBe(204)
  expect((await getTraffic()).outbound).toBe(withDeadline ? 2 : 1)
  await assertMockApiComplete(following, followingAPI)
})
