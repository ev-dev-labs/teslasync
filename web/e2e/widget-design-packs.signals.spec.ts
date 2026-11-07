import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { installPackReview, selectReviewPack } from './widget-design-packs.mock';
import { installCompleteSignalReview, signalDispositions } from './widget-design-packs.signals';

const verified: Array<{ field: string; disposition: string; children: string[] }> = [];
const selection = [
  ['new-signal-explorer', 'Universal signal explorer'],
  ['new-signal-readiness', 'Signal readiness & provenance'],
] as const;
test.afterAll(async () => {
  await closeMockApiFixtures();
  await writeFile(fileURLToPath(new URL('../test-results/widget-design-packs/signals-250.json', import.meta.url)),
    JSON.stringify({ expected: 250, verified, complete: verified.length === 250 }, null, 2));
});

for (let start = 0; start < signalDispositions.length; start += 40) {
  const group = signalDispositions.slice(start, start + 40);
  test(`approved signal dispositions ${start + 1}-${start + group.length}`, async ({ page }) => {
    const errors: string[] = [];
    const historyRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/\/api\/v1\/signals\/7\/[^/]+\/history\?/.test(request.url())) historyRequests.push(request.url());
    });
    await page.setViewportSize({ width: 1440, height: 1200 });
    const mocks = await installPackReview(page, 'dark', 1440, false, selection, true);
    const now = await page.evaluate(() => new Date(Date.now() - 10_000).toISOString());
    const manifest = await installCompleteSignalReview(page, mocks, now);
    await page.goto('/');
    await waitForHarnessReady(page, mocks);
    await selectReviewPack(page, 'classic');
    const explorer = page.locator('[data-widget-id="pack-review-new-signal-explorer"]');
    const readiness = page.locator('[data-widget-id="pack-review-new-signal-readiness"]');
    await expect(readiness).toContainText('250');
    await expect(readiness.getByRole('region', { name: 'Vehicle configuration evidence' })
      .getByText('Unknown', { exact: true })).toHaveCount(3);
    await expect(readiness).toContainText('Vehicle-supported signals');
    await expect(readiness).toContainText('Unknown');
    for (const disposition of group) {
      await explorer.getByRole('combobox', { name: 'Signal field', exact: true }).selectOption(disposition.field);
      const checked: string[] = [];
      for (const child of disposition.children) {
        const childControl = explorer.getByRole('combobox', { name: 'Compound child', exact: true });
        if (await childControl.count()) await childControl.selectOption(child.field);
        const row = explorer.locator(`[data-signal-field="${child.field}"]`);
        await expect(row).toBeVisible();
        if (child.routing.destination === 'drop') {
          await expect(explorer).toContainText('Dropped; unavailable');
        } else {
          await expect(row).toContainText('Fresh observation');
          const raw = manifest.live.signals?.[child.field];
          const reading = raw != null && typeof raw === 'object' ? raw as Record<string, unknown> : null;
          if (typeof reading?.value === 'boolean') await expect(row).toContainText(reading.value ? 'Yes' : 'No');
          if (reading?.kind === 'ValueKindEnum') await expect(row).toContainText(String(reading.value));
        }
        if (child.historyAvailable) {
          await expect(explorer).toContainText('3 recorded samples returned.');
          const requests = historyRequests.filter(url => new URL(url).pathname === `/api/v1/signals/7/${child.field}/history`);
          expect(requests.length, child.field + ': actual history owner').toBeGreaterThan(0);
          const request = requests.at(-1);
          if (!request) throw new Error('Missing selected history request');
          expect(new URL(request).searchParams.has('from')).toBe(true);
          expect(new URL(request).searchParams.has('to')).toBe(true);
        } else {
          expect(historyRequests.filter(url => new URL(url).pathname === `/api/v1/signals/7/${child.field}/history`),
            child.field + ': unavailable history must not be queried').toHaveLength(0);
          await expect(explorer).toContainText(disposition.disposition === 'unit-context'
            ? 'Unit settings use a separate unit-history source'
            : child.routing.destination === 'drop' ? 'Dropped; unavailable' : 'No signal_log route');
        }
        checked.push(child.field);
      }
      verified.push({ field: disposition.field, disposition: disposition.disposition, children: checked });
    }
    expect(errors).toEqual([]);
    expect(mocks.requests.filter(request => request.path.endsWith('/command'))).toEqual([]);
    await assertMockApiComplete(page, mocks);
  });
}
