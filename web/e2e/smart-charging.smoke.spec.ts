import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import type { ActionCenterRecommendation, ActionCenterResponse } from '../src/types/actionCenter'
import type { SmartChargingPlan, SmartChargingPlanInput } from '../src/types/smartCharging'
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi'

test.afterAll(async () => { await closeMockApiFixtures() })

async function installTripFixtures(
  page: Page, api: NonNullable<Awaited<ReturnType<typeof installApiMocks>>>,
  subject: () => string, pack: string, revision: string,
) {
  await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
    if (route.request().method() !== 'GET') return route.fallback()
    return fulfillApiFixture(route, api, {
      json: { scope: createHash('sha256').update(`forward_auth:${subject()}`).digest('hex'), pack_id: pack, app_wide: true },
    })
  })
  await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
    json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject: subject(), capabilities: {} },
  }))
  await page.route(url => url.pathname === '/api/v1/smart-delivery/devices', route =>
    fulfillApiFixture(route, api, { json: { data: { available: false, public_key: '', devices: [] } } }))
  await page.route(url => url.pathname === '/api/v1/geofences', route => fulfillApiFixture(route, api, {
    json: [
      { id: 9, name: 'Synthetic charging place', is_charging_location: true },
      { id: 11, name: 'Reviewed stop A', is_charging_location: true },
      { id: 12, name: 'Reviewed stop B', is_charging_location: true },
      { id: 13, name: 'Reviewed destination', is_charging_location: false },
    ].map(place => ({
      ...place, enabled: true, origin: 'manual', needs_review: false, radius: 100,
      updated_at: revision, latitude: 47, longitude: -122, polygon_wkt: '',
    })),
  }))
}

for (const variant of [
  { width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`reviewed trip stops require private consent: ${variant.theme} ${variant.pack}`, async ({ page }) => {
    test.skip(process.env.SMART_CHARGING_REAL_BACKEND !== '1', 'Requires the real-handler PostgreSQL fixture')
    test.setTimeout(120_000)
    await page.setViewportSize({ width: variant.width, height: variant.height })
    const url = '/settings/smart-charging?vehicle_id=7#trip-stops'
    await seedBrowserState(page, variant.theme, url)
    const api = await installApiMocks(page, 'populated', variant.theme)
    if (!api) throw new Error('Missing isolated API fixtures')
    const owner = `synthetic-trip-stops-${variant.width}`
    const principalHeaders = (subject: string) => ({
      'x-test-subject': subject,
      'x-teslasync-expected-principal': `subject:${subject}`,
    })
    const ownerHeaders = principalHeaders(owner)
    const fixture = async (): Promise<{ now: string; revision: string; provider_calls: number }> => {
      const response = await page.request.get('/__fixture/trip-stops')
      expect(response.ok()).toBe(true)
      return response.json()
    }
    const start = await fixture()
    const departure = new Date(Date.parse(start.now) + 2 * 60 * 60_000)
    const planResponse = await page.request.post('/api/v1/smart-charging/plans', {
      headers: ownerHeaders,
      data: {
        vehicle_id: 7, charging_place_id: 9, enabled: true, notify_at: start.now, departure_at: departure.toISOString(),
        trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 12.5,
        trip_legs: { outbound_use_low_pct: 25, outbound_use_high_pct: 35, return_use_low_pct: 10, return_use_high_pct: 10 },
      },
    })
    expect(planResponse.status(), await planResponse.text()).toBe(201)
    const { data: plan } = await planResponse.json() as { data: SmartChargingPlan }
    await installTripFixtures(page, api, () => owner, variant.pack, start.revision)
    const comparedPath = `/api/v1/smart-charging/plans/${plan.id}/stops`
    const writes: string[] = []
    await page.route(url => url.pathname.startsWith('/api/v1/smart-charging'), route => {
      const request = route.request()
      expect(request.headers()['x-teslasync-expected-principal']).toBe(ownerHeaders['x-teslasync-expected-principal'])
      if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
      return forwardLocalApiFixture(route, api, { ...request.headers(), ...ownerHeaders })
    })

    await page.goto(url)
    await waitForHarnessReady(page, api)
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', variant.pack)
    const opener = page.getByRole('button', { name: 'Compare reviewed charging stops' })
    await opener.click()
    const panel = page.getByRole('region', { name: 'Compare reviewed charging stops' })
    await expect(panel.getByText(/^Off\./)).toBeVisible()
    expect((await fixture()).provider_calls).toBe(start.provider_calls)
    await panel.getByRole('button', { name: 'Review setup' }).click()
    await panel.getByLabel('Reviewed destination').selectOption('13')
    await panel.getByLabel('Estimated usable battery capacity (Wh)').fill('80000')
    await panel.getByLabel('Assumed departure charge (%)').fill('37.5')
    await panel.getByLabel('Maximum charge at a stop (%)').fill('80')
    const consumption = panel.getByLabel(/^High-side driving consumption/)
    const usesMiles = await panel.getByLabel('High-side driving consumption (Wh/mi)', { exact: true }).count() === 1
    await consumption.fill(usesMiles ? '402.336' : '250')
    for (const [index, place, wait] of [[1, '11', 20], [2, '12', 1]] as const) {
      const stop = panel.getByRole('group', { name: `Charging stop ${index}` })
      await stop.getByLabel('Reviewed charging place').selectOption(place)
      await stop.getByLabel(/^Station time zone/).fill('UTC')
      await stop.getByLabel('Recorded queue waits').fill(Array.from({ length: 8 }, (_, week) => {
        const observed = new Date(departure.getTime() + 45 * 60_000 - (week + 1) * 7 * 24 * 60 * 60_000)
        return `${observed.toISOString()},${wait}`
      }).join('\n'))
    }
    const save = panel.getByRole('button', { name: 'Save comparison setup' })
    await expect(save).toBeDisabled()
    await panel.getByRole('checkbox', { name: /^I verified/ }).press('Space')
    await expect(save).toBeDisabled()
    await panel.getByRole('checkbox', { name: /^Allow HERE Routing/ }).press('Space')
    await save.click()
    await expect(opener).toBeFocused()
    expect((await fixture()).provider_calls).toBe(start.provider_calls)
    await panel.getByRole('button', { name: 'Check routes with HERE' }).click()
    const winners = panel.getByRole('listitem')
    await expect(winners).toHaveCount(2)
    await expect(winners.first()).toContainText('Reviewed stop B')
    await expect(winners.first()).toContainText(/Historical wait:\s*1(?:\.0+)? min/)
    await expect(panel.getByText(/do not verify traffic, open stalls or the return trip/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect((await fixture()).provider_calls).toBe(start.provider_calls + 3)
    expect(writes).toEqual([`PUT ${comparedPath}`, `POST ${comparedPath}`])

    const foreign = await page.request.get(`${comparedPath}?vehicle_id=7`, {
      headers: principalHeaders(`${owner}-foreign`),
    })
    expect(foreign.ok(), await foreign.text()).toBe(true)
    expect(await foreign.json()).toMatchObject({ data: { has_setup: false, result: null } })
    await panel.getByRole('button', { name: 'Disconnect and remove comparison setup' }).click()
    const confirm = page.getByRole('dialog', { name: 'Remove this comparison setup?' })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(winners).toHaveCount(2)
    await panel.getByRole('button', { name: 'Disconnect and remove comparison setup' }).click()
    await confirm.getByRole('button', { name: 'Disconnect and remove comparison setup' }).click()
    await expect(panel.getByText(/^Off\./)).toBeVisible()
    await expect(winners).toHaveCount(0)
    expect((await fixture()).provider_calls).toBe(start.provider_calls + 3)
    expect(writes).toEqual([`PUT ${comparedPath}`, `POST ${comparedPath}`, `DELETE ${comparedPath}`])
    await assertMockApiComplete(page, api)
  })
}

test('trip review uses recorded plan and actuals', async ({ page }) => {
  test.skip(process.env.SMART_CHARGING_REAL_BACKEND !== '1', 'Requires the real-handler PostgreSQL fixture')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const url = '/settings/smart-charging?vehicle_id=7#trip-stops'
  await seedBrowserState(page, 'dark', url)
  const api = await installApiMocks(page, 'populated', 'dark')
  if (!api) throw new Error('Missing isolated API fixtures')
  const subject = 'synthetic-trip-review'
  const headers = { 'x-test-subject': subject, 'x-teslasync-expected-principal': `subject:${subject}` }
  const fixture = await page.request.get('/__fixture/trip-review')
  expect(fixture.ok()).toBe(true)
  const start = await fixture.json() as { now: string; departure_at: string; journey_id: number; revision: string }
  const create = await page.request.post('/api/v1/smart-charging/plans', {
    headers,
    data: {
      vehicle_id: 7, charging_place_id: 9, enabled: true, notify_at: start.now, departure_at: start.departure_at,
      trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 12.5,
      trip_legs: { outbound_use_low_pct: 25, outbound_use_high_pct: 35, return_use_low_pct: 10, return_use_high_pct: 10 },
    },
  })
  expect(create.status(), await create.text()).toBe(201)
  const { data: plan } = await create.json() as { data: SmartChargingPlan }
  const reviewPath = `/api/v1/smart-charging/plans/${plan.id}/review`
  await installTripFixtures(page, api, () => subject, 'blueprint', start.revision)
  await page.route(url => url.pathname === '/api/v1/journey/sessions', route => {
    const request = route.request()
    const params = new URL(request.url()).searchParams
    expect(params.get('vehicle_id')).toBe('7')
    expect(params.get('status')).toBe('planned')
    return forwardLocalApiFixture(route, api, { ...request.headers(), ...headers })
  })
  const writes: string[] = []
  await page.route(url => url.pathname.startsWith('/api/v1/smart-charging'), route => {
    const request = route.request()
    expect(request.headers()['x-teslasync-expected-principal']).toBe(`subject:${subject}`)
    if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
    return forwardLocalApiFixture(route, api, { ...request.headers(), ...headers })
  })
  await page.goto(url)
  await waitForHarnessReady(page, api)
  const trigger = page.getByRole('button', { name: 'Review planned vs. actual trip' })
  await trigger.click()
  const panel = page.getByRole('region', { name: 'Review planned vs. actual trip' })
  await expect(panel.getByText(/^Off\./)).toBeVisible()
  expect(writes).toEqual([])
  await panel.getByRole('button', { name: 'Set up trip review' }).click()
  const journeys = panel.getByRole('combobox', { name: /^Planned journey\b/ })
  await journeys.selectOption(String(start.journey_id))
  await expect(journeys.getByRole('option', { name: 'Other vehicle journey' })).toHaveCount(0)
  await panel.getByLabel('Reviewed destination').selectOption('13')
  await panel.getByLabel('Planned arrival charge (%)').fill('20')
  await panel.getByLabel('Planned charging stop').selectOption('11')
  await panel.getByLabel('Planned time stopped (min)').fill('30')
  const save = panel.getByRole('button', { name: 'Save trip baseline' })
  await expect(save).toBeDisabled()
  await panel.getByRole('checkbox', { name: /^Review the recorded drives/ }).press('Space')
  await save.click()
  await expect(panel.getByText(/^Baseline saved\./)).toBeVisible()
  await expect(panel.getByRole('button', { name: /^Save adjustment/ })).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect((await page.request.post('/__fixture/trip-review')).status()).toBe(204)
  await page.clock.setFixedTime(new Date(Date.parse(start.departure_at) + 4 * 60 * 60_000))
  await trigger.click()
  await trigger.click()
  await expect(panel.getByText(/with 14\.5[0]*% charge/)).toContainText(/expected 20[.0]*%/)
  await expect(panel.getByText(/Recorded stop:/)).toContainText(/45[.0]* min, including 32[.0]* min/)
  await panel.getByRole('button', { name: /^Save adjustment/ }).click()
  await expect(panel.getByText(/^Saved for the next similar trip\./)).toContainText(/15[.0]* min more stopped time/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(panel.getByText(/^Saved for the next similar trip\./)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const after = await page.request.get(`${reviewPath}?vehicle_id=7`, { headers })
  expect(await after.json()).toMatchObject({ data: { adjustment: { extra_stop_s: 900, extra_arrival_pct: 5.5 } } })
  const foreign = await page.request.get(`${reviewPath}?vehicle_id=7`, {
    headers: { 'x-test-subject': 'different-reviewer', 'x-teslasync-expected-principal': 'subject:different-reviewer' },
  })
  expect(await foreign.json()).toMatchObject({ data: { has_setup: false, adjustment: null } })
  expect(writes).toEqual([`PUT ${reviewPath}`, `POST ${reviewPath}`])
  await assertMockApiComplete(page, api)
})

for (const variant of [
  { width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`documented maintenance interval requires a private and definite crossing: ${variant.theme} ${variant.pack}`, async ({ page }) => {
    test.skip(process.env.SMART_MAINTENANCE_REAL_BACKEND !== '1', 'Requires the mounted handlers and disposable PostgreSQL')
    test.setTimeout(150_000)
    await page.setViewportSize({ width: variant.width, height: variant.height })
    const url = '/settings/smart-charging?vehicle_id=7#trip-stops'
    const owner = `synthetic-trip-maintenance-${variant.width}`
    const headers = { 'x-test-subject': owner, 'x-teslasync-expected-principal': `subject:${owner}` }
    const now = Date.now()
    const create = await page.request.post('/api/v1/smart-charging/plans', {
      headers,
      data: {
        vehicle_id: 7, charging_place_id: 9, enabled: true, notify_at: new Date(now).toISOString(),
        departure_at: new Date(now + 12 * 60 * 60_000).toISOString(),
        trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20,
      },
    })
    expect(create.status(), await create.text()).toBe(201)
    const { data: plan } = await create.json() as { data: SmartChargingPlan }
    const maintenance = `/api/v1/smart-charging/plans/${plan.id}/maintenance`
    const inbox = '/action-center?vehicle_id=7&source_feature=trip_maintenance'
    const decision = 'Review maintenance before your trip'
    await seedBrowserState(page, variant.theme, url)
    const api = await installApiMocks(page, 'populated', variant.theme)
    if (!api) throw new Error('Missing isolated API fixtures')
    await installTripFixtures(page, api, () => owner, variant.pack, new Date(now).toISOString())
    await page.route(path => ['/api/v1/maintenance', '/api/v1/maintenance/records'].includes(path.pathname) &&
      path.searchParams.get('vehicle_id') === '7', route =>
      fulfillApiFixture(route, api, { json: [] }))
    const writes: string[] = []
    await page.route(path => path.pathname.startsWith('/api/v1/smart-charging') ||
      path.pathname.startsWith('/api/v1/action-center'), route => {
      const request = route.request()
      expect(request.headers()['x-teslasync-expected-principal']).toBe(`subject:${owner}`)
      return forwardLocalApiFixture(route, api, { ...request.headers(), ...headers })
    })
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname
      if (request.method() !== 'GET' && /\/(commands?|smart-delivery|smart-charging|action-center|maintenance)(\/|$)/.test(pathname)) {
        writes.push(`${request.method()} ${pathname}`)
      }
    })
    const tick = async (published: number, outcomes: Record<string, number>) => {
      const response = await page.request.post('/__fixture/maintenance-tick')
      expect(response.status(), await response.text()).toBe(200)
      expect(await response.json()).toEqual({ Published: published, Outcomes: outcomes })
    }

    await page.goto(url)
    await waitForHarnessReady(page, api)
    const trigger = page.getByRole('button', { name: 'Maintenance before this trip' })
    await trigger.press('Enter')
    const panel = page.getByRole('region', { name: 'Maintenance before this trip' })
    await expect(panel.getByText(/^Off\./)).toBeVisible()
    await tick(0, {})
    await panel.getByRole('button', { name: 'Set up maintenance check' }).click()
    await panel.getByLabel('Recorded maintenance item').fill('Synthetic inspection')
    await panel.getByLabel(/^Completed service/).fill(new Date(now - 90 * 86400_000).toISOString().slice(0, 16))
    await panel.getByLabel('Odometer at completed service (km)').fill('71000')
    await panel.getByLabel('Documented service interval (km)').fill('10000')
    await panel.getByLabel('Lower total trip distance (km)').fill('500')
    await panel.getByLabel('Upper total trip distance (km)').fill('900')
    const consent = panel.getByRole('checkbox', { name: /Nothing is sent outside TeslaSync/ })
    const save = panel.getByRole('button', { name: 'Save private maintenance check' })
    await expect(save).toBeDisabled()
    expect(writes).toEqual([])
    await consent.press('Space')
    await save.click()
    await expect(trigger).toBeFocused()
    await tick(0, { below_interval: 1 })
    const absent = await page.request.get(`/api/v1${inbox}`, { headers })
    expect(absent.status()).toBe(200)
    const suppressed = await absent.json() as { items: ActionCenterResponse['items'] | null }
    expect(suppressed.items ?? []).toHaveLength(0)

    await panel.getByRole('button', { name: 'Review or edit the interval' }).click()
    await panel.getByLabel('Lower total trip distance (km)').fill('700')
    await consent.press('Space')
    await save.click()
    await expect(trigger).toBeFocused()
    await page.goto(inbox)
    await waitForHarnessReady(page, api)
    await expect(page.getByText(decision, { exact: true })).toHaveCount(0)
    await tick(1, { eligible: 1 })
    await tick(0, {})
    await page.reload()
    await waitForHarnessReady(page, api)
    await expect(page.getByText(decision, { exact: true })).toHaveCount(1)
    await expect(page.getByText(/Synthetic inspection is due at/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Review maintenance' }).click()
    await expect(page).toHaveURL(/\/maintenance\?vehicle_id=7$/)
    await expect(page.getByRole('heading', { name: 'Maintenance', exact: true })).toBeVisible()

    const foreign = 'synthetic-trip-maintenance-other'
    const denied = await page.request.get(`${maintenance}?vehicle_id=7`, {
      headers: { 'x-test-subject': foreign, 'x-teslasync-expected-principal': `subject:${foreign}` },
    })
    expect(denied.status()).toBe(404)
    await page.goto(url)
    await waitForHarnessReady(page, api)
    await trigger.click()
    await expect(panel.getByText(/Synthetic inspection is due at/)).toBeVisible()
    const remove = panel.getByRole('button', { name: 'Turn off maintenance check' })
    const dialog = page.getByRole('dialog')
    await remove.press('Enter')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(remove).toBeFocused()
    await remove.press('Enter')
    await dialog.getByRole('button', { name: 'Turn off maintenance check' }).click()
    await expect(panel.getByText(/^Off\./)).toBeVisible()
    await expect(trigger).toBeFocused()
    await page.goto(inbox)
    await waitForHarnessReady(page, api)
    await expect(page.getByText(decision, { exact: true })).toHaveCount(0)
    expect(writes).toEqual([`PUT ${maintenance}`, `PUT ${maintenance}`, `DELETE ${maintenance}`])
    await assertMockApiComplete(page, api)
  })
}

for (const variant of [
  { name: 'desktop sidebar in open mode', width: 1440, height: 900, theme: 'light', open: true, pack: 'blueprint' },
  { name: 'desktop top navigation with sign-in', width: 1440, height: 900, theme: 'light', open: false, pack: 'v6' },
  { name: 'mobile sidebar pack with sign-in', width: 390, height: 844, theme: 'dark', open: false, pack: 'blueprint' },
  { name: 'mobile top navigation in open mode', width: 390, height: 844, theme: 'dark', open: true, pack: 'v6' },
] as const) {
  test(`smart notification setup is reachable from navigation: ${variant.name}`, async ({ page }) => {
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await seedBrowserState(page, variant.theme, '/settings')
    const api = await installApiMocks(page, 'populated', variant.theme)
    if (!api) throw new Error('Missing isolated API fixtures')
    await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
      if (route.request().method() !== 'GET') return route.fallback()
      return fulfillApiFixture(route, api, {
        json: { scope: createHash('sha256').update(variant.open ? 'open' : 'forward_auth:synthetic-navigation').digest('hex'),
          pack_id: variant.pack, app_wide: true },
      })
    })
    await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
      json: { mode: variant.open ? 'open' : 'forward_auth', subject_header: 'X-Test-Subject', subject: 'synthetic-navigation', capabilities: {} },
    }))
    await page.goto('/settings')
    await waitForHarnessReady(page, api)
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', variant.pack)

    const mobile = variant.width < 1024
    const top = variant.pack === 'v6'
    const panel = mobile ? page.getByRole('dialog', { name: 'Browse sections' })
      : top ? page.getByRole('menu', { name: 'Smart notifications' }) : page.getByTestId('command-deck-secondary')
    if (mobile) {
      if (top) await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Browse sections' }).click()
      else await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('button', { name: 'More' }).click()
      await panel.getByRole('button', { name: 'Notifications' }).click()
    } else if (top) {
      await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Notifications', exact: true }).click()
    } else {
      const notifications = page.getByTestId('command-deck-rail').getByRole('button', { name: 'Notifications' })
      await expect(notifications).toHaveText('Notifications')
      expect(await notifications.locator('.sidenav-short-label').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await notifications.click()
    }

    const role = !mobile && top ? 'menuitem' : 'link'
    const commute = panel.getByRole(role, { name: 'Smart Commute' })
    const charging = panel.getByRole(role, { name: 'Charging readiness' })
    await expect(commute).toBeVisible()
    await expect(commute).toHaveAttribute('href', '/settings/smart-commute')
    await expect(charging).toBeVisible()
    await expect(charging).toHaveAttribute('href', '/settings/smart-charging')
    if (mobile) {
      await expect(commute).toBeInViewport()
      await expect(charging).toBeInViewport()
      const smart = panel.getByRole('button', { name: /^Smart notifications/ })
      await expect(smart).toHaveAttribute('aria-expanded', 'true')
      await expect(panel.getByRole('button', { name: /^Notification center/ })).toHaveAttribute('aria-expanded', 'false')
      await smart.click()
      await expect(commute).toBeHidden()
      await smart.click()
      await expect(charging).toBeVisible()
    }
    await assertMockApiComplete(page, api)
  })
}

for (const variant of [
  { name: 'desktop light with sign-in', width: 1440, height: 900, theme: 'light', pack: 'v6', open: false },
  { name: 'mobile dark with sign-in', width: 390, height: 844, theme: 'dark', pack: 'blueprint', open: false },
  { name: 'desktop light shared installation', width: 1440, height: 900, theme: 'light', pack: 'v6', open: true },
  { name: 'mobile dark shared installation', width: 390, height: 844, theme: 'dark', pack: 'blueprint', open: true },
] as const) {
  test(`charging readiness is consented and scoped: ${variant.name}`, async ({ page }) => {
    test.setTimeout(120_000)
    test.skip(process.env.E2E_MOCKS === '0', 'This journey uses synthetic subjects and local fixtures')
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await seedBrowserState(page, variant.theme, '/settings')
    const api = await installApiMocks(page, 'populated', variant.theme)
    if (!api) throw new Error('Missing isolated API fixtures')
    const primarySubject = `synthetic-charge-${variant.width}-a`
    const otherSubject = `synthetic-charge-${variant.width}-b`
    const realBackend = process.env.SMART_CHARGING_REAL_BACKEND === '1'
    let subject = primarySubject
    let openMode: boolean = variant.open
    const scopeKey = () => openMode ? 'shared-open' : subject
    const expectedPrincipal = () => openMode ? 'open' : `subject:${subject}`
    const switchPrincipal = async (nextSubject: string, nextOpenMode: boolean) => {
      // The old document can still refetch while the fixture advances its clock.
      await page.goto('about:blank')
      subject = nextSubject
      openMode = nextOpenMode
    }
    let charging = false
    const plans = new Map<string, (SmartChargingPlan & { version: number })[]>()
    const writes: string[] = []
    await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
      if (route.request().method() !== 'GET') return route.fallback()
      return fulfillApiFixture(route, api, {
        json: { scope: createHash('sha256').update(openMode ? 'open' : `forward_auth:${subject}`).digest('hex'),
          pack_id: variant.pack, app_wide: true },
      })
    })
    await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
      json: { mode: openMode ? 'open' : 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
    }))
    await page.route('**/api/v1/smart-delivery/devices', route => {
      expect(route.request().method()).toBe('GET')
      expect(route.request().headers()['x-teslasync-expected-principal']).toBe(expectedPrincipal())
      return fulfillApiFixture(route, api, { json: { data: { available: false, public_key: '', devices: [] } } })
    })
    await page.route(url => url.pathname === '/api/v1/geofences', route => fulfillApiFixture(route, api, {
      json: [{
        id: 9, name: 'Synthetic charging place', polygon_wkt: 'POLYGON((-122.2 47,-122 47,-122 47.2,-122.2 47.2,-122.2 47))',
        enabled: true, needs_review: false, is_charging_location: true, origin: 'manual',
        alert_on_entry: false, alert_on_exit: false, latitude: 47.1, longitude: -122.1, radius: 100,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      }],
    }))
    if (realBackend) {
      await page.route(url => url.pathname.startsWith('/api/v1/smart-charging') ||
        url.pathname === '/api/v1/action-center', async route => {
        const request = route.request()
        expect(request.headers()['x-teslasync-expected-principal']).toBe(expectedPrincipal())
        if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
        await forwardLocalApiFixture(route, api, {
          ...request.headers(), 'x-test-subject': subject, 'x-test-open': openMode ? '1' : '0',
        })
      })
    } else {
      await page.route('**/api/v1/smart-charging/**', route => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        expect(request.headers()['x-teslasync-expected-principal']).toBe(expectedPrincipal())
        if (request.method() === 'GET' && path.endsWith('/site-performance')) {
          return fulfillApiFixture(route, api, { json: { data: { scope: null, review: null } } })
        }
        if (request.method() === 'GET' && path.endsWith('/solar')) {
          return fulfillApiFixture(route, api, { json: { data: { available: false, plan: null, decision: null } } })
        }
        if (request.method() === 'GET') return fulfillApiFixture(route, api, { json: { data: plans.get(scopeKey()) ?? [] } })
        writes.push(`${request.method()} ${path}`)
        if (request.method() === 'POST' && path.endsWith('/plans')) {
          const input = request.postDataJSON() as SmartChargingPlanInput
          const item = { ...input, id: 8, version: 1, snoozed_until: null,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          plans.set(scopeKey(), [item])
          return fulfillApiFixture(route, api, { json: { data: item }, status: 201 })
        }
        if (request.method() === 'PUT' && path.endsWith('/plans/8')) {
          const { expected_version, expected_check_at, ...input } = request.postDataJSON() as SmartChargingPlanInput & {
            expected_version: number; expected_check_at: string;
          }
          plans.set(scopeKey(), (plans.get(scopeKey()) ?? []).map(item => {
            expect(expected_version).toBe(item.version)
            expect(expected_check_at).toBe(item.notify_at)
            return { ...item, ...input, version: expected_version + 1 }
          }))
          return fulfillApiFixture(route, api, { json: { data: plans.get(scopeKey())?.[0] } })
        }
        if (request.method() === 'POST' && path.endsWith('/plans/8/snooze')) {
          const input = request.postDataJSON() as { duration_s: number }
          plans.set(scopeKey(), (plans.get(scopeKey()) ?? []).map(item => ({
            ...item, version: item.version + 1,
            snoozed_until: input.duration_s ? new Date(Date.now() + input.duration_s * 1000).toISOString() : null,
          })))
          return fulfillApiFixture(route, api, { status: 204 })
        }
        if (request.method() === 'DELETE' && path.endsWith('/plans/8')) {
          plans.set(scopeKey(), [])
          return fulfillApiFixture(route, api, { status: 204 })
        }
        throw new Error(`Unexpected charging request: ${request.method()} ${path}`)
      })
      await page.route(url => url.pathname === '/api/v1/action-center', route => {
        expect(route.request().headers()['x-teslasync-expected-principal']).toBe(expectedPrincipal())
        const plan = (plans.get(scopeKey()) ?? []).find(item => item.enabled && !item.snoozed_until)
        const items: ActionCenterRecommendation[] = plan && !charging ? [{
          id: 'ac_charging_fixture', fingerprint: 'b'.repeat(64), source_feature: 'smart_charging',
          related_sources: ['smart_charging'], vehicle: { id: 7, display_name: 'Synthetic vehicle' },
          title: 'Plug in before your planned trip', summary: 'Synthetic readiness',
          rationale: 'Synthetic observations', priority: 'medium', severity: 'warning',
          rank: { score: 200, basis: [] }, confidence: { score: 0.8, label: 'high', basis: [] },
          evidence: [{
            id: 'charging_plan:8', kind: 'charging_readiness', summary: 'Synthetic readiness',
            provenance: { source: 'live_signal_store', record_id: 'charging_plan:8', source_url: null },
            observed_at: new Date().toISOString(),
            charging_readiness: { plan_id: 8, place_name: 'Synthetic charging place', battery_pct: 45,
              arrival_low_pct: 0, arrival_high_pct: 10, reserve_pct: 20, departure_at: plan.departure_at },
          }],
          projected_impact: null, safe_actions: ['navigate', 'smart_charging_snooze'],
          navigation_path: '/settings?vehicle_id=7#smart-charging',
          expires_at: new Date(Date.now() + 120_000).toISOString(),
          freshness: { status: 'fresh', observed_at: new Date().toISOString(), age_s: 0 },
          limitations: [], current_state: { status: 'open', version: 0, snoozed_until: null, updated_at: null },
          action_history: [],
        }] : []
        const response: ActionCenterResponse = {
          items, total: items.length, limit: 50, offset: 0, generated_at: new Date().toISOString(),
          summary: { open: items.length, acknowledged: 0, snoozed: 0, dismissed: 0, critical: 0, high: 0 },
          provider_status: [{ source_feature: 'smart_charging', status: 'available', item_count: items.length, limitations: [] }],
        }
        return fulfillApiFixture(route, api, { json: response })
      })
    }

    if (realBackend) {
      const fixture = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, {
        data: { state: 'Disconnected', power_w: 500 },
      })
      expect(fixture.status()).toBe(204)
    }
    await page.goto('/settings?vehicle_id=7#smart-charging')
    await waitForHarnessReady(page, api)
    await expect(page).toHaveURL(/\/settings\/smart-charging\?vehicle_id=7$/)
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', variant.pack)
    await expect(page.getByText('Shared installation')).toHaveCount(0)
    if (openMode) await expect(page.getByText(/Without sign-in, anyone with access to TeslaSync can view and manage these plans/)).toBeVisible()
    await expect(page.getByText(/No trip plan is saved/)).toBeVisible()
    await expect(page.getByText(/No personal devices are connected/)).toBeVisible()
    expect(writes).toEqual([])
    await page.getByRole('button', { name: 'Add a trip plan' }).click()
    await expect(page.getByRole('switch', { name: 'Enable readiness checks for this plan' })).not.toBeChecked()
    const inputTime = (ms: number) => new Date(ms).toISOString().slice(0, 16)
    const plannedDeparture = Date.now() + 6 * 60 * 60_000
    const intendedStart = inputTime(plannedDeparture + 60 * 60_000)
    await page.getByLabel(/Known charging place/).selectOption('9')
    const comparePrices = page.getByRole('switch', { name: 'Compare costs using verified place prices' })
    await expect(comparePrices).not.toBeChecked()
    await expect(page.getByRole('link', { name: 'Review charging place prices' })).toHaveAttribute('href', '/geofences')
    await comparePrices.click()
    await expect(comparePrices).toBeChecked()
    await page.getByLabel(/Check from/).fill(inputTime(Date.now() - 60_000))
    await page.getByLabel(/Planned departure/).fill(inputTime(plannedDeparture))
    await page.getByLabel('Intended charging start (optional)').fill(intendedStart)
    await page.getByLabel(/Estimated round-trip use, low/).fill('35')
    await page.getByLabel(/Estimated round-trip use, high/).fill('45')
    await page.getByLabel(/Desired return reserve/).fill('20')
    await page.getByRole('button', { name: 'Save plan' }).click()
    await expect(page.getByText(/Status: Paused/)).toBeVisible()
    await expect(page.getByText(/Intended charging start:.*entered by you/)).toBeVisible()

    await page.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(page, api)
    const card = page.getByRole('article', { name: 'Plug in before your planned trip' })
    const schedule = page.getByRole('article', { name: 'Review charging scheduled for departure or later' })
    const shortWindow = page.getByRole('article', { name: 'Scheduled charging may finish too late for your trip' })
    await expect(card).toHaveCount(0)
    await page.goto('/settings?vehicle_id=7#smart-charging')
    await waitForHarnessReady(page, api)
    await page.getByRole('button', { name: 'Resume' }).click()
    await expect(page.getByText(/Status: Active/)).toBeVisible()
    await page.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(page, api)
    await expect.poll(async () => {
      if (await card.count() === 0) await page.reload()
      return card.count()
    }, { timeout: 15_000 }).toBe(1)
    await expect(page.getByText('Shared installation')).toHaveCount(0)
    await expect(card.getByText(/Battery .*Synthetic charging place.*return.*reserve/)).toBeVisible()
    await expect(card.getByRole('button', { name: 'Dismiss' })).toHaveCount(0)
    await card.getByRole('button', { name: /Evidence, scoring, and outcomes/ }).click()
    await expect(card.getByText(/estimate based on the range you entered/).first()).toBeVisible()
    await card.getByRole('button', { name: 'Snooze for 1 hour' }).click()
    await expect(card).toHaveCount(0)

    await page.goto('/settings?vehicle_id=7#smart-charging')
    await waitForHarnessReady(page, api)
    await expect(page.getByText(/Status: Snoozed/)).toBeVisible()
    await page.getByRole('button', { name: 'Check now' }).click()
    await expect(page.getByText(/Status: Active/)).toBeVisible()
    if (realBackend) {
      const fixture = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, {
        data: { state: 'NoPower', advance_seconds: 60, schedule_clock: intendedStart.slice(11) },
      })
      expect(fixture.status()).toBe(204)
      await page.goto('/action-center?vehicle_id=7')
      await waitForHarnessReady(page, api)
      await expect(schedule).toBeVisible()
      await expect(schedule.getByText(/If charging starts at the time you entered/)).toBeVisible()

      await page.goto('/settings/smart-charging?vehicle_id=7')
      await waitForHarnessReady(page, api)
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      const earlierStart = inputTime(Date.parse(`${intendedStart}Z`) - 2 * 60 * 60_000)
      await page.getByLabel('Intended charging start (optional)').fill(earlierStart)
      await page.getByLabel('Maximum site power (W, optional)').fill('2000')
      await page.getByRole('button', { name: 'Save plan' }).click()
      await expect(page.getByText(/Maximum site power:.*entered by you/)).toBeVisible()
      const pendingEarlier = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, {
        data: { state: 'NoPower', advance_seconds: 60, schedule_clock: earlierStart.slice(11) },
      })
      expect(pendingEarlier.status()).toBe(204)
      await page.goto('/action-center?vehicle_id=7')
      await waitForHarnessReady(page, api)
      await expect(shortWindow).toBeVisible()
      await expect(shortWindow.getByText(/limit you entered may not leave enough charge/)).toBeVisible()

      const cleared = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, { data: { state: 'NoPower' } })
      expect(cleared.status()).toBe(204)
      await page.reload()
      await waitForHarnessReady(page, api)
      await expect(schedule).toHaveCount(0)
      await expect(shortWindow).toHaveCount(0)
      const disconnected = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, {
        data: { state: 'Disconnected', advance_seconds: 60 },
      })
      expect(disconnected.status()).toBe(204)
    }
    await page.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(page, api)
    await expect.poll(async () => {
      if (await card.count() === 0) await page.reload()
      return card.count()
    }, { timeout: 15_000 }).toBe(1)

    if (realBackend) {
      const feasibility = page.getByRole('article', { name: 'Charging may not be ready before your trip' })
      for (let minute = 1; minute <= 6; minute++) {
        const fixture = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, {
          data: { state: 'Charging', advance_seconds: 60, power_w: 500 },
        })
        expect(fixture.status()).toBe(204)
        await page.reload()
        await waitForHarnessReady(page, api)
        await expect(feasibility).toHaveCount(minute === 6 ? 1 : 0)
      }
      await expect(feasibility.getByText(/Battery .*Synthetic charging place.*measured.*reserve/)).toBeVisible()
      await expect(feasibility.getByText(/AC current request of 12[.,]00 A and maximum request of 32[.,]00 A/)).toBeVisible()
      await expect(feasibility.getByText(/site electrical limits; the reported maximum does not establish/)).toBeVisible()
      await feasibility.getByRole('button', { name: /Evidence, scoring, and outcomes/ }).click()
      await expect(feasibility.getByText(/assumes constant power and nominal pack energy/).first()).toBeVisible()
      await feasibility.getByRole('button', { name: 'Snooze for 1 hour' }).click()
      await expect(feasibility).toHaveCount(0)
      await page.goto('/settings?vehicle_id=7#smart-charging')
      await waitForHarnessReady(page, api)
      await expect(page.getByText(/Status: Snoozed/)).toBeVisible()
      await page.getByRole('button', { name: 'Check now' }).click()
      await expect(page.getByText(/Status: Active/)).toBeVisible()
    }
    await switchPrincipal(otherSubject, false)
    await page.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(page, api)
    await expect(card).toHaveCount(0)
    await expect(page.getByRole('article', { name: 'Charging may not be ready before your trip' })).toHaveCount(0)
    await expect(schedule).toHaveCount(0)
    await expect(shortWindow).toHaveCount(0)
    await page.goto('/settings?vehicle_id=7#smart-charging')
    await waitForHarnessReady(page, api)
    await expect(page.getByText(/No trip plan is saved/)).toBeVisible()
    await switchPrincipal(primarySubject, variant.open)
    if (realBackend) {
      const fixture = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, {
        data: { state: 'Disconnected', advance_seconds: 60 },
      })
      expect(fixture.status()).toBe(204)
    }
    await page.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(page, api)
    await expect(card).toBeVisible()
    if (realBackend) {
      const fixture = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, {
        data: { state: 'Charging', power_w: 10_000 },
      })
      expect(fixture.status()).toBe(204)
    } else {
      charging = true
    }
    await page.reload()
    await waitForHarnessReady(page, api)
    await expect(card).toHaveCount(0)
    await page.goto('/settings?vehicle_id=7#smart-charging')
    await waitForHarnessReady(page, api)
    if (realBackend) {
      await expect(page.getByText('Compare configured charging prices')).toBeVisible()
      await expect(page.getByText(/charging now is about/)).toContainText('$6.40')
      await expect(page.getByText(/charging now is about/)).toContainText('saving $4.80 (USD)')
      await expect(page.getByText(/taxes, fixed fees and charging losses are excluded/)).toBeVisible()
      await page.getByRole('button', { name: 'Edit' }).click()
      await expect(comparePrices).toBeChecked()
      await comparePrices.click()
      await page.getByRole('button', { name: 'Save plan' }).click()
      await expect(page.getByText('Compare configured charging prices')).toHaveCount(0)
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByRole('switch', { name: 'Estimate outbound and return separately' }).click()
      await page.getByLabel(/Outbound use, low/).fill('20')
      await page.getByLabel(/Outbound use, high/).fill('25')
      await page.getByLabel(/Return use, low/).fill('20')
      await page.getByLabel(/Return use, high/).fill('30')
      await page.getByRole('button', { name: 'Save plan' }).click()
      await expect(page.getByText(/Outbound use: 20.*25.*return use: 20.*30/)).toBeVisible()
      const fixture = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, {
        data: { state: 'Disconnected', advance_seconds: 60 },
      })
      expect(fixture.status()).toBe(204)
      await page.goto('/action-center?vehicle_id=7')
      await waitForHarnessReady(page, api)
      await expect(card).toBeVisible()
      await expect(card.getByText(/estimated charge at the destination.*estimated return charge/)).toBeVisible()
      await page.goto('/settings/smart-charging?vehicle_id=7')
      await waitForHarnessReady(page, api)
      await expect(page.getByText(/return estimate assumes no destination charging/)).toBeVisible()
      await page.getByRole('button', { name: 'Record or update destination charging' }).click()
      await page.getByLabel('Planned charge added at destination (%)').fill('20')
      await page.getByRole('button', { name: 'Save plan' }).click()
      await expect(page.getByText(/Planned destination charge: 20.*not confirmed/)).toBeVisible()
      await page.goto('/action-center?vehicle_id=7')
      await waitForHarnessReady(page, api)
      await expect(card).toHaveCount(0)
      await page.goto('/settings/smart-charging?vehicle_id=7')
      await waitForHarnessReady(page, api)

      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      const start = page.getByLabel('Service appointment starts')
      const end = page.getByLabel('Service appointment ends')
      await expect(page.getByRole('switch', { name: 'Send a private push for a departure conflict' })).not.toBeChecked()
      await page.getByLabel('Planned charge added at destination (%)').fill('')
      await start.fill(inputTime(plannedDeparture - 30 * 60_000))
      await end.fill(inputTime(plannedDeparture + 30 * 60_000))
      await page.getByRole('button', { name: 'Save plan' }).click()
      await expect(page.getByText(/^Service appointment:.*entered by you/)).toBeVisible()
      await page.goto('/action-center?vehicle_id=7')
      await waitForHarnessReady(page, api)
      const service = page.getByRole('article', { name: 'Service appointment overlaps your planned departure' })
      await expect(service).toBeVisible()
      await expect(card).toBeVisible()
      const beforeNavigation = writes.length
      await service.getByRole('button', { name: 'Open source' }).click()
      await expect(page).toHaveURL(/\/settings\/smart-charging\?vehicle_id=7$/)
      expect(writes).toHaveLength(beforeNavigation)
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByLabel('Planned charge added at destination (%)').fill('20')
      await start.fill('')
      await end.fill('')
      await page.getByRole('button', { name: 'Save plan' }).click()
      await expect(page.getByText(/^Service appointment:/)).toHaveCount(0)
      await page.goto('/action-center?vehicle_id=7')
      await waitForHarnessReady(page, api)
      await expect(service).toHaveCount(0)
      await page.goto('/settings/smart-charging?vehicle_id=7')
      await waitForHarnessReady(page, api)

      const fixtureCharging = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, {
        data: { state: 'Charging', power_w: 10_000 },
      })
      expect(fixtureCharging.status()).toBe(204)
      const checkFrom = page.getByLabel(/Check from/)
      const reviewEarlier = page.getByRole('button', { name: 'Review an earlier reminder time' })
      await expect(reviewEarlier).toHaveCount(0)
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      const savedStart = await page.getByLabel(/Intended charging start/).inputValue()
      const lateCheck = inputTime(plannedDeparture - 65 * 60_000)
      await checkFrom.fill(lateCheck)
      await page.getByRole('button', { name: 'Save plan' }).click()
      await expect(checkFrom).toHaveCount(0)
      await expect(reviewEarlier).toBeEnabled()
      const writesBeforeReview = writes.length
      await reviewEarlier.press('Enter')
      const earlierCheck = await checkFrom.inputValue()
      expect(earlierCheck).not.toBe('')
      expect(earlierCheck < lateCheck).toBe(true)
      expect(writes).toHaveLength(writesBeforeReview)
      await expect(checkFrom).toHaveAttribute('readonly', '')
      await page.getByRole('button', { name: 'Save earlier check' }).press('Enter')
      await expect(checkFrom).toHaveCount(0)
      expect(writes.slice(writesBeforeReview)).toEqual([expect.stringMatching(/^PATCH \/api\/v1\/smart-charging\/plans\/\d+$/)])
      await page.reload()
      await waitForHarnessReady(page, api)
      await expect(reviewEarlier).toHaveCount(0)
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await expect(checkFrom).toHaveValue(earlierCheck)
      await expect(page.getByLabel(/Intended charging start/)).toHaveValue(savedStart)
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(page.getByText(/Status: Paused/)).toBeVisible()
    await page.getByRole('button', { name: 'Delete plan' }).click()
    await page.getByRole('dialog', { name: 'Delete this plan?' }).getByRole('button', { name: 'Delete plan' }).click()
    await expect(page.getByText(/No trip plan is saved/)).toBeVisible()
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
    }))
    expect(geometry.document - geometry.viewport).toBeLessThanOrEqual(1)
    expect(api.requests.filter(item => /traffic|command|push\/subscribe/.test(item.path))).toEqual([])
    await assertMockApiComplete(page, api)
  })
}

test('charging site performance requires private consent and can be cleared', async ({ page }) => {
  test.skip(process.env.SMART_CHARGING_REAL_BACKEND !== '1' || process.env.E2E_MOCKS === '0', 'Requires the mounted synthetic charging fixture')
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedBrowserState(page, 'light', '/settings/smart-charging')
  const api = await installApiMocks(page, 'populated', 'light')
  if (!api) throw new Error('Missing isolated API fixtures')
  const subject = 'synthetic-charging-site-a'
  const fixture = await page.request.get(`${process.env.E2E_BASE_URL}/__fixture/trip-stops`)
  expect(fixture.ok()).toBe(true)
  const { revision } = await fixture.json() as { revision: string }
  await installTripFixtures(page, api, () => subject, 'v6', revision)
  const writes: string[] = []
  await page.route(url => url.pathname.startsWith('/api/v1/smart-charging') ||
    url.pathname === '/api/v1/action-center', async route => {
    const request = route.request()
    expect(request.headers()['x-teslasync-expected-principal']).toBe(`subject:${subject}`)
    if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
    await forwardLocalApiFixture(route, api, { ...request.headers(), 'x-test-subject': subject })
  })
  await page.goto('/settings/smart-charging?vehicle_id=7')
  await waitForHarnessReady(page, api)
  const settings = page.getByRole('region', { name: 'Charging at a saved place' })
  const notice = page.getByRole('article', { name: 'Charging has been slower at this place' })
  const enable = settings.getByRole('button', { name: 'Allow this comparison' })
  await expect(enable).toBeDisabled()
  await expect(settings.getByText(/Charging has been slower/)).toHaveCount(0)
  await settings.getByLabel('Place to compare').selectOption('9')
  await enable.click()
  await expect(settings.getByText(/2 recent sessions averaged.*4 comparable sessions/)).toBeVisible()
  await page.goto('/action-center?vehicle_id=7')
  await waitForHarnessReady(page, api)
  await expect(notice).toBeVisible()
  const before = writes.length
  await notice.getByRole('button', { name: 'Open source' }).click()
  await expect(page).toHaveURL(/\/settings\/smart-charging\?vehicle_id=7#site-performance$/)
  await expect(settings.getByRole('heading', { name: 'Charging at a saved place' })).toBeInViewport()
  await expect(settings.getByRole('link', { name: 'Review charging settings' })).toBeVisible()
  expect(writes).toHaveLength(before)
  await settings.getByRole('button', { name: 'Turn off this comparison' }).click()
  await expect(settings.getByText(/Charging has been slower/)).toHaveCount(0)
  await page.goto('/action-center?vehicle_id=7')
  await waitForHarnessReady(page, api)
  await expect(notice).toHaveCount(0)
  expect(writes).toEqual(['PUT /api/v1/smart-charging/site-performance', 'PUT /api/v1/smart-charging/site-performance'])
  await assertMockApiComplete(page, api)
})
