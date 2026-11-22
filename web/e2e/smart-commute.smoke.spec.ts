import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { ActionCenterRecommendation, ActionCenterResponse } from '../src/types/actionCenter'
import type { SmartCommuteRoutine, SmartCommuteSettings } from '../src/types/smartCommute'
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi'

test.afterAll(async () => { await closeMockApiFixtures() })

for (const variant of [
  { name: 'desktop light with sign-in', width: 1440, height: 900, theme: 'light', pack: 'v6', open: false },
  { name: 'mobile dark with sign-in', width: 390, height: 844, theme: 'dark', pack: 'blueprint', open: false },
  { name: 'desktop dark with sign-in', width: 1440, height: 900, theme: 'dark', pack: 'blueprint', open: false },
  { name: 'mobile light with sign-in', width: 390, height: 844, theme: 'light', pack: 'v6', open: false },
  { name: 'desktop light shared installation', width: 1440, height: 900, theme: 'light', pack: 'v6', open: true },
  { name: 'mobile dark shared installation', width: 390, height: 844, theme: 'dark', pack: 'blueprint', open: true },
] as const) {
test(`commute journey stays within its selected ownership scope: ${variant.name}`, async ({ page }) => {
  test.setTimeout(120_000)
  test.skip(process.env.E2E_MOCKS === '0', 'This journey uses synthetic subjects and local fixtures')
  await page.setViewportSize({ width: variant.width, height: variant.height })
  await seedBrowserState(page, variant.theme, '/settings')
  const api = await installApiMocks(page, 'populated', variant.theme)
  if (!api) throw new Error('Missing isolated API fixtures')
  const primarySubject = `synthetic-${variant.width}-${variant.theme}-a`
  const otherSubject = `synthetic-${variant.width}-${variant.theme}-b`
  const realBackend = process.env.SMART_COMMUTE_REAL_BACKEND === '1'
  let subject = primarySubject
  let openMode: boolean = variant.open
  const scopeKey = () => openMode ? 'shared-open' : subject
  const expectedPrincipal = () => openMode ? 'open' : `subject:${subject}`
  await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
    if (route.request().method() !== 'GET') return route.fallback()
    return fulfillApiFixture(route, api, {
      json: {
        scope: createHash('sha256').update(openMode ? 'open' : `forward_auth:${subject}`).digest('hex'),
        pack_id: variant.pack, app_wide: true,
      },
    })
  })
  const emptySettings = (): SmartCommuteSettings => ({
    vehicle_id: 7, enabled: false, local_analysis_enabled: false, paused: false, time_zone: '',
  })
  const settings = new Map<string, SmartCommuteSettings>()
  const routines = new Map<string, SmartCommuteRoutine[]>()
  const suggestion: SmartCommuteRoutine = {
    id: 8, vehicle_id: 7, status: 'suggested', name: '', weekday: 2,
    departure_s: 28800, time_zone: 'America/Los_Angeles',
    origin: { latitude: 47.1, longitude: -122.1 },
    destination: { latitude: 47.2, longitude: -122.2 },
    evidence: {
      matching_days: 7, window_start_s: 28500, window_end_s: 29100,
      first_observed_at: '2026-02-01T16:00:00Z', last_observed_at: '2026-04-01T15:00:00Z',
    },
    snoozed_until: null,
    created_at: '2026-04-01T15:00:00Z', updated_at: '2026-04-01T15:00:00Z',
  }
  const writes: string[] = []
  const recommendation: ActionCenterRecommendation = {
    id: 'ac_0123456789abcdef01234567', fingerprint: 'a'.repeat(64),
    source_feature: 'smart_commute', related_sources: ['smart_commute'],
    vehicle: { id: 7, display_name: 'Synthetic vehicle' },
    title: 'Is this your regular Tuesday drive?', summary: 'Synthetic commute evidence',
    rationale: 'Locally analyzed completed drives have similar departure times and endpoints.',
    priority: 'low', severity: 'info',
    rank: { score: 240, basis: [] }, confidence: { score: 0.8, label: 'high', basis: [] },
    evidence: [{
      id: 'routine:8', kind: 'recurring_drive', summary: 'Synthetic commute evidence',
      provenance: { source: 'local_drive_analysis', record_id: 'routine:8', source_url: null },
      observed_at: '2026-04-01T15:00:00Z',
      recurring_drive: {
        routine_id: 8, weekday: 2, matching_days: 7, window_start_s: 28500, window_end_s: 29100,
        time_zone: 'America/Los_Angeles', destination_latitude: 47.2, destination_longitude: -122.2,
      },
    }],
    projected_impact: null,
    safe_actions: ['navigate', 'smart_commute_use', 'smart_commute_edit', 'smart_commute_decline', 'smart_commute_snooze'],
    navigation_path: '/settings?vehicle_id=7#smart-commute',
    expires_at: '2099-01-01T00:00:00Z',
    freshness: { status: 'fresh', observed_at: '2026-04-01T15:00:00Z', age_s: 60 },
    limitations: [], current_state: { status: 'open', version: 0, snoozed_until: null, updated_at: null },
    action_history: [],
  }
  await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
    json: { mode: openMode ? 'open' : 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
  }))
  await page.route('**/api/v1/smart-delivery/devices', route => fulfillApiFixture(route, api, {
    json: { data: { available: false, commute_available: false, public_key: '', devices: [] } },
  }))
  if (realBackend) {
    await page.route(url => url.pathname.startsWith('/api/v1/smart-commute') ||
      url.pathname === '/api/v1/action-center' ||
      /^\/api\/v1\/action-center\/[^/]+\/history$/.test(url.pathname), async route => {
      const request = route.request()
      expect(request.headers()['x-teslasync-expected-principal']).toBe(expectedPrincipal())
      if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
      await forwardLocalApiFixture(route, api, {
        ...request.headers(), 'x-test-subject': subject, 'x-test-open': openMode ? '1' : '0',
      })
    })
  } else {
    await page.route('**/api/v1/smart-commute**', async route => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      expect(request.headers()['x-teslasync-expected-principal']).toBe(expectedPrincipal())
      if (request.method() === 'GET') {
        return fulfillApiFixture(route, api, {
          json: { data: { settings: settings.get(scopeKey()) ?? emptySettings(), routines: routines.get(scopeKey()) ?? [] } },
        })
      }
      writes.push(`${request.method()} ${path}`)
      if (request.method() === 'PUT' && path.endsWith('/smart-commute')) {
        const saved = request.postDataJSON() as SmartCommuteSettings
        settings.set(scopeKey(), saved)
        routines.set(scopeKey(), saved.local_analysis_enabled ? [suggestion] : [])
        return fulfillApiFixture(route, api, { status: 204 })
      }
      if (request.method() === 'DELETE' && path.endsWith('/smart-commute')) {
        settings.delete(scopeKey())
        routines.delete(scopeKey())
        return fulfillApiFixture(route, api, { status: 204 })
      }
      if (request.method() === 'PUT' && path.endsWith('/routines/8')) {
        const input = request.postDataJSON() as Pick<SmartCommuteRoutine, 'name'>
        routines.set(scopeKey(), [{ ...suggestion, name: input.name, status: 'confirmed', evidence: null }])
        return fulfillApiFixture(route, api, { json: { data: routines.get(scopeKey())?.[0] } })
      }
      if (request.method() === 'POST' && path.endsWith('/routines/8/snooze')) {
        const input = request.postDataJSON() as { duration_s: number }
        const current = routines.get(scopeKey()) ?? []
        routines.set(scopeKey(), current.map(item => ({
          ...item, snoozed_until: input.duration_s ? new Date(Date.now() + input.duration_s * 1000).toISOString() : null,
        })))
        return fulfillApiFixture(route, api, { status: 204 })
      }
      throw new Error(`Unexpected Smart Commute request: ${request.method()} ${path}`)
    })
    await page.route(url => url.pathname === '/api/v1/action-center', route => {
      expect(route.request().method()).toBe('GET')
      expect(route.request().headers()['x-teslasync-expected-principal']).toBe(expectedPrincipal())
      const items = (routines.get(scopeKey()) ?? []).some(item => item.status === 'suggested' && !item.snoozed_until)
        ? [recommendation] : []
      const response: ActionCenterResponse = {
        items, total: items.length, limit: 50, offset: 0, generated_at: '2026-04-01T15:00:00Z',
        summary: { open: items.length, acknowledged: 0, snoozed: 0, dismissed: 0, critical: 0, high: 0 },
        provider_status: [{ source_feature: 'smart_commute', status: 'available', item_count: items.length, limitations: [] }],
      }
      return fulfillApiFixture(route, api, { json: response })
    })
    await page.route(url => url.pathname === `/api/v1/action-center/${recommendation.id}/history`, route => {
      expect(route.request().headers()['x-teslasync-expected-principal']).toBe(expectedPrincipal())
      return fulfillApiFixture(route, api, { json: { items: [], total: 0, limit: 25, offset: 0 } })
    })
  }

  await page.goto('/settings?vehicle_id=7#smart-commute')
  await waitForHarnessReady(page, api)
  await expect(page).toHaveURL(/\/settings\/smart-commute\?vehicle_id=7$/)
  await expect(page.getByRole('heading', { name: 'Smart Commute' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', variant.pack)
  if (variant.width >= 1280) {
    if (variant.pack === 'v6') {
      const trigger = page.getByRole('navigation', { name: 'Primary' })
        .getByRole('button', { name: 'Notifications', exact: true })
      await expect(trigger).toHaveAttribute('aria-current', 'true')
      await trigger.click()
      const navigation = page.locator('[data-role="section-flyout"]')
      await expect(navigation.getByRole('menuitem', { name: /^Smart notifications/ })).toHaveAttribute('aria-expanded', 'true')
      await expect(navigation.getByRole('menuitem', { name: 'Smart Commute', exact: true })).toBeVisible()
      await expect(navigation.getByRole('menuitem', { name: 'Charging readiness', exact: true })).toBeVisible()
      await trigger.click()
    } else {
      const navigation = page.getByTestId('command-deck-secondary')
      await expect(navigation.getByRole('button', { name: 'Smart notifications' })).toHaveAttribute('aria-expanded', 'true')
      await expect(navigation.getByRole('link', { name: 'Smart Commute', exact: true })).toBeVisible()
      await expect(navigation.getByRole('link', { name: 'Charging readiness', exact: true })).toBeVisible()
    }
  }
  await expect(page.getByText('Shared installation')).toHaveCount(0)
  if (openMode) await expect(page.getByText(/Without sign-in, anyone with access to TeslaSync can view and manage these routines/)).toBeVisible()
  const enable = page.getByRole('switch', { name: /Enable Smart Commute/ })
  const analysis = page.getByRole('switch', { name: /Allow local analysis/ })
  const pause = page.getByRole('switch', { name: /Pause Smart Commute/ })
  await expect(enable).not.toBeChecked()
  await expect(analysis).toBeDisabled()
  const boxes = await Promise.all([enable, analysis, pause].map(toggle => toggle.boundingBox()))
  for (let index = 1; index < boxes.length; index++) {
    expect(boxes[index]).not.toBeNull()
    expect(boxes[index - 1]).not.toBeNull()
    expect(boxes[index]!.y).toBeGreaterThanOrEqual(boxes[index - 1]!.y + boxes[index - 1]!.height + 8)
  }
  const screenshotDir = process.env.SMART_COMMUTE_SCREENSHOT_DIR
  const screenshotName = variant.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  if (screenshotDir) {
    await page.screenshot({ path: join(screenshotDir, `${screenshotName}-off.png`), fullPage: true })
    await pause.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(screenshotDir, `${screenshotName}-controls-off.png`), fullPage: true })
  }
  expect(writes).toEqual([])

  await page.getByLabel('Time zone for local analysis').fill('America/Los_Angeles')
  await enable.click()
  await expect(analysis).toBeEnabled()
  await expect(analysis).not.toBeChecked()
  await analysis.click()
  await expect(page.getByText('Is this your regular Tuesday drive?')).toBeVisible()
  await expect(page.getByText(/7 matching days/)).toBeVisible()
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${screenshotName}-on.png`), fullPage: true })

  await page.goto('/action-center?vehicle_id=7')
  await waitForHarnessReady(page, api)
  const card = page.getByRole('article', { name: 'Is this your regular Tuesday drive?' })
  await expect(card).toBeVisible()
  await expect(page.getByText('Shared installation')).toHaveCount(0)
  await expect(card.getByText(/7 matching departure days/)).toBeVisible()
  await card.getByRole('button', { name: /Evidence, scoring, and outcomes/ }).click()
  await expect(card.getByText('Local completed-drive analysis').first()).toBeVisible()
  await card.getByRole('button', { name: 'Snooze for 24 hours' }).click()
  await expect(card).toHaveCount(0)
  await page.goto('/settings/smart-commute?vehicle_id=7')
  await waitForHarnessReady(page, api)
  await expect(page.getByText(/Snoozed until/)).toBeVisible()
  await page.getByRole('button', { name: 'Show suggestion now' }).click()
  await expect(page.getByRole('button', { name: 'Snooze for 24 hours' })).toBeVisible()
  await page.goto('/action-center?vehicle_id=7')
  await waitForHarnessReady(page, api)
  await expect(card).toBeVisible()

  openMode = false
  subject = otherSubject
  await page.reload()
  await waitForHarnessReady(page, api)
  await expect(card).toHaveCount(0)
  await page.goto('/settings/smart-commute?vehicle_id=7')
  await waitForHarnessReady(page, api)
  await expect(enable).not.toBeChecked()
  await expect(page.getByText('Is this your regular Tuesday drive?')).toHaveCount(0)

  openMode = variant.open
  subject = primarySubject
  await page.goto('/action-center?vehicle_id=7')
  await waitForHarnessReady(page, api)
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Not mine', exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Use routine' }).click()
  await page.getByLabel(/Routine name/).fill('Studio')
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(geometry.document - geometry.viewport).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Save routine' }).click()
  await expect(card).toHaveCount(0)
  await page.goto('/settings/smart-commute?vehicle_id=7')
  await waitForHarnessReady(page, api)
  await expect(page.getByText('Studio', { exact: true })).toBeVisible()

  if (variant.open) {
    await page.getByRole('button', { name: 'Delete my Smart Commute data' }).click()
    await page.getByRole('dialog', { name: 'Delete your Smart Commute data?' })
      .getByRole('button', { name: 'Delete data' }).click()
    await expect(enable).not.toBeChecked()
  }

  openMode = false
  subject = otherSubject
  await page.reload()
  await waitForHarnessReady(page, api)
  await expect(page.getByText('Studio', { exact: true })).toHaveCount(0)
  await expect(enable).not.toBeChecked()
  expect(api.requests.filter(item => /traffic|command|push\/subscribe/.test(item.path))).toEqual([])
  await assertMockApiComplete(page, api)
})
}
