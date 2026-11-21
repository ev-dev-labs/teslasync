import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks, seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import { SOFTWARE_UPDATES } from './operationalbrief-contracts/specialized-diagnostics.supported.fixtures';

test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`case notes are private and export only reviewed fields: ${variant.theme} ${variant.pack}`, async ({ page }) => {
    test.skip(process.env.SMART_SERVICE_CASE_REAL_BACKEND !== '1', 'Requires the mounted handlers and disposable PostgreSQL');
    test.setTimeout(150_000);
    await page.setViewportSize({ width: variant.width, height: variant.height });
    const owner = `synthetic-service-case-${variant.width}`;
    const headers = { 'x-test-subject': owner, 'x-teslasync-expected-principal': `subject:${owner}` };
    const url = '/diagnostics/service-evidence?vehicle_id=7';
    const endpoint = '/api/v1/service-intelligence/service-case';
    const inbox = '/action-center?vehicle_id=7&source_feature=service_case';
    await seedBrowserState(page, variant.theme, url);
    const api = await installApiMocks(page, 'populated', variant.theme);
    if (!api) throw new Error('Missing isolated API fixtures');
    await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
      json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject: owner, capabilities: {} },
    }));
    await page.route(path => path.pathname === '/api/v1/settings/widget-design-pack' && !path.search, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillApiFixture(route, api, {
        json: { scope: createHash('sha256').update(`forward_auth:${owner}`).digest('hex'), pack_id: variant.pack, app_wide: true },
      });
    });
    await page.route(path => path.pathname.startsWith(endpoint) || path.pathname.startsWith('/api/v1/action-center'), route => {
      const request = route.request();
      expect(request.headers()['x-teslasync-expected-principal']).toBe(`subject:${owner}`);
      return forwardLocalApiFixture(route, api, { ...request.headers(), ...headers });
    });
    await page.route(path => path.pathname === '/api/v1/software-updates', route => {
      expect(route.request().method()).toBe('GET');
      expect(new URL(route.request().url()).search).toBe('?vehicle_id=7');
      return fulfillApiFixture(route, api, { json: SOFTWARE_UPDATES });
    });
    const writes: string[] = [];
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && /\/(commands?|smart-delivery|service-intelligence|action-center)(\/|$)/.test(pathname)) {
        writes.push(`${request.method()} ${pathname}`);
      }
    });

    await page.goto(url);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Private service case', exact: true });
    await panel.getByRole('button', { name: 'Review private service case' }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await panel.getByRole('button', { name: 'Open private case' }).press('Enter');
    const title = panel.getByRole('textbox', { name: /^Private case title/ });
    await expect(title).toBeFocused();
    await title.fill('Synthetic private case title');
    await panel.getByRole('button', { name: 'Save private case' }).click();
    await expect(panel.getByRole('button', { name: 'Rename case' })).toBeFocused();
    const when = new Date(Date.now() - 3_600_000).toISOString().slice(0, 16);
    const add = async (kind: string, detail: string) => {
      await panel.getByLabel('Evidence type').selectOption(kind);
      await panel.getByLabel(/Observation time/).fill(when);
      await panel.getByRole('textbox', { name: /^Recorded detail/ }).fill(detail);
      await panel.getByRole('button', { name: 'Save private note' }).click();
      await expect(panel.getByText(detail, { exact: true })).toBeVisible();
    };
    await add('warning', 'Synthetic warning to share');
    await add('recorded_work', 'Synthetic private work detail');
    const foreign = 'synthetic-service-case-foreign';
    const peer = await page.request.get(`${endpoint}?vehicle_id=7`, {
      headers: { 'x-test-subject': foreign, 'x-teslasync-expected-principal': `subject:${foreign}` },
    });
    expect(await peer.json()).toMatchObject({ data: { id: 0, evidence: [] } });

    await page.goto(inbox);
    await waitForHarnessReady(page, api);
    await expect(page.getByText('Review your private service case', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Synthetic private case title', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Review private service case' }).click();
    await expect(page).toHaveURL(/\/diagnostics\/service-evidence\?vehicle_id=7#private-service-case$/);
    const previewButton = panel.getByRole('button', { name: 'Preview selected evidence' });
    await expect(previewButton).toBeDisabled();
    const warning = panel.getByRole('listitem').filter({ hasText: 'Synthetic warning to share' });
    const work = panel.getByRole('listitem').filter({ hasText: 'Synthetic private work detail' });
    await warning.getByRole('checkbox', { name: 'Include detail' }).press('Space');
    await work.getByRole('checkbox', { name: 'Include timestamp' }).press('Space');
    await previewButton.click();
    const preview = panel.getByRole('region', { name: 'Reviewed export contents' });
    await expect(preview).toBeFocused();
    await expect(preview.getByText('Synthetic warning to share', { exact: true })).toBeVisible();
    await expect(preview.getByText('Synthetic private work detail')).toHaveCount(0);
    await work.getByRole('checkbox', { name: 'Include timestamp' }).press('Space');
    await expect(preview).toHaveCount(0);
    await previewButton.click();
    const downloadPending = page.waitForEvent('download');
    await preview.getByRole('button', { name: 'Download reviewed JSON' }).click();
    const download = await downloadPending;
    expect(download.suggestedFilename()).toBe('service-case-evidence.json');
    const file = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of file) chunks.push(Buffer.from(chunk));
    expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual({
      format: 'service_case_evidence_v1', provenance: 'user_recorded',
      evidence: [{ kind: 'warning', detail: 'Synthetic warning to share' }],
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const remove = panel.getByRole('button', { name: 'Delete private case' });
    const dialog = page.getByRole('dialog');
    await remove.press('Enter');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(remove).toBeFocused();
    await remove.press('Enter');
    await dialog.getByRole('button', { name: 'Delete private case' }).click();
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Open private case' })).toBeFocused();
    await page.goto(inbox);
    await waitForHarnessReady(page, api);
    await expect(page.getByText('Review your private service case', { exact: true })).toHaveCount(0);
    expect(writes).toEqual([
      `PUT ${endpoint}`, `POST ${endpoint}/evidence`, `POST ${endpoint}/evidence`,
      `POST ${endpoint}/preview`, `POST ${endpoint}/preview`, `POST ${endpoint}/export`, `DELETE ${endpoint}`,
    ]);
    await assertMockApiComplete(page, api);
  });
}
