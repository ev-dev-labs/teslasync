import { expect, test } from '@playwright/test'
import { seedBrowserState, installApiMocks, waitForHarnessReady } from './mockApi'
import type { RepairCase } from '../src/api/hooks/useDataRepair'

for (const theme of ['light', 'dark'] as const) for (const width of [375, 768, 1280, 1920]) {
  test.describe(`${theme} ${width} batch fixes`, () => {
    test.use({ hasTouch: width < 1280 })
    test('templates, fresh Diagnostics, ghost header and repair resolution', async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await seedBrowserState(page, theme, '/')
      const api = await installApiMocks(page, 'populated', theme)
      const shot = (name: string) => page.screenshot({ path: `../docs/ui-fixes-2/${theme}-${width}-${name}.png`, animations: 'disabled' })
      await page.goto('/')
      await waitForHarnessReady(page, api)
      const customize = page.getByRole('button', { name: 'Customize', exact: true })
      await expect(customize).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await shot('ghost-customize')

      await page.goto('/notifications/studio')
      await waitForHarnessReady(page, api)
      await page.getByRole('button', { name: 'Templates', exact: true }).click()
      const templates = page.getByRole('button', { name: /^Use template / })
      await expect(templates.first()).toBeVisible()
      const geometry = await templates.evaluateAll(buttons => buttons.map(button => {
        const icon = button.querySelector('svg')!.getBoundingClientRect()
        const label = button.querySelector('span')!
        const text = Array.from(label.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())!
        const range = document.createRange(); range.selectNode(text)
        const caption = range.getBoundingClientRect()
        return { gap: caption.x - icon.right, center: Math.abs((icon.y + icon.height / 2) - (caption.y + caption.height / 2)) }
      }))
      for (const row of geometry) { expect(row.gap).toBeGreaterThanOrEqual(7); expect(row.gap).toBeLessThanOrEqual(9); expect(row.center).toBeLessThan(3) }
      await templates.first().scrollIntoViewIfNeeded()
      await shot('template-cards-inline-icons')

      await page.evaluate(() => {
        localStorage.removeItem('teslasync-deck-view')
        localStorage.removeItem('teslasync-sidenav-collapsed-groups-v2')
        localStorage.setItem('teslasync-sidenav-collapsed-groups', JSON.stringify({ 'section:Diagnostics:/system-status': true, 'section:Diagnostics:pinned': true }))
      })
      await page.goto('/system-status')
      await waitForHarnessReady(page, api)
      if (width < 768) {
        await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('button', { name: 'More', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Diagnostics', exact: true }).click()
      } else {
        const panel = page.getByTestId('atlas-panel-secondary')
        if (!await panel.isVisible()) await page.getByTestId('command-deck-rail').getByRole('button', { name: 'Diagnostics', exact: true }).click()
      }
      const panel = page.getByTestId('atlas-panel-secondary')
      const groups = panel.locator('button[aria-controls]')
      expect(await groups.count()).toBeGreaterThan(3)
      for (const group of await groups.all()) await expect(group).toHaveAttribute('aria-expanded', 'true')
      await shot('diagnostics-expanded-fresh')
      await panel.getByRole('button', { name: 'Hide panel', exact: true }).click()

      let current: RepairCase = {
        id: 301, fingerprint: 'drive:101:duration_mismatch', kind: 'drive', session_id: 101, vehicle_id: 7,
        rule: 'duration_mismatch', confidence: 'high', status: 'open', applicable: false,
        blocked_reason: 'structural_anomaly_requires_manual_correction', assigned_to: 'Review operator',
        evidence_started_at: '2026-08-25T08:00:00Z', evidence_stored_ended_at: '2026-08-25T08:32:00Z',
        evidence_contradiction_ts: '2026-08-25T08:32:00Z', evidence_contradiction_src: 'drives',
        evidence_contradiction_field: 'duration_s', evidence_contradiction_value: 'stored duration differs from observed session window',
        evidence_gap_s: 0, first_seen_at: '2026-08-25T09:00:00Z', last_seen_at: '2026-08-25T09:00:00Z',
        created_at: '2026-08-25T09:00:00Z', updated_at: '2026-08-25T09:00:00Z',
      }
      let requests = 0
      await page.route('**/api/v1/data-repair/cases**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname.endsWith('/transition')) {
          requests += 1
          const body = route.request().postDataJSON()
          expect(body.resolution_note).toBe('Manual correction checked against source evidence.')
          expect(body.expected_updated_at).toBe(current.updated_at)
          await new Promise(resolve => setTimeout(resolve, 150))
          if (width === 1280 && requests === 1) {
            await route.fulfill({ status: 409, json: { error: 'Repair case changed; reload and try again.' } }); return
          }
          current = { ...current, status: body.status, resolution_note: body.resolution_note, blocked_reason: null, updated_at: '2026-08-25T10:00:00Z' }
          await route.fulfill({ json: current }); return
        }
        if (url.pathname.endsWith('/301')) {
          await route.fulfill({ json: { case: current, comments: [{ id: 1, case_id: 301, actor: 'Evidence reviewer', body: 'Review both the stored duration and the source observations before correcting the session.', created_at: current.created_at }], quarantine: null } }); return
        }
        if (url.pathname.endsWith('/stats')) { await route.fulfill({ json: { open: current.status === 'open' ? 1 : 0, resolved: current.status === 'resolved' ? 1 : 0, total: 1, in_review: 0, quarantined: 0 } }); return }
        const matches = !url.searchParams.get('status') || url.searchParams.get('status') === current.status
        await route.fulfill({ json: { cases: matches ? [current] : [], has_more: false, next_cursor: null } })
      })
      await page.goto('/data-repair')
      await waitForHarnessReady(page, api)
      await page.getByRole('button', { name: 'Review case 301', exact: true }).click()
      const drawer = page.getByRole('dialog', { name: 'Case #301', exact: true })
      const notice = drawer.getByText('This structural anomaly requires a manual correction', { exact: true })
      await expect(notice).toBeVisible()
      await shot('repair-integrity-notice')
      const input = drawer.getByRole('textbox', { name: 'Assignee', exact: true })
      const save = drawer.getByRole('button', { name: 'Save assignment', exact: true })
      await save.scrollIntoViewIfNeeded()
      const inputBox = (await input.boundingBox())!, saveBox = (await save.boundingBox())!
      if (width >= 768) { expect(Math.abs(inputBox.y + inputBox.height - saveBox.y - saveBox.height)).toBeLessThanOrEqual(1); expect(inputBox.height).toBe(saveBox.height) }
      else { expect(saveBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height); expect(Math.abs(saveBox.width - inputBox.width)).toBeLessThanOrEqual(1) }
      await shot('repair-ownership-aligned')
      await drawer.locator('[data-drawer-body]').evaluate(element => { element.scrollTop = element.scrollHeight })
      const footer = (await drawer.locator('[data-drawer-footer]').boundingBox())!
      for (const name of ['Dismiss finding', 'Move to quarantine']) {
        const action = drawer.getByRole('button', { name, exact: true })
        await expect(action).toBeInViewport()
        const box = (await action.boundingBox())!
        expect(box.y + box.height).toBeLessThanOrEqual(footer.y)
        await action.click({ trial: true })
      }
      await shot('repair-bottom-actions-clear-footer')
      await drawer.getByRole('button', { name: 'Resolve case', exact: true }).click()
      const confirm = page.getByRole('dialog', { name: 'Resolve this case?', exact: true })
      const resolve = confirm.getByRole('button', { name: 'Resolve case', exact: true })
      await expect(resolve).toBeDisabled()
      await confirm.getByRole('textbox', { name: 'Operator note', exact: true }).fill('Manual correction checked against source evidence.')
      await resolve.click()
      if (width === 1280) {
        await expect(confirm.getByRole('alert')).toContainText('Repair case changed; reload and try again.')
        await shot('repair-resolve-error')
        await resolve.click()
      }
      await expect(confirm).toHaveCount(0)
      await expect(drawer.getByText('Resolved', { exact: true })).toBeVisible()
      await drawer.locator('[data-drawer-body]').evaluate(element => { element.scrollTop = 0 })
      await expect(notice).toBeVisible()
      await shot('repair-after-resolution-notice')
      expect(requests).toBe(width === 1280 ? 2 : 1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1)
    })
  })
}
