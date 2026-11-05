import { expect, test } from '@playwright/test'
import type { RepairCase, RepairCaseCorrectionPreview } from '../src/api/hooks/useDataRepair'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1280]) {
    test(`reviewed corrections remain explicit at ${width}px in ${theme} mode`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await seedBrowserState(page, theme, '/data-repair')
      const api = await installApiMocks(page, 'populated', theme)
      const duration: RepairCase = {
        id: 301, fingerprint: 'drive:101:duration', kind: 'drive', session_id: 101, vehicle_id: 7,
        rule: 'duration_mismatch', confidence: 'high', status: 'open', applicable: false,
        blocked_reason: 'structural_anomaly_requires_manual_correction',
        evidence_started_at: '2026-08-25T08:00:00Z', evidence_stored_ended_at: '2026-08-25T08:32:00Z',
        evidence_contradiction_ts: '2026-08-25T08:32:00Z', evidence_contradiction_src: 'drives',
        evidence_contradiction_field: 'duration_s', evidence_contradiction_value: 'stored=900 computed=1920 tolerance_s=90',
        evidence_gap_s: 0, first_seen_at: '2026-08-25T09:00:00Z', last_seen_at: '2026-08-25T09:00:00Z',
        created_at: '2026-08-25T09:00:00Z', updated_at: '2026-08-25T09:00:00Z',
      }
      const energy: RepairCase = {
        ...duration, id: 302, fingerprint: 'charging:201:energy', kind: 'charging', session_id: 201,
        rule: 'negative_aggregate_total_energy_added_wh', status: 'in_review',
        evidence_contradiction_src: 'charging_sessions', evidence_contradiction_field: 'total_energy_added_wh',
        evidence_contradiction_value: '-100',
      }
      const boundary: RepairCase = {
        ...duration, id: 303, fingerprint: 'drive:103:boundary', session_id: 103,
        rule: 'ended_before_started', evidence_started_at: '2026-08-25T09:00:00Z',
        evidence_stored_ended_at: '2026-08-25T08:32:00Z',
      }
      const cases = new Map<number, RepairCase>([[301, duration], [302, energy], [303, boundary]])
      const writes: unknown[] = []
      const previews: unknown[] = []
      const hash = 'a'.repeat(64)
      await page.route('**/api/v1/data-repair/cases**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        const id = Number(url.pathname.match(/\/cases\/(\d+)/)?.[1])
        const current = cases.get(id)
        if (url.pathname.endsWith('/stats')) {
          const all = [...cases.values()]
          await route.fulfill({ json: {
            open: all.filter(item => item.status === 'open').length,
            in_review: all.filter(item => item.status === 'in_review').length,
            applied: all.filter(item => item.status === 'applied').length,
            quarantined: 0, resolved: 0, total: all.length,
          } })
          return
        }
        if (current && url.pathname.endsWith('/transition')) {
          const body = request.postDataJSON()
          expect(body).toMatchObject({ status: 'in_review', expected_updated_at: current.updated_at })
          const next = { ...current, status: 'in_review' as const, updated_at: '2026-08-25T10:00:00Z' }
          cases.set(id, next)
          await route.fulfill({ json: next })
          return
        }
        if (current && (url.pathname.endsWith('/correction-preview') || url.pathname.endsWith('/correction'))) {
          const body = request.postDataJSON()
          const isPreview = url.pathname.endsWith('/correction-preview')
          expect(body.expected_updated_at).toBe(current.updated_at)
          if (id === 301) expect(body).toMatchObject({ field: 'duration_s', mode: 'derive', value: null })
          else if (id === 302) {
            expect(body).toMatchObject({ field: 'total_energy_added_wh', mode: 'replace' })
            expect(body.value).toBeCloseTo(1200)
          } else {
            expect(body).toMatchObject({
              field: 'ended_at', mode: 'boundary', target: 'primary',
              ended_at: '2026-08-25T09:30:45.000Z',
            })
          }
          const result: RepairCaseCorrectionPreview = {
            case_id: current.id, case_updated_at: current.updated_at, kind: current.kind,
            session_id: current.session_id, started_at: current.evidence_started_at,
            ended_at: current.evidence_stored_ended_at ?? null, source_hash: hash,
            changes: id === 301
              ? [{ field: 'duration_s', before: 900, after: 1920 }]
              : id === 302 ? [
                  { field: 'total_energy_added_wh', before: -100, after: 1200 },
                  { field: 'cost_decimal', before: null, after: null, before_text: '4.1250', unit: 'USD' },
                  { field: 'cost_source', before: null, after: null, before_text: 'default_estimate', after_text: 'unknown' },
                ] : [
                  { field: 'ended_at', before: null, after: null, before_text: '2026-08-25T08:32:00Z', after_text: '2026-08-25T09:30:45Z' },
                  { field: 'duration_s', before: null, after: 1845 },
                ],
          }
          if (isPreview) {
            previews.push(body)
          } else {
            expect(body.expected_source_hash).toBe(hash)
            writes.push(body)
            cases.set(id, { ...current, status: 'applied', updated_at: '2026-08-25T11:00:00Z' })
          }
          await route.fulfill({ json: result })
          return
        }
        if (current && url.pathname.endsWith(`/${id}`)) {
          await route.fulfill({ json: { case: current, comments: [], quarantine: null } })
          return
        }
        const status = url.searchParams.get('status')
        const matching = [...cases.values()].filter(item => !status || status === item.status
          || (status === 'active' && (item.status === 'open' || item.status === 'in_review')))
        await route.fulfill({ json: { cases: matching, has_more: false, next_cursor: null } })
      })

      await page.goto('/data-repair')
      await waitForHarnessReady(page, api)
      await expect(page.getByRole('combobox', { name: 'Filter by status' })).toHaveValue('active')
      await expect(page.getByRole('button', { name: 'Review case 302' })).toBeVisible()
      await page.getByRole('button', { name: 'Review case 301' }).click()
      let drawer = page.getByRole('dialog', { name: 'Case #301' })
      await expect(drawer.getByText('Stored duration', { exact: true })).toBeVisible()
      await expect(drawer.getByText('Duration from start and end')).toBeVisible()
      await expect(drawer.getByRole('button', { name: 'Resolve case' }))
        .toHaveAttribute('title', 'Record a manual resolution; this does not change session data.')
      await drawer.getByRole('button', { name: 'Begin review' }).click()
      await expect(drawer.getByText('In review', { exact: true })).toBeVisible()
      await drawer.getByRole('button', { name: 'Review correction' }).click()
      let confirm = page.getByRole('dialog', { name: 'Apply this correction?' })
      await expect(confirm.getByText(/900 s.*1920 s/)).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('duration-preview.png'), animations: 'disabled' })
      await confirm.getByRole('button', { name: 'Cancel' }).click()
      expect(writes).toHaveLength(0)
      await drawer.getByRole('button', { name: 'Review correction' }).click()
      confirm = page.getByRole('dialog', { name: 'Apply this correction?' })
      await confirm.getByRole('button', { name: 'Apply correction' }).click()
      await expect(drawer.getByText('A reviewed correction was applied to this finding.')).toBeVisible()
      await drawer.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Review case 301' })).toHaveCount(0)

      await page.getByRole('button', { name: 'Review case 302' }).click()
      drawer = page.getByRole('dialog', { name: 'Case #302' })
      await drawer.getByRole('spinbutton', { name: /Corrected Energy added/ }).fill('1.2')
      await drawer.getByRole('button', { name: 'Review correction' }).click()
      confirm = page.getByRole('dialog', { name: 'Apply this correction?' })
      await expect(confirm.getByText(/4\.1250 USD.*Unknown/)).toBeVisible()
      await expect(confirm.getByText(/previous estimate depended on the incorrect energy value/)).toBeVisible()
      await expect(page.getByText('Correction applied', { exact: true })).toBeVisible()
      await confirm.getByRole('button', { name: 'Cancel' }).click({ trial: true, timeout: 1500 })
      await page.screenshot({ path: testInfo.outputPath('energy-preview.png'), animations: 'disabled' })
      await confirm.getByRole('button', { name: 'Apply correction' }).click()
      await expect(drawer.getByText('A reviewed correction was applied to this finding.')).toBeVisible()
      await drawer.getByRole('button', { name: 'Close', exact: true }).click()

      await page.getByRole('button', { name: 'Review case 303' }).click()
      drawer = page.getByRole('dialog', { name: 'Case #303' })
      await drawer.getByLabel('Correct end time (UTC)').fill('2026-08-25T09:30:45')
      await drawer.getByRole('button', { name: 'Review correction' }).click()
      confirm = page.getByRole('dialog', { name: 'Apply this correction?' })
      await expect(confirm.getByText(/2026-08-25T08:32:00Z.*2026-08-25T09:30:45Z/)).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('boundary-preview.png'), animations: 'disabled' })
      await confirm.getByRole('button', { name: 'Apply correction' }).click()
      await expect(drawer.getByText('A reviewed correction was applied to this finding.')).toBeVisible()
      expect(previews).toHaveLength(4)
      expect(writes).toHaveLength(3)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1)
    })
  }
}
