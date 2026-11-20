import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import type { ActionCenterRecommendation, ActionCenterResponse } from '../src/types/actionCenter'
import type { SmartChargingPlan, SmartChargingPlanInput } from '../src/types/smartCharging'
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi'

test.afterAll(async () => { await closeMockApiFixtures() })

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
    let charging = false
    const plans = new Map<string, SmartChargingPlan[]>()
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
        if (request.method() === 'GET') return fulfillApiFixture(route, api, { json: { data: plans.get(scopeKey()) ?? [] } })
        writes.push(`${request.method()} ${path}`)
        if (request.method() === 'POST' && path.endsWith('/plans')) {
          const input = request.postDataJSON() as SmartChargingPlanInput
          const item: SmartChargingPlan = { ...input, id: 8, snoozed_until: null,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          plans.set(scopeKey(), [item])
          return fulfillApiFixture(route, api, { json: { data: item }, status: 201 })
        }
        if (request.method() === 'PUT' && path.endsWith('/plans/8')) {
          const input = request.postDataJSON() as SmartChargingPlanInput
          plans.set(scopeKey(), (plans.get(scopeKey()) ?? []).map(item => ({ ...item, ...input })))
          return fulfillApiFixture(route, api, { json: { data: plans.get(scopeKey())?.[0] } })
        }
        if (request.method() === 'POST' && path.endsWith('/plans/8/snooze')) {
          const input = request.postDataJSON() as { duration_s: number }
          plans.set(scopeKey(), (plans.get(scopeKey()) ?? []).map(item => ({
            ...item, snoozed_until: input.duration_s ? new Date(Date.now() + input.duration_s * 1000).toISOString() : null,
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
    const intendedStart = inputTime(Date.now() + 7 * 60 * 60_000)
    await page.getByLabel(/Known charging place/).selectOption('9')
    const comparePrices = page.getByRole('switch', { name: 'Compare costs using verified place prices' })
    await expect(comparePrices).not.toBeChecked()
    await expect(page.getByRole('link', { name: 'Review charging place prices' })).toHaveAttribute('href', '/geofences')
    await comparePrices.click()
    await expect(comparePrices).toBeChecked()
    await page.getByLabel(/Check from/).fill(inputTime(Date.now() - 60_000))
    await page.getByLabel(/Planned departure/).fill(inputTime(Date.now() + 6 * 60 * 60_000))
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
    const fixture = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, {
      data: { state: 'NoPower', advance_seconds: 60, schedule_clock: intendedStart.slice(11) },
    })
    expect(fixture.status()).toBe(204)
    await page.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(page, api)
    await expect(schedule).toBeVisible()
    await expect(schedule.getByText(/If charging starts at the time you entered/)).toBeVisible()
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
          data: { state: 'Charging', advance_seconds: 60 },
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
    openMode = false
    subject = otherSubject
    await page.goto('/action-center?vehicle_id=7')
    await waitForHarnessReady(page, api)
    await expect(card).toHaveCount(0)
    await expect(page.getByRole('article', { name: 'Charging may not be ready before your trip' })).toHaveCount(0)
    await expect(schedule).toHaveCount(0)
    await page.goto('/settings?vehicle_id=7#smart-charging')
    await waitForHarnessReady(page, api)
    await expect(page.getByText(/No trip plan is saved/)).toBeVisible()
    openMode = variant.open
    subject = primarySubject
    if (realBackend) {
      const cleared = await page.request.post(`${process.env.E2E_BASE_URL}/__fixture/charge`, { data: { state: 'NoPower' } })
      expect(cleared.status()).toBe(204)
      await page.goto('/action-center?vehicle_id=7')
      await waitForHarnessReady(page, api)
      await expect(schedule).toHaveCount(0)
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
