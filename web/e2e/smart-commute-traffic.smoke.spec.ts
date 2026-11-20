import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks, seedBrowserState,
} from './mockApi'

test.afterAll(async () => { await closeMockApiFixtures() })

test('reviewed traffic check surfaces a private, read-only comparison after the browser is closed', async ({ context, page, request }) => {
  test.setTimeout(120_000)
  test.skip(process.env.SMART_COMMUTE_REAL_BACKEND !== '1', 'Covered by the real-handler private notifications job')
  const fixture = await request.get('/__fixture/traffic')
  expect(fixture.ok()).toBe(true)
  const { drive, now } = await fixture.json() as { drive: { id: number }; now: string }
  const owner = 'synthetic-traffic-owner'
  const writes: string[] = []
  async function prepare(tab: Page, subject: string) {
    await tab.clock.setFixedTime(new Date(now))
    await seedBrowserState(tab, 'light', '/settings/smart-commute')
    const api = await installApiMocks(tab, 'populated', 'light')
    if (!api) throw new Error('Missing isolated API fixtures')
    await tab.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
      json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
    }))
    await tab.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
      if (route.request().method() !== 'GET') return route.fallback()
      return fulfillApiFixture(route, api, {
        json: {
          scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'),
          pack_id: 'v6', app_wide: true,
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
  const enabled = page.getByRole('switch', { name: /Enable Smart Commute/ })
  await expect(enabled).not.toBeChecked()
  await page.getByLabel('Time zone for local analysis').fill('America/Los_Angeles')
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
  expect((await (await request.get('/__fixture/traffic')).json()).outbound).toBe(0)
  await page.getByRole('switch', { name: /Allow sharing this trace with HERE/ }).click()
  await consent.click()
  await expect(page.getByRole('button', { name: 'Disconnect HERE' })).toBeVisible()
  await assertMockApiComplete(page, ownerAPI)
  await page.close()

  expect((await request.post('/__fixture/traffic')).status()).toBe(204)
  expect((await request.post('/__fixture/traffic')).status()).toBe(204)
  expect((await (await request.get('/__fixture/traffic')).json()).outbound).toBe(1)
  const following = await context.newPage()
  const followingAPI = await prepare(following, owner)
  await following.goto('/action-center?vehicle_id=42')
  const before = writes.length
  await following.getByRole('button', { name: 'Compare routes', exact: true }).click()
  await expect(following.getByText('Faster alternative: 29 min', { exact: true })).toBeVisible()
  await expect(following.getByText('Estimated saving: 14 min', { exact: true })).toBeVisible()
  await expect(following.getByText('Synthetic office · Synthetic vehicle A', { exact: true })).toBeVisible()
  expect(writes.length).toBe(before)
  const link = following.url()
  expect(new URL(link).searchParams.get('traffic_occurrence_id')).toMatch(/^[a-f0-9]{32}$/)
  await assertMockApiComplete(following, followingAPI)
  expect(followingAPI.requests.filter(item => /\/commands?(?:\/|$)/.test(item.path))).toEqual([])

  const foreign = await context.newPage()
  const foreignAPI = await prepare(foreign, 'other-synthetic-user')
  await foreign.goto(link)
  await expect(foreign.getByText(/This comparison is no longer available/)).toBeVisible()
  await expect(foreign.getByText('Faster alternative: 29 min')).toHaveCount(0)
  await assertMockApiComplete(foreign, foreignAPI)
  await foreign.close()

  await following.getByRole('button', { name: 'Skip today', exact: true }).click()
  await expect(following.getByText(/This comparison is no longer available/)).toBeVisible()
  await following.getByRole('button', { name: 'Disconnect HERE', exact: true }).click()
  await expect(following.getByRole('button', { name: 'Set up traffic checks' })).toBeVisible()
  expect((await request.post('/__fixture/traffic')).status()).toBe(204)
  expect((await (await request.get('/__fixture/traffic')).json()).outbound).toBe(1)
  await assertMockApiComplete(following, followingAPI)
})
