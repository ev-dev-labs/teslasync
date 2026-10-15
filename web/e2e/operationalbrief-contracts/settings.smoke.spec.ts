import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  assertMockApiComplete,
  expectThemeApplied,
  waitForHarnessReady,
} from '../mockApi'
import { expectDialogsInsideViewport, expectNoHorizontalOverflow } from '../qualityAssertions'
import {
  accountSessions,
  deploymentVersion,
  expectSettingsReadOnly,
  fleetApiInfo,
  installSettingsFixtures,
  publicKey,
  savedSettings,
  usageToday,
  zeroUsage,
  type SettingsTheme,
} from './settings.fixtures'

function metric(brief: Locator, id: string) {
  return brief.locator(`[data-operational-metric="${id}"]`)
}

async function expectValue(brief: Locator, id: string, value: string) {
  const item = metric(brief, id)
  await expect(item).toHaveAttribute('data-value-state', 'value')
  await expect(item.locator('[data-operational-value]')).toHaveText(value)
}

async function expectMissing(brief: Locator, id: string) {
  const item = metric(brief, id)
  await expect(item).toHaveAttribute('data-value-state', 'missing')
  await expect(item.locator('[data-operational-value]')).toHaveText('—')
}

async function expectBrief(brief: Locator, count: number, source: string, status = 'Source available') {
  await expect(brief).toBeVisible()
  await expect(brief).toHaveAttribute('data-operational-brief', 'true')
  await expect(brief.locator('[data-operational-metric]')).toHaveCount(count)
  await expect(brief).toContainText(source)
  await expect(brief).toContainText(status)
  const overflow = await brief.locator('[data-operational-metric]').evaluateAll(items => items.flatMap(item => {
    const bounds = item.getBoundingClientRect()
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
    const escaped: string[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      if ([...range.getClientRects()].some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) {
        escaped.push(node.textContent)
      }
    }
    return escaped
  }))
  expect(overflow, 'Published preference, source and cost text must not clip inside summary cells').toEqual([])
}

async function reviewWithKeyboard(page: Page, brief: Locator, title: string, source: string) {
  const published = await brief.locator('[data-operational-metric]').allTextContents()
  const values = await brief.locator('[data-operational-value]').allTextContents()
  const details = await brief.locator('[data-operational-metric] > div:last-child').allTextContents()
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true })
  await trigger.focus()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog', { name: `${title} details`, exact: true })
  await expect(drawer).toBeVisible()
  await expect(drawer).toHaveAttribute('aria-modal', 'true')
  await expect(drawer.getByTestId('operational-narrative')).toContainText(source)
  await expect(drawer).toContainText('Operational metrics')
  const labels = await brief.locator('[data-operational-metric]').evaluateAll(items =>
    items.map(item => item.firstElementChild?.firstElementChild?.textContent ?? ''))
  for (const label of labels) {
    expect(label.trim(), 'Each published metric has an accessible label').not.toBe('')
    await expect(drawer).toContainText(label.trim())
  }
  for (const value of values) await expect(drawer).toContainText(value.trim())
  for (const detail of details) await expect(drawer).toContainText(detail.trim())
  const close = drawer.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeFocused()
  const actions = await drawer.locator('button:visible, a[href]:visible, input:visible, select:visible').count()
  for (let index = 0; index <= actions; index += 1) {
    await page.keyboard.press('Tab')
    expect(await drawer.evaluate(node => node.contains(document.activeElement)),
      'Forward keyboard traversal must stay inside the real drawer').toBe(true)
  }
  await page.keyboard.press('Shift+Tab')
  expect(await drawer.evaluate(node => node.contains(document.activeElement)),
    'Reverse keyboard traversal must stay inside the real drawer').toBe(true)
  await expectDialogsInsideViewport(page)
  const panel = drawer.locator('[data-drawer-panel]')
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1),
    'The real Review drawer must not horizontally clip metric values or rich context').toBe(true)
  await expectNoHorizontalOverflow(page)
  await expect(brief.locator('[data-operational-metric]')).toHaveText(published)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(brief.locator('[data-operational-metric]')).toHaveText(published)
}

async function selectCategory(page: Page, width: number, id: string, label: RegExp) {
  if (width < 1024) {
    await page.getByRole('combobox', { name: 'Settings categories', exact: true }).selectOption(id)
  } else {
    await page.getByRole('navigation', { name: 'Settings categories', exact: true })
      .getByRole('button', { name: label }).click()
  }
}

const layouts = [320, 1440].flatMap(width =>
  (['dark', 'light'] as const).map(theme => ({ width, theme })))

for (const { width, theme } of layouts) {
  const suffix = `${width}px ${theme}`

  test(`settings saved preferences, comparison rate, shortcuts and unsaved forms survive Review at ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const settings = savedSettings(theme, {
      unit_of_length: 'mi', unit_of_temp: 'F', unit_of_pressure: 'psi',
      preferred_range: 'ideal', currency_symbol: '€', locale: 'de-DE',
      decimal_precision: 4, base_cost_per_kwh: 0.12345,
    })
    const { api } = await installSettingsFixtures(page, theme, '/settings', { settings })
    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await expectThemeApplied(page, theme)
    const brief = page.getByTestId('settings-preferences-summary')
    await expectBrief(brief, 7, 'Saved settings and browser font preferences')
    for (const [id, value] of [
      ['settings-preference-0', 'mi'], ['settings-preference-1', '°F'],
      ['settings-preference-2', 'psi'], ['settings-preference-3', 'EN'],
      ['settings-preference-4', '€'], ['settings-preference-5', '€0,1235'],
    ]) await expectValue(brief, id, value)
    await expect(metric(brief, 'settings-preference-0')).toContainText('Ideal')
    await expect(metric(brief, 'settings-preference-3')).toContainText('English')
    await expect(metric(brief, 'settings-preference-5')).toContainText('per kWh')
    await expect(metric(brief, 'settings-preference-6')).toContainText('100%')
    await expect(brief).toContainText('These are configuration choices, not vehicle measurements.')
    await reviewWithKeyboard(page, brief, 'Preferences at a glance', 'Saved settings and browser font preferences')
    const shortcuts = page.getByRole('region', { name: 'Settings shortcuts', exact: true })
    await expect(shortcuts.getByRole('link', { name: /Data export/ })).toHaveAttribute('href', '/data-export')
    await expect(shortcuts.getByRole('button', { name: /Open tour launcher/i })).toBeVisible()
    await selectCategory(page, width, 'general', /Units, language & costs/)
    const distance = page.getByRole('combobox', { name: /^Distance Unit$/i })
    await expect(distance).toHaveValue('mi')
    await distance.selectOption('km')
    await expect(page.locator('#general [data-operational-brief]')).toHaveCount(0)
    await selectCategory(page, width, 'typography', /Fonts & readability/)
    await expect(page.locator('#typography')).toBeVisible()
    await selectCategory(page, width, 'general', /Units, language & costs/)
    await expect(distance).toHaveValue('km')
    await selectCategory(page, width, 'overview', /^Overview/)
    await expectValue(brief, 'settings-preference-0', 'mi')
    await expectValue(brief, 'settings-preference-5', '€0,1235')
    await expectNoHorizontalOverflow(page)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`Helix draft status and audited tiny cost preserve independent sources and controls at ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const settings = savedSettings(theme, {
      ai_mode: 'local', ai_features: {}, currency_symbol: '€',
      locale: 'de-DE', decimal_precision: 4,
      ai_provider_config: {
        default: 'ollama',
        ollama: { base_url: 'http://127.0.0.1:11434', model: 'synthetic-local-model' },
      },
    })
    const { api } = await installSettingsFixtures(page, theme, '/integrations/helix', { settings })
    await page.goto('/integrations/helix', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await expectThemeApplied(page, theme)
    const status = page.getByTestId('helix-summary')
    await expectBrief(status, 4, 'Configuration draft and audited usage')
    await expectValue(status, 'helix-mode', 'Local-only')
    await expectValue(status, 'helix-features', '0')
    await expectValue(status, 'helix-provider', 'Ollama')
    await expectValue(status, 'helix-spend', '€0,0012')
    await expect(status).toContainText('Editing a draft does not save it.')
    await expect(status).toContainText('spend today in UTC')
    await reviewWithKeyboard(page, status, 'Helix configuration and spend', 'Configuration draft and audited usage')
    const usage = page.getByTestId('helix-usage-summary')
    await expectBrief(usage, 3, 'Helix daily usage audit')
    await expectValue(usage, 'helix-input-tokens', '1.250')
    await expectValue(usage, 'helix-output-tokens', '420')
    await expectValue(usage, 'helix-estimated-cost', '€0,001200')
    await expect(page.getByTestId('ai-usage-card')).toContainText('3 calls · 1 error')
    await reviewWithKeyboard(page, usage, 'Audited usage totals', 'Helix daily usage audit')
    const explorer = page.getByTestId('ai-feature-toggle-list')
    await explorer.getByRole('searchbox', { name: 'Search AI features' }).fill('chat')
    const chat = explorer.getByRole('switch', { name: 'Helix chat (side panel)' })
    await expect(chat).toHaveAttribute('aria-checked', 'false')
    await chat.click()
    await expect(chat).toHaveAttribute('aria-checked', 'true')
    await expectValue(status, 'helix-features', '1')
    await expect(explorer.locator('[data-operational-brief]')).toHaveCount(0)
    await expect(page.getByTestId('ai-provider-section').locator('[data-operational-brief]')).toHaveCount(0)
    await expect(page.getByTestId('ai-settings-save')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expectSettingsReadOnly(api)
    expect(api.seen.has('GET /ai/usage/today')).toBe(true)
    await assertMockApiComplete(page, api)
  })

  test(`sessions retain counts, device and network context and separate sign-out controls at ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { api } = await installSettingsFixtures(page, theme, '/account/sessions', { sessions: accountSessions })
    await page.goto('/account/sessions', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await expectThemeApplied(page, theme)
    const brief = page.getByTestId('sessions-summary')
    await expectBrief(brief, 4, 'Account session list')
    await expectValue(brief, 'sessions-total', '2')
    await expectValue(brief, 'sessions-other', '1')
    await expectValue(brief, 'sessions-current', 'Chrome · Windows')
    await expect(metric(brief, 'sessions-current')).toContainText('192.0.2.10')
    await expect(metric(brief, 'sessions-last')).toHaveAttribute('data-value-state', 'value')
    await expect(brief).toContainText('not a historical activity range')
    await reviewWithKeyboard(page, brief, 'Session overview', 'Account session list')
    await expect(page.getByRole('heading', { name: 'Device breakdown', exact: true })).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()
    await page.getByTestId('active-sessions-revoke-all-others').click()
    const confirmation = page.getByRole('dialog', { name: 'Sign out all other devices?', exact: true })
    await expect(confirmation).toBeVisible()
    await expect(confirmation.locator('[data-operational-brief]')).toHaveCount(0)
    await expectDialogsInsideViewport(page)
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expectValue(brief, 'sessions-total', '2')
    await expectNoHorizontalOverflow(page)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`TOTP measured zero recovery codes keep credential and RFC detail at ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { api } = await installSettingsFixtures(page, theme, '/account/2fa')
    await page.goto('/account/2fa', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await expectThemeApplied(page, theme)
    const brief = page.getByTestId('totp-summary')
    await expectBrief(brief, 4, 'Account two-factor status')
    await expectValue(brief, 'totp-status', 'Active')
    await expectValue(brief, 'totp-lastUsed', 'Never')
    await expectValue(brief, 'totp-backup', '0')
    await expectValue(brief, 'totp-method', 'TOTP')
    await expect(metric(brief, 'totp-method')).toContainText('RFC 6238')
    await reviewWithKeyboard(page, brief, 'Two-factor overview', 'Account two-factor status')
    await expect(page.getByRole('region', { name: 'Manage two-factor authentication', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Two-factor apps and recovery', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`safety zero safeguards retain cadence, quiet-window and all seven documentation links at ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const settings = savedSettings(theme, {
      quiet_hours_enabled: false, critical_flash_enabled: false, tab_badge_enabled: false,
      alert_digest_mode: 'hourly', api_suspended: false,
    })
    const { api } = await installSettingsFixtures(page, theme, '/settings/safety', { settings })
    await page.goto('/settings/safety', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await expectThemeApplied(page, theme)
    const brief = page.getByTestId('safety-settings-summary')
    await expectBrief(brief, 4, 'Install settings')
    await expectValue(brief, 'safety-safeguards', '0 / 3')
    await expectValue(brief, 'safety-quiet-window', 'Off')
    await expectValue(brief, 'safety-cadence', 'Hourly')
    await expectValue(brief, 'safety-api', 'Active')
    await expect(metric(brief, 'safety-quiet-window')).toContainText('Always delivering')
    await reviewWithKeyboard(page, brief, 'Safety configuration', 'Install settings')
    const listing = page.getByTestId('safety-settings-listing')
    await expect(listing.locator('[data-testid^="safety-settings-row-"]')).toHaveCount(7)
    const docs = listing.getByRole('link')
    await expect(docs).toHaveCount(7)
    expect(await docs.evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual([
      '/docs/notifications/quiet-hours.md', '/docs/notifications/quiet-hours.md',
      '/docs/notifications/quiet-hours.md', '/docs/notifications/digest.md',
      '/docs/notifications/tab-signalling.md', '/docs/notifications/tab-signalling.md',
      '/docs/operations/api-suspended.md',
    ])
    for (const link of await docs.all()) {
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute('aria-label', /.+/)
    }
    await expect(listing.locator('[data-operational-brief]')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`privacy preserves local consent controls, policy source and measured cleared-history zero at ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { api } = await installSettingsFixtures(page, theme, '/account/privacy')
    await page.goto('/account/privacy', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await expectThemeApplied(page, theme)
    const brief = page.getByTestId('privacy-summary')
    await expectBrief(brief, 4, 'Browser privacy', 'Deployment policy available')
    await expectValue(brief, 'privacy-recent', '3')
    await expect(metric(brief, 'privacy-recent')).toContainText('of 50 max')
    await expectValue(brief, 'privacy-consent', 'Accepted')
    await expectValue(brief, 'privacy-policy', 'Optional')
    await expectValue(brief, 'privacy-scope', 'This browser')
    await expect(metric(brief, 'privacy-scope')).toContainText('Local only — never synced')
    await reviewWithKeyboard(page, brief, 'Browser-local privacy', 'Browser-local privacy and deployment policy')
    await page.getByTestId('privacy-consent-decline').click()
    await expectValue(brief, 'privacy-consent', 'Declined')
    await expect(page.getByTestId('privacy-consent-state')).toHaveAttribute('data-consent-state', 'declined')
    await page.getByTestId('privacy-consent-accept').click()
    await expectValue(brief, 'privacy-consent', 'Accepted')
    await expect(page.getByTestId('privacy-consent-state')).toHaveAttribute('data-consent-state', 'accepted')
    await page.getByTestId('privacy-clear-recent-pages').click()
    const confirm = page.getByRole('dialog', { name: 'Clear recent pages?', exact: true })
    await expect(confirm).toBeVisible()
    await expectDialogsInsideViewport(page)
    await confirm.getByRole('button', { name: 'Clear pages', exact: true }).click()
    await expectValue(brief, 'privacy-recent', '0')
    await expect(page.getByTestId('privacy-recent-count')).toContainText('0')
    await expect(page.getByTestId('privacy-consent-section').locator('[data-operational-brief]')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`fleet setup keeps independently sourced statuses, fingerprint and guided form at ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { api } = await installSettingsFixtures(page, theme, '/settings/fleet-setup', { fleet: true })
    await page.goto('/settings/fleet-setup', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await expectThemeApplied(page, theme)
    const brief = page.getByTestId('fleet-setup-summary')
    await expectBrief(brief, 4, 'Fleet setup checks')
    await expectValue(brief, 'fleet-setup-account', 'Connected')
    await expectValue(brief, 'fleet-setup-token', 'Auto-refresh on')
    await expectValue(brief, 'fleet-setup-domain', 'Published')
    await expectValue(brief, 'fleet-setup-stream', 'Streaming')
    await expect(metric(brief, 'fleet-setup-domain')).toContainText(publicKey.fingerprint)
    await expect(metric(brief, 'fleet-setup-stream')).toContainText('Packets arrived in the last 24 hours.')
    await reviewWithKeyboard(page, brief, 'Fleet setup overview', 'Fleet setup checks')
    await expect(page.locator('#fleet-setup-account')).toBeVisible()
    await expect(page.locator('#fleet-setup-subscribe').getByRole('combobox', { name: 'Vehicle', exact: true })).toBeVisible()
    await expect(page.locator('#fleet-setup-subscribe [data-operational-brief]')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Streaming and domain readiness', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Fleet API tools', exact: true }))
      .toHaveAttribute('href', '/dev-tools?tab=fleet-api')
    await expectNoHorizontalOverflow(page)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })
}

for (const theme of ['dark', 'light'] as const) {
  for (const rate of [0, null, undefined]) {
    test(`settings distinguishes comparison rate ${String(rate)} from invented zero in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 900 })
      const settings = { ...savedSettings(theme), base_cost_per_kwh: rate }
      const { api } = await installSettingsFixtures(page, theme, '/settings', { settings })
      await page.goto('/settings', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)
      const brief = page.getByTestId('settings-preferences-summary')
      if (rate === 0) await expectValue(brief, 'settings-preference-5', '$0.00')
      else await expectMissing(brief, 'settings-preference-5')
      await expect(metric(brief, 'settings-preference-5')).toContainText('per kWh')
      await expectValue(brief, 'settings-preference-0', 'km')
      await reviewWithKeyboard(page, brief, 'Preferences at a glance', 'Saved settings and browser font preferences')
      await expectNoHorizontalOverflow(page)
      expectSettingsReadOnly(api)
      await assertMockApiComplete(page, api)
    })
  }

  test(`Helix successful zero audit differs from off-mode unavailable spend in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    const settings = savedSettings(theme, { ai_mode: 'local', ai_features: {} })
    const { api } = await installSettingsFixtures(page, theme, '/integrations/helix', { settings, usage: zeroUsage })
    await page.goto('/integrations/helix', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const usage = page.getByTestId('helix-usage-summary')
    await expectValue(usage, 'helix-input-tokens', '0')
    await expectValue(usage, 'helix-output-tokens', '0')
    await expectValue(usage, 'helix-estimated-cost', '$0.00')
    await expect(page.getByTestId('ai-usage-card')).toContainText('No Helix calls yet today.')
    await reviewWithKeyboard(page, usage, 'Audited usage totals', 'Helix daily usage audit')
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`saved Helix off mode keeps status and zero features without querying usage in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    const { api } = await installSettingsFixtures(page, theme, '/integrations/helix')
    await page.goto('/integrations/helix', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const brief = page.getByTestId('helix-summary')
    await expectValue(brief, 'helix-mode', 'Off (default)')
    await expectValue(brief, 'helix-features', '0')
    await expectMissing(brief, 'helix-provider')
    await expectMissing(brief, 'helix-spend')
    await expect(metric(brief, 'helix-spend')).toContainText('Helix is off.')
    await reviewWithKeyboard(page, brief, 'Helix configuration and spend', 'Configuration draft and audited usage')
    await expect(page.getByTestId('ai-usage-card')).toHaveCount(0)
    expect(api.requests.filter(request => request.path.startsWith('/api/v1/ai/usage/'))).toEqual([])
    await expectNoHorizontalOverflow(page)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`empty session list is measured zero and not a missing source in ${theme}`, async ({ page }) => {
    const { api } = await installSettingsFixtures(page, theme, '/account/sessions', {
      sessions: { mode: 'session', sessions: [] },
    })
    await page.goto('/account/sessions', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const brief = page.getByTestId('sessions-summary')
    await expectBrief(brief, 4, 'Account session list')
    await expectValue(brief, 'sessions-total', '0')
    await expectValue(brief, 'sessions-other', '0')
    await expect(page.getByTestId('active-sessions-revoke-all-others')).toHaveCount(0)
    await reviewWithKeyboard(page, brief, 'Session overview', 'Account session list')
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`missing TOTP backup count is unknown even when credential protection is active in ${theme}`, async ({ page }) => {
    const { api } = await installSettingsFixtures(page, theme, '/account/2fa', {
      totp: { mode: 'session', activated: true },
    })
    await page.goto('/account/2fa', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const brief = page.getByTestId('totp-summary')
    await expectValue(brief, 'totp-status', 'Active')
    await expectMissing(brief, 'totp-backup')
    await expectValue(brief, 'totp-method', 'TOTP')
    await reviewWithKeyboard(page, brief, 'Two-factor overview', 'Account two-factor status')
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`unknown deployment consent policy does not become optional in ${theme}`, async ({ page }) => {
    const { require_cookie_consent: omitted, ...version } = deploymentVersion
    expect(omitted).toBe(false)
    const { api } = await installSettingsFixtures(page, theme, '/account/privacy', { version })
    await page.goto('/account/privacy', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const brief = page.getByTestId('privacy-summary')
    await expectBrief(brief, 4, 'Browser privacy', 'Deployment policy unavailable')
    await expectMissing(brief, 'privacy-policy')
    await expectValue(brief, 'privacy-scope', 'This browser')
    await expect(page.getByTestId('privacy-consent-section')).toContainText('Deployment consent policy unavailable')
    await expect(page.getByTestId('privacy-consent-accept')).toBeVisible()
    await reviewWithKeyboard(page, brief, 'Browser-local privacy', 'Browser-local privacy and deployment policy')
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`known absent Fleet token and key are not unknown statuses in ${theme}`, async ({ page }) => {
    const { api } = await installSettingsFixtures(page, theme, '/settings/fleet-setup', {
      fleet: true, token: { ...fleetApiInfo, has_valid_token: false },
      publicKey: { ...publicKey, configured: false, fingerprint: '', created_at: null },
    })
    await page.goto('/settings/fleet-setup', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const brief = page.getByTestId('fleet-setup-summary')
    await expectValue(brief, 'fleet-setup-account', 'Connected')
    await expectValue(brief, 'fleet-setup-token', 'Missing')
    await expectValue(brief, 'fleet-setup-domain', 'Not published')
    await expectValue(brief, 'fleet-setup-stream', 'Streaming')
    await expect(metric(brief, 'fleet-setup-token')).toContainText('Connect Tesla to store a refreshable Fleet token.')
    await reviewWithKeyboard(page, brief, 'Fleet setup overview', 'Fleet setup checks')
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`Fleet domain loading never blanks independently resolved account and token sources in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    const { api, releasePublicKey } = await installSettingsFixtures(page, theme, '/settings/fleet-setup', {
      fleet: true, holdPublicKey: true,
    })
    await page.goto('/settings/fleet-setup', { waitUntil: 'domcontentloaded' })
    const brief = page.getByTestId('fleet-setup-summary')
    try {
      await expectValue(brief, 'fleet-setup-account', 'Connected')
      await expectValue(brief, 'fleet-setup-token', 'Auto-refresh on')
      await expectMissing(brief, 'fleet-setup-domain')
      await expect(metric(brief, 'fleet-setup-domain')).toContainText('Loading source')
      await expectValue(brief, 'fleet-setup-stream', 'Streaming')
      await reviewWithKeyboard(page, brief, 'Fleet setup overview', 'Fleet setup checks')
    } finally {
      releasePublicKey()
    }
    await waitForHarnessReady(page, api)
    await expectValue(brief, 'fleet-setup-domain', 'Published')
    await expect(metric(brief, 'fleet-setup-domain')).toContainText(publicKey.fingerprint)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`sessions missing source remains unknown and actual Retry restores counts in ${theme}`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 320, height: 900 })
    const { api, state } = await installSettingsFixtures(page, theme, '/account/sessions', {
      sessionsState: 'unavailable',
    })
    await page.goto('/account/sessions', { waitUntil: 'domcontentloaded' })
    const brief = page.getByTestId('sessions-summary')
    await expect(brief).toContainText('Source unavailable', { timeout: 90_000 })
    await waitForHarnessReady(page, api)
    await expectMissing(brief, 'sessions-total')
    await expectMissing(brief, 'sessions-other')
    await expectMissing(brief, 'sessions-current')
    await expectMissing(brief, 'sessions-last')
    await reviewWithKeyboard(page, brief, 'Session overview', 'Account session list')
    state.sessionsState = 'available'
    await page.getByRole('region', { name: 'Session summary', exact: true })
      .getByRole('button', { name: 'Retry', exact: true }).click()
    await expectValue(brief, 'sessions-total', '2')
    await expectValue(brief, 'sessions-other', '1')
    await expect(brief).toContainText('Source available')
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`open-mode sessions retain the authentication notice rather than fabricate a zero summary in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    const { api } = await installSettingsFixtures(page, theme, '/account/sessions', { sessionsState: 'open' })
    await page.goto('/account/sessions', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await expect(page.getByTestId('active-sessions-open-mode')).toContainText('Session tracking unavailable')
    await expect(page.getByTestId('active-sessions-open-mode')).toContainText('X-Forwarded-User')
    await expect(page.getByTestId('sessions-summary')).toHaveCount(0)
    await expect(page.getByTestId('active-sessions-revoke-all-others')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`Helix initial audit failure is not a zero-cost publication and Retry obtains real totals in ${theme}`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 320, height: 900 })
    const settings = savedSettings(theme, { ai_mode: 'local' })
    const { api, state } = await installSettingsFixtures(page, theme, '/integrations/helix', {
      settings, usageState: 'unavailable',
    })
    await page.goto('/integrations/helix', { waitUntil: 'domcontentloaded' })
    const usage = page.getByTestId('helix-usage-summary')
    await expect(usage).toContainText('Source unavailable', { timeout: 90_000 })
    await waitForHarnessReady(page, api)
    await expectMissing(usage, 'helix-input-tokens')
    await expectMissing(usage, 'helix-output-tokens')
    await expectMissing(usage, 'helix-estimated-cost')
    await expectValue(page.getByTestId('helix-summary'), 'helix-mode', 'Local-only')
    await expectValue(page.getByTestId('helix-summary'), 'helix-features', '0')
    await reviewWithKeyboard(page, usage, 'Audited usage totals', 'Helix daily usage audit')
    const card = page.getByTestId('ai-usage-card')
    await expect(card).toContainText('Usage could not be loaded.')
    state.usageState = 'available'
    await card.getByRole('button', { name: 'Retry', exact: true }).click()
    await expectValue(usage, 'helix-input-tokens', '1,250')
    await expectValue(usage, 'helix-estimated-cost', '$0.001200')
    await expect(usage).toContainText('Source available')
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`Fleet failed domain source is unknown while token and telemetry remain known in ${theme}`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 320, height: 900 })
    const { api, state } = await installSettingsFixtures(page, theme, '/settings/fleet-setup', {
      fleet: true, publicKeyState: 'unavailable',
    })
    await page.goto('/settings/fleet-setup', { waitUntil: 'domcontentloaded' })
    const brief = page.getByTestId('fleet-setup-summary')
    await expect(brief).toContainText('Source unavailable', { timeout: 90_000 })
    await waitForHarnessReady(page, api)
    await expectMissing(brief, 'fleet-setup-domain')
    await expectValue(brief, 'fleet-setup-token', 'Auto-refresh on')
    await expectValue(brief, 'fleet-setup-stream', 'Streaming')
    await reviewWithKeyboard(page, brief, 'Fleet setup overview', 'Fleet setup checks')
    state.publicKeyState = 'available'
    const readiness = page.getByRole('region', { name: 'Streaming and domain readiness', exact: true })
    await readiness.getByRole('button', { name: 'Retry', exact: true }).click()
    await expectValue(brief, 'fleet-setup-domain', 'Published')
    await expect(metric(brief, 'fleet-setup-domain')).toContainText(publicKey.fingerprint)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`safety absent boolean is unknown without suppressing independently known settings in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    const { critical_flash_enabled: omitted, ...settings } = savedSettings(theme)
    expect(omitted).toBe(false)
    const { api } = await installSettingsFixtures(page, theme, '/settings/safety', { settings })
    await page.goto('/settings/safety', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const brief = page.getByTestId('safety-settings-summary')
    await expectMissing(brief, 'safety-safeguards')
    await expectValue(brief, 'safety-quiet-window', 'Off')
    await expectValue(brief, 'safety-api', 'Active')
    await reviewWithKeyboard(page, brief, 'Safety configuration', 'Install settings')
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`safety measured enabled safeguards preserve literal quiet hours and suspended API in ${theme}`, async ({ page }) => {
    const settings = savedSettings(theme, {
      quiet_hours_enabled: true, critical_flash_enabled: true, tab_badge_enabled: true,
      quiet_hours_start: '21:15', quiet_hours_end: '06:45',
      alert_digest_mode: 'daily', api_suspended: true,
    })
    const { api } = await installSettingsFixtures(page, theme, '/settings/safety', { settings })
    await page.goto('/settings/safety', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const brief = page.getByTestId('safety-settings-summary')
    await expectValue(brief, 'safety-safeguards', '3 / 3')
    await expectValue(brief, 'safety-quiet-window', '21:15–06:45')
    await expectValue(brief, 'safety-cadence', 'Daily')
    await expectValue(brief, 'safety-api', 'Suspended')
    await expect(metric(brief, 'safety-quiet-window')).toContainText('Deferring non-critical')
    await reviewWithKeyboard(page, brief, 'Safety configuration', 'Install settings')
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`settings source failure keeps cost and unit choices unknown but local typography published in ${theme}`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 320, height: 900 })
    const { api } = await installSettingsFixtures(page, theme, '/settings', { settingsState: 'unavailable' })
    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    const brief = page.getByTestId('settings-preferences-summary')
    await expect(brief).toContainText('Source unavailable', { timeout: 90_000 })
    await waitForHarnessReady(page, api)
    for (const index of [0, 1, 2, 3, 4, 5]) await expectMissing(brief, `settings-preference-${index}`)
    await expect(metric(brief, 'settings-preference-6')).toHaveAttribute('data-value-state', 'value')
    await expect(metric(brief, 'settings-preference-6')).toContainText('100%')
    await reviewWithKeyboard(page, brief, 'Preferences at a glance', 'Saved settings and browser font preferences')
    await expectNoHorizontalOverflow(page)
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })

  test(`required privacy policy remains a known boolean and not an invented local scope in ${theme}`, async ({ page }) => {
    const { api } = await installSettingsFixtures(page, theme, '/account/privacy', {
      version: { ...deploymentVersion, require_cookie_consent: true },
    })
    await page.goto('/account/privacy', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const brief = page.getByTestId('privacy-summary')
    await expectValue(brief, 'privacy-policy', 'Required')
    await expect(metric(brief, 'privacy-policy')).toContainText('Consent gate enabled')
    await expectValue(brief, 'privacy-scope', 'This browser')
    await reviewWithKeyboard(page, brief, 'Browser-local privacy', 'Browser-local privacy and deployment policy')
    expectSettingsReadOnly(api)
    await assertMockApiComplete(page, api)
  })
}

test('Helix polling failure retains audited operands and Retry recovers through the real usage hook', async ({ page }) => {
  test.setTimeout(90_000)
  const theme: SettingsTheme = 'light'
  const settings = savedSettings(theme, { ai_mode: 'local' })
  const { api, state } = await installSettingsFixtures(page, theme, '/integrations/helix', { settings })
  await page.goto('/integrations/helix', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, api)
  const brief = page.getByTestId('helix-usage-summary')
  await expectValue(brief, 'helix-estimated-cost', '$0.001200')
  state.usageState = 'unavailable'
  await expect(brief).toContainText('Retained source', { timeout: 60_000 })
  await expectValue(brief, 'helix-input-tokens', '1,250')
  await expectValue(brief, 'helix-output-tokens', '420')
  await expectValue(brief, 'helix-estimated-cost', '$0.001200')
  await expect(page.getByTestId('helix-summary')).toContainText('Retained source')
  await reviewWithKeyboard(page, brief, 'Audited usage totals', 'Helix daily usage audit')
  const card = page.getByTestId('ai-usage-card')
  await expect(card).toContainText('Showing the last available totals. Refresh failed.')
  state.usageState = 'available'
  state.usage = { ...usageToday, input_tokens: 2500, output_tokens: 840, cost_micro_cents: 2400 }
  await card.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(brief).toContainText('Source available')
  await expectValue(brief, 'helix-input-tokens', '2,500')
  await expectValue(brief, 'helix-output-tokens', '840')
  await expectValue(brief, 'helix-estimated-cost', '$0.002400')
  await expectNoHorizontalOverflow(page)
  expectSettingsReadOnly(api)
  await assertMockApiComplete(page, api)
})
