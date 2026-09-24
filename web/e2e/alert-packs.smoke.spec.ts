import { expect, test } from '@playwright/test'
import { assertMockApiComplete, fulfillApiMock, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'
import type { AlertPack } from '../src/api/hooks/useAlertPacks'
import type { AlertRule } from '../src/api/hooks/useNotifications'

const pack: AlertPack = {
  id: 'all', version: 2, name: 'All alerts', description: 'Complete supported catalog',
  rules: Array.from({ length: 12 }, (_, index) => ({
    id: `browser-rule-${index}`, unit: '%',
    rule: { id: 0, name: `Battery reminder ${index + 1}`, enabled: false, all_vehicles: true, vehicle_ids: [],
      signal_name: 'BatteryLevel', op: '<', value_num: 20, severity: 'warn', cooldown_min: 60,
      trigger_mode: 'once', kind: 'signal', include_title: true, msg_template: '{{VehicleName}}: {{Value}}%',
      created_at: '', updated_at: '' },
  })),
}

for (const width of [390, 1440]) {
for (const theme of ['light', 'dark'] as const) {
test(`rule management is contextual at ${width}px ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  await seedBrowserState(page, theme, '/notifications/rules')
  const api = await installApiMocks(page, 'populated', theme)
  await page.route('**/api/v1/signals/*/available', route => fulfillApiMock(route, api, { json: { vehicle_id: 7, count: 0, signals: [] } }))
  const rules: AlertRule[] = pack.rules.slice(0, 3).map((template, index) => ({
    ...template.rule, id: index + 1, channel_ids: index === 0 ? [2] : index === 1 ? [3] : null,
  }))
  await page.route('**/api/v1/notifications', route => fulfillApiMock(route, api, { json: [
    { id: 2, name: 'Team', kind: 'ntfy', enabled: true, config: {}, created_at: '', updated_at: '' },
    { id: 3, name: 'Phone', kind: 'ntfy', enabled: true, config: {}, created_at: '', updated_at: '' },
  ] }))
  await page.route('**/api/v1/alerts/rules', route => fulfillApiMock(route, api, { json: rules }))
  await page.goto('/notifications/rules', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, api)
  await page.locator('main').screenshot({ path: test.info().outputPath('rules-browse.png') })
  const filter = page.getByLabel('Filter by notification channel')
  await filter.selectOption('2')
  await expect(page.getByRole('link', { name: 'Battery reminder 1' })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search rules...' }).fill('Battery reminder 2')
  await expect(page.getByRole('link', { name: 'Battery reminder 1' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Battery reminder 2' })).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Search rules...' }).clear()
  await page.getByRole('link', { name: 'Battery reminder 1' }).click()
  await expect(page).toHaveURL(/\/notifications\/rules\?rule=1$/)
  await expect(page.getByRole('button', { name: 'Update Rule' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false)
  await page.getByRole('button', { name: 'Back to rules' }).click()
  await filter.selectOption('')
  await expect(page.getByRole('link', { name: 'Battery reminder 2' })).toBeVisible()
  await assertMockApiComplete(page, api)
})
}
}

for (const theme of ['light', 'dark'] as const) {
  test(`empty rule list avoids irrelevant controls in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 })
    await seedBrowserState(page, theme, '/notifications/rules')
    const api = await installApiMocks(page, 'empty', theme)
    await page.goto('/notifications/rules', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await expect(page.getByText('No alert rules yet', { exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Filter by notification channel' })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Select all matching rules' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Bulk actions for selected items' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete all matching rules' })).toHaveCount(0)
    await page.locator('main').screenshot({ path: test.info().outputPath('rules-empty.png') })
    await assertMockApiComplete(page, api)
  })
}

for (const width of [320, 390, 768, 1024, 1280, 1440, 1920, 2560]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`alert pack controls and Helix proposal stay readable at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await seedBrowserState(page, theme, '/notifications/packs')
      const api = await installApiMocks(page, 'populated', theme)
      await page.route('**/api/v1/signals/*/available', route => fulfillApiMock(route, api, { json: { vehicle_id: 7, count: 0, signals: [] } }))
      await page.route('**/api/v1/settings', route => fulfillApiMock(route, api, { json: {
        mode: theme, language: 'en', unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
        ai_mode: 'hybrid', ai_features: { 'alert-pack-builder': true, 'alert-message-template-suggestion': true },
      } }))
      await page.route('**/api/v1/alerts/packs', route => fulfillApiMock(route, api, { json: [pack, { ...pack, id: 'custom', name: 'Custom pack' }] }))
      await page.route('**/api/v1/notifications', route => fulfillApiMock(route, api, { json: [
        { id: 2, name: 'Phone', kind: 'ntfy', enabled: true, config: {}, created_at: '', updated_at: '' },
        { id: 3, name: 'Team', kind: 'ntfy', enabled: true, config: {}, created_at: '', updated_at: '' },
      ] }))
      await page.route('**/api/v1/ai/alerts/packs/draft', route => fulfillApiMock(route, api, {
        contentType: 'text/event-stream',
        body: [
          { type: 'tool_result', id: 'proposal', name: 'propose_alert_pack', ok: true, data: {
            status: 'ok', name: 'Complete ownership watch for every supported event',
            rationale: 'A comprehensive set of supported reminders, including battery and charging events. Review all rules and their individual cooldowns before installation.',
            template_ids: pack.rules.map(rule => rule.id),
          } },
          { type: 'delta', text: 'Review this comprehensive proposal before installation.' },
          { type: 'done', finish_reason: 'stop', usage: { in: 20, out: 50 } },
        ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
      }))
      const installations: unknown[] = []
      const messageRequests: Record<string, unknown>[] = []
      await page.route('**/api/v1/ai/alerts/message-template/draft', async route => {
        messageRequests.push(route.request().postDataJSON())
        await fulfillApiMock(route, api, {
          contentType: 'text/event-stream',
          body: [
            { type: 'tool_result', id: 'message', name: 'validate_alert_message_template', ok: true,
              data: { status: 'ok', template: '{{VehicleName}} is ready for its next charging chapter.', used_placeholders: ['VehicleName'] } },
            { type: 'done', finish_reason: 'stop', usage: { in: 20, out: 20 } },
          ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
        })
      })
      await page.route('**/api/v1/alerts/packs/*/install', async route => {
        installations.push(route.request().postDataJSON())
        await fulfillApiMock(route, api, { json: { id: 1, pack_id: 'all', name: 'All alerts', version: 2, scope_key: 'all', created_at: '', members: [] } })
      })
      await page.goto('/notifications/packs', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)
      const helix = page.getByTestId('ai-feature-alert-pack-builder-root')
      await helix.getByLabel('What would you like to keep an eye on?').fill('A comprehensive pack for every supported event')
      await helix.getByRole('button', { name: /Suggest an alert pack/ }).click()
      const heading = helix.getByRole('heading', { name: 'Complete ownership watch for every supported event' })
      await expect(heading).toBeVisible()
      await expect(helix.getByText('12 proposed rules')).toBeVisible()
      const explanation = helix.getByText(/^A comprehensive set of supported reminders/)
      const review = helix.getByRole('button', { name: 'Review this proposed pack' })
      const titleBox = await heading.boundingBox()
      const explanationBox = await explanation.boundingBox()
      const reviewBox = await review.boundingBox()
      expect(explanationBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height)
      expect(reviewBox!.y).toBeGreaterThan(explanationBox!.y + explanationBox!.height)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false)
      await helix.screenshot({ path: test.info().outputPath('helix-proposal.png') })
      await review.click()
      const dialog = page.getByRole('dialog', { name: /^Preview Complete ownership watch/ })
      await expect(dialog.getByLabel('Notification message', { exact: true })).toHaveCount(10)
      await expect(dialog.getByRole('table', { name: 'Choose rules' })).toHaveCount(width >= 1024 ? 1 : 0)
      const footer = dialog.locator('[data-modal-footer]')
      const footerBox = await footer.boundingBox()
      expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(1001)
      await expect(dialog.getByRole('button', { name: /^Customize / })).toHaveCount(0)
      await dialog.screenshot({ path: test.info().outputPath('pack-overview.png') })
      if (width < 1024) await dialog.getByRole('button', { name: /Pack defaults/ }).click()
      await expect(dialog.getByLabel('Default cooldown (minutes)')).toBeVisible()
      await expect(dialog.getByLabel('Default cooldown (minutes)')).toHaveValue('15')
      const controls = dialog.locator('[data-pack-default-controls]').locator('input, select, button[aria-haspopup="listbox"]')
      await expect(controls).toHaveCount(6)
      const positions = await controls.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().y))
      const columns = width >= 1536 ? 6 : width >= 1024 ? 3 : width >= 640 ? 2 : 1
      for (let start = 0; start < positions.length; start += columns) {
        const row = positions.slice(start, start + columns)
        expect(Math.max(...row) - Math.min(...row), 'Default controls must align within each responsive row').toBeLessThanOrEqual(2)
      }
      await expect(dialog.getByLabel('Default alert behavior').getByRole('option')).toHaveText(['Re-alert until resolved', 'Notify on event'])
      if (width >= 1024) {
        const table = dialog.getByRole('table', { name: 'Choose rules' })
        await expect(table.getByRole('columnheader')).toHaveText([
          'Selected', 'Rule', 'Operator', 'Value', 'Cooldown (minutes)', 'Alert behavior', 'Channels', 'Notification message', 'Include title', 'Defaults',
        ])
        expect(await table.getByRole('columnheader').evaluateAll(headers => headers.every(header => getComputedStyle(header).textAlign === 'left'))).toBe(true)
        const row = table.locator('tbody tr').first()
        expect((await row.boundingBox())!.height, 'Rows must be compact, not stacked mini-forms').toBeLessThanOrEqual(100)
        expect(await row.getByRole('cell').evaluateAll(cells => cells.every(cell => cell.querySelectorAll('input,select,textarea').length <= 1))).toBe(true)
        const rowPositions = await row.locator('input:not([type="checkbox"]), select, textarea').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().y))
        expect(Math.max(...rowPositions) - Math.min(...rowPositions), 'Each cell editor must start at the same vertical position').toBeLessThanOrEqual(2)
      }
      await dialog.getByLabel('Default cooldown (minutes)').fill('15')
      await dialog.getByLabel('Default alert behavior').selectOption('repeat')
      await dialog.getByLabel('Default channels').selectOption('2')
      await expect(dialog.getByLabel('Channels', { exact: true }).first()).toHaveValue('custom')
      await dialog.locator('[data-pack-default-controls]').screenshot({ path: test.info().outputPath('pack-default-channels.png') })
      if (width < 1024) await dialog.getByRole('button', { name: /Pack defaults/ }).click()
      await dialog.getByLabel('Channels', { exact: true }).first().selectOption('all')
      await dialog.getByLabel('Channels', { exact: true }).nth(1).selectOption('none')
      await expect(dialog.getByLabel('Alert behavior', { exact: true }).first()).toHaveValue('repeat')
      await expect(dialog.getByRole('option', { name: /^Master:/ })).toHaveCount(0)
      await dialog.getByLabel('Minimum minutes between notifications', { exact: true }).first().fill('120')
      await dialog.getByLabel('Operator', { exact: true }).first().selectOption('<=')
      await dialog.getByLabel('Threshold (%)', { exact: true }).first().fill('25')
      await dialog.getByLabel('Notification message', { exact: true }).first().fill('{{VehicleName}} manual draft')
      const secondMessage = await dialog.getByLabel('Notification message', { exact: true }).nth(1).inputValue()
      await dialog.getByRole('button', { name: 'Suggest a message for Battery reminder 1', exact: true }).click()
      const messageDialog = page.getByRole('dialog', { name: 'Suggest a message for Battery reminder 1', exact: true })
      await messageDialog.getByTestId('ai-feature-alert-message-template-suggestion-suggest').click()
      await expect(messageDialog.getByText('{{VehicleName}} is ready for its next charging chapter.', { exact: true })).toBeVisible()
      expect(installations).toHaveLength(0)
      expect(await dialog.getByLabel('Notification message', { exact: true }).first().inputValue()).toBe('{{VehicleName}} manual draft')
      await messageDialog.getByTestId('ai-feature-alert-message-template-suggestion-apply').click()
      await expect(messageDialog).toHaveCount(0)
      expect(messageRequests).toHaveLength(1)
      expect(messageRequests[0]).toMatchObject({ name: 'Battery reminder 1', op: '<=', value_num: 25 })
      await expect(dialog.getByLabel('Notification message', { exact: true }).first()).toHaveValue('{{VehicleName}} is ready for its next charging chapter.')
      await expect(dialog.getByLabel('Notification message', { exact: true }).nth(1)).toHaveValue(secondMessage)
      if (width >= 1024) {
        await page.setViewportSize({ width: 390, height: 1000 })
        await expect(dialog.getByRole('table')).toHaveCount(0)
        await expect(dialog.getByLabel('Minimum minutes between notifications').first()).toHaveValue('120')
        await page.setViewportSize({ width, height: 1000 })
        await expect(dialog.getByRole('table')).toBeVisible()
        await expect(dialog.getByLabel('Minimum minutes between notifications').first()).toHaveValue('120')
      }
      await dialog.getByRole('button', { name: 'Next', exact: true }).click()
      await expect(dialog.getByText('Page 2 of 2')).toBeVisible()
      await dialog.getByRole('button', { name: 'Previous', exact: true }).click()
      await expect(dialog.getByLabel('Minimum minutes between notifications', { exact: true }).first()).toHaveValue('120')
      await dialog.screenshot({ path: test.info().outputPath('pack-rule-editor.png') })
      if (width < 1024) await dialog.getByRole('button', { name: /Pack defaults/ }).click()
      await dialog.getByRole('button', { name: 'Apply defaults to all rules' }).click()
      await expect(dialog.getByLabel('Minimum minutes between notifications', { exact: true }).first()).toHaveValue('15')
      await expect(dialog.getByLabel('Channels', { exact: true }).first()).toHaveValue('custom')
      await expect(dialog.getByLabel('Channels', { exact: true }).nth(1)).toHaveValue('custom')
      if (width < 1024) await dialog.getByRole('button', { name: /Pack defaults/ }).click()
      expect(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(false)
      await dialog.screenshot({ path: test.info().outputPath('pack-controls.png') })
      expect(installations).toHaveLength(0)
      await dialog.getByRole('button', { name: 'Install selected rules' }).click()
      await expect(dialog.getByText(/Pack installed/)).toBeVisible()
      expect(installations).toHaveLength(1)
      expect(installations[0]).toMatchObject({ cooldown_s: 900, trigger_mode: 'repeat', enabled: false })
      expect(installations[0]).not.toHaveProperty('channel_ids')
      expect(installations[0]).toMatchObject({ rules: pack.rules.map(() => ({ channel_ids: [2] })) })
      expect((installations[0] as { rules: unknown[] }).rules).toHaveLength(12)
      expect((installations[0] as { rules: unknown[] }).rules[0]).toMatchObject({
        op: '<=', value_num: 25, message: '{{VehicleName}} is ready for its next charging chapter.',
      })
      await assertMockApiComplete(page, api)
    })
  }
}
