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
  await seedBrowserState(page, theme, '/notifications/studio')
  const api = await installApiMocks(page, 'populated', theme)
  await page.route('**/api/v1/signals/*/available', route => fulfillApiMock(route, api, { json: { vehicle_id: 7, count: 0, signals: [] } }))
  let rules: AlertRule[] = pack.rules.slice(0, 3).map((template, index) => ({
    ...template.rule, id: index + 1, channel_ids: index === 0 ? [2] : index === 1 ? [3] : null,
  }))
  const updates: unknown[] = []
  const deletions: number[][] = []
  await page.route('**/api/v1/notifications', route => fulfillApiMock(route, api, { json: [
    { id: 2, name: 'Team', kind: 'ntfy', enabled: true, config: {}, created_at: '', updated_at: '' },
    { id: 3, name: 'Phone', kind: 'ntfy', enabled: true, config: {}, created_at: '', updated_at: '' },
  ] }))
  await page.route('**/api/v1/alerts/rules', route => fulfillApiMock(route, api, { json: rules }))
  await page.route('**/api/v1/alerts/rules/1', async route => {
    const update: { channel_ids: number[] | null } = route.request().postDataJSON()
    updates.push(update)
    rules = rules.map(rule => rule.id === 1 ? { ...rule, ...update } : rule)
    await fulfillApiMock(route, api, { json: rules[0] })
  })
  await page.route('**/api/v1/alerts/rules/bulk/delete', async route => {
    const { ids }: { ids: number[] } = route.request().postDataJSON()
    deletions.push(ids)
    rules = rules.filter(rule => !ids.includes(rule.id))
    await fulfillApiMock(route, api, { json: { deleted_ids: ids } })
  })
  await page.goto('/notifications/studio', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, api)
  const toolbar = page.getByRole('region', { name: 'Bulk actions for selected items' })
  await expect(toolbar).toHaveCount(0)
  await page.getByRole('region', { name: 'Rules', exact: true }).screenshot({ path: test.info().outputPath('rules-browse.png') })
  const filter = page.getByLabel('Filter by notification channel')
  await filter.selectOption('2')
  await expect(page.getByText('Battery reminder 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Battery reminder 2', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Battery reminder 3', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Channels for Battery reminder 1' }).click()
  const channelDialog = page.getByRole('dialog', { name: 'Channels for Battery reminder 1' })
  await channelDialog.getByText('Team (ntfy)', { exact: true }).click()
  await channelDialog.getByText('Phone (ntfy)', { exact: true }).click()
  await expect(channelDialog.getByRole('checkbox', { name: 'Team (ntfy)' })).not.toBeChecked()
  await expect(channelDialog.getByRole('checkbox', { name: 'Phone (ntfy)' })).toBeChecked()
  await channelDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(channelDialog).toHaveCount(0)
  expect(updates).toEqual([{ channel_ids: [3] }])
  await expect(page.getByText('Battery reminder 1', { exact: true })).toHaveCount(0)
  await page.getByText('Select all', { exact: true }).click()
  await expect(toolbar).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false)
  await toolbar.screenshot({ path: test.info().outputPath('rule-selection.png') })
  await page.getByRole('region', { name: 'Rules', exact: true }).screenshot({ path: test.info().outputPath('rules-selected.png') })
  await toolbar.getByRole('button', { name: 'Delete', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Delete 1 rule?' })
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(deletions).toHaveLength(0)
  await toolbar.getByRole('button', { name: 'Delete', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('No rules match the current search and channel filter.')).toBeVisible()
  expect(deletions).toEqual([[3]])
  expect(rules.map(rule => rule.id)).toEqual([1, 2])
  await filter.selectOption('')
  await expect(page.getByText('Battery reminder 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Battery reminder 2', { exact: true })).toBeVisible()
  await assertMockApiComplete(page, api)
})
}
}

for (const theme of ['light', 'dark'] as const) {
  test(`empty rule list avoids irrelevant controls in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 })
    await seedBrowserState(page, theme, '/notifications/studio')
    const api = await installApiMocks(page, 'empty', theme)
    await page.goto('/notifications/studio', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await expect(page.getByText('No alert rules yet', { exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Filter by notification channel' })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Select all matching rules' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Bulk actions for selected items' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete all matching rules' })).toHaveCount(0)
    await page.getByRole('region', { name: 'Rules', exact: true }).screenshot({ path: test.info().outputPath('rules-empty.png') })
    await assertMockApiComplete(page, api)
  })
}

for (const width of [320, 390, 768, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`alert pack controls and Helix proposal stay readable at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await seedBrowserState(page, theme, '/notifications/studio')
      const api = await installApiMocks(page, 'populated', theme)
      await page.route('**/api/v1/signals/*/available', route => fulfillApiMock(route, api, { json: { vehicle_id: 7, count: 0, signals: [] } }))
      await page.route('**/api/v1/settings', route => fulfillApiMock(route, api, { json: {
        mode: theme, language: 'en', unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
        ai_mode: 'hybrid', ai_features: { 'alert-pack-builder': true },
      } }))
      await page.route('**/api/v1/alerts/packs', route => fulfillApiMock(route, api, { json: [pack, { ...pack, id: 'custom', name: 'Custom pack' }] }))
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
      await page.route('**/api/v1/alerts/packs/*/install', async route => {
        installations.push(route.request().postDataJSON())
        await fulfillApiMock(route, api, { json: { id: 1, pack_id: 'all', name: 'All alerts', version: 2, scope_key: 'all', created_at: '', members: [] } })
      })
      await page.goto('/notifications/studio', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)
      await page.getByRole('button', { name: 'Alert Packs', exact: true }).click()
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
      await expect(dialog.getByLabel('Notification message')).toHaveCount(0)
      await expect(dialog.getByRole('table', { name: 'Choose rules' })).toHaveCount(width >= 1024 ? 1 : 0)
      const footer = dialog.locator('[data-modal-footer]')
      const footerBox = await footer.boundingBox()
      expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(1001)
      const thirdRuleBox = await dialog.getByRole('button', { name: 'Customize Battery reminder 3', exact: true }).boundingBox()
      expect(thirdRuleBox!.y + thirdRuleBox!.height).toBeLessThanOrEqual(footerBox!.y)
      await dialog.screenshot({ path: test.info().outputPath('pack-overview.png') })
      if (width < 1024) await dialog.getByRole('button', { name: /Master settings/ }).click()
      await expect(dialog.getByLabel('Master cooldown (minutes)')).toBeVisible()
      await dialog.getByLabel('Master cooldown (minutes)').fill('15')
      await dialog.getByLabel('Master alert behavior').selectOption('repeat')
      if (width < 1024) await dialog.getByRole('button', { name: /Master settings/ }).click()
      await dialog.getByRole('button', { name: 'Customize Battery reminder 1', exact: true }).click()
      await dialog.getByRole('switch', { name: 'Use individual delivery settings', exact: true }).first().click()
      await dialog.getByLabel('Minimum minutes between notifications', { exact: true }).first().fill('120')
      if (width >= 1024) {
        await page.setViewportSize({ width: 390, height: 1000 })
        await expect(dialog.getByRole('table')).toHaveCount(0)
        await expect(dialog.getByLabel('Minimum minutes between notifications')).toHaveValue('120')
        await page.setViewportSize({ width, height: 1000 })
        await expect(dialog.getByRole('table')).toBeVisible()
        await expect(dialog.getByLabel('Minimum minutes between notifications')).toHaveValue('120')
      }
      await dialog.getByRole('button', { name: 'Next', exact: true }).click()
      await expect(dialog.getByText('Page 2 of 2')).toBeVisible()
      await dialog.getByRole('button', { name: 'Previous', exact: true }).click()
      await expect(dialog.getByLabel('Minimum minutes between notifications', { exact: true }).first()).toHaveValue('120')
      await dialog.screenshot({ path: test.info().outputPath('pack-rule-editor.png') })
      if (width < 1024) await dialog.getByRole('button', { name: /Master settings/ }).click()
      await dialog.getByRole('button', { name: 'Apply master settings to all rules' }).click()
      await expect(dialog.getByLabel('Minimum minutes between notifications', { exact: true })).toHaveCount(0)
      await expect(dialog.getByText(/15 min cooldown/)).toBeVisible()
      if (width < 1024) await dialog.getByRole('button', { name: /Master settings/ }).click()
      expect(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(false)
      await dialog.screenshot({ path: test.info().outputPath('pack-controls.png') })
      expect(installations).toHaveLength(0)
      await dialog.getByRole('button', { name: 'Install selected rules' }).click()
      await expect(dialog.getByText(/Pack installed/)).toBeVisible()
      expect(installations).toHaveLength(1)
      expect(installations[0]).toMatchObject({ cooldown_s: 900, trigger_mode: 'repeat', enabled: false })
      expect((installations[0] as { rules: unknown[] }).rules).toHaveLength(12)
      await assertMockApiComplete(page, api)
    })
  }
}
