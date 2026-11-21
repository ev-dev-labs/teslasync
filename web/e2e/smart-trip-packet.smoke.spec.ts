import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import { installSyntheticMediaShell } from './smart-media-shell.fixtures';

const route = '/logbook?vehicle_id=7&from=2026-03-01&to=2026-03-31#private-trip-packet';
const endpoint = '/api/v1/ownership/trip-packet';
const early = '2026-04-02T12:59:00Z';
const due = '2026-04-02T13:00:00Z';
const drive = (id: number, startTs: string, endTs: string, distanceM: number) => ({
  id, vehicleId: 7, startTs, endTs, distanceM, startAddress: null, endAddress: null,
});

test.use({ timezoneId: 'UTC', ...(process.env.SMART_TRIP_PACKET_REAL_BACKEND === '1' ? { headless: false } : {}) });
test.skip(process.env.SMART_TRIP_PACKET_REAL_BACKEND !== '1', 'Requires mounted handlers, worker and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`review the explicit business packet before a private download: ${variant.name}`, async ({ context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-packet-${variant.name}`;
    const writes: string[] = [];
    const errors: string[] = [];
    const externalOrigins: string[] = [];
    await context.route(url => /^https?:$/.test(url.protocol) && url.origin !== origin, intercepted => intercepted.abort());
    context.on('request', request => {
      const { protocol, origin: target, pathname } = new URL(request.url());
      if (pathname === '/api/v1/web-errors') errors.push(request.postData() ?? pathname);
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${pathname}`);
      if (/^https?:$/.test(protocol) && target !== origin) externalOrigins.push(target);
    });
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const tick = async (phase: 'early' | 'due' | 'recheck') => {
      const response = await context.request.post(`${origin}/__fixture/trip-packet?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const open = async (now: string) => {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.stack ?? error.message));
      const api = await installSyntheticMediaShell(page, subject, route, now, variant);
      await page.route(url => url.pathname === '/api/v1/drives', intercepted => fulfillApiFixture(intercepted, api, {
        json: [
          drive(801, '2026-03-10T02:25:00Z', '2026-03-10T03:45:00Z', 11250),
          drive(802, '2026-03-12T10:00:00Z', '2026-03-12T10:20:00Z', 5000),
        ],
      }));
      await page.route(url => url.pathname === endpoint, async intercepted => {
        const headers = await intercepted.request().allHeaders();
        const url = new URL(intercepted.request().url());
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
        expect(url.searchParams.get('vehicle_id')).toBe('7');
        await forwardLocalApiFixture(intercepted, api, headers);
      });
      await page.goto(route);
      await waitForHarnessReady(page, api);
      const waitForWrite = (method: string) => page.waitForResponse(response =>
        response.request().method() === method && new URL(response.url()).pathname === endpoint);
      return { page, api, waitForWrite, panel: page.getByRole('region', { name: 'Private monthly trip packet' }) };
    };

    await tick('early');
    const enrollment = await open(early);
    const form = enrollment.panel;
    await expect(form.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await form.getByRole('button', { name: 'Set up monthly trip packets' }).press('Enter');
    const zone = form.getByLabel('Packet time zone');
    await expect(zone).toBeFocused();
    await zone.fill('America/New_York');
    const confirm = form.getByRole('button', { name: 'Confirm private packet setup' });
    await expect(confirm).toBeDisabled();
    await form.getByRole('switch', { name: /^Use this vehicle’s completed drives/ }).press('Space');
    const enroll = enrollment.waitForWrite('PUT');
    await confirm.press('Enter');
    expect((await enroll).status()).toBe(204);
    await expect(form.getByRole('button', { name: 'Edit packet settings' })).toBeFocused();
    await form.getByLabel('Select a drive to confirm its purpose').selectOption('801');
    const purpose = form.getByLabel('Confirmed purpose for this drive');
    await expect(purpose).toHaveValue('');
    await purpose.selectOption('business');
    await form.getByRole('button', { name: 'Add a receipt reference' }).press('Enter');
    await form.getByLabel('Receipt 1 date').fill('2026-03-09');
    await form.getByLabel('Receipt 1 reference').fill('Synthetic receipt');
    await form.getByLabel('Receipt 1 currency code').fill('USD');
    await form.getByLabel('Receipt 1 amount').fill('4.25');
    const save = form.getByRole('button', { name: 'Confirm purpose and receipt references' });
    const recorded = enrollment.waitForWrite('PATCH');
    await save.press('Enter');
    expect((await recorded).status()).toBe(204);
    await expect(form.getByRole('heading', { name: 'Business trip packet ready to review' })).toHaveCount(0);
    await tick('early');
    await assertMockApiComplete(enrollment.page, enrollment.api);
    await enrollment.page.close();

    await tick('due');
    const { page, api, waitForWrite, panel } = await open(due);
    const finding = panel.getByRole('heading', { name: 'Business trip packet ready to review' });
    await expect(finding).toBeVisible();
    await expect(panel.getByText('Synthetic receipt', { exact: true })).toBeVisible();
    await expect(panel.getByText(/No tax or reimbursement eligibility is inferred/)).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Drive 801' }).first()).toHaveAttribute('href', '/drives/801?vehicle_id=7');
    await expect(panel.getByLabel('Select a drive to confirm its purpose').locator('option[value="802"]')).toHaveText('Unclassified drive 802');
    const label = 'Download reviewed trip packet';
    const exportButton = panel.getByRole('button', { name: label });
    const dialog = page.getByRole('dialog', { name: label });
    await exportButton.press('Enter');
    await dialog.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(exportButton).toBeFocused();
    expect(writes).toEqual([`PUT ${endpoint}`, `PATCH ${endpoint}`]);
    await exportButton.press('Enter');
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: label }).press('Enter');
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/^private-trip-packet.*\.json$/);
    const path = await file.path();
    if (!path) throw new Error('The review did not produce a local file');
    const json = JSON.parse(await readFile(path, 'utf8'));
    expect(json).toMatchObject({
      business_drives: [{ drive_id: 801, distance_m: 11250 }],
      matched_receipts: [{ drive_id: 801, receipt_day: '2026-03-09', reference: 'Synthetic receipt', currency: 'USD', amount_minor: 425 }],
      unclassified_drive_count: 1,
    });
    expect(json).not.toHaveProperty('unclassified_drive_ids');

    await panel.getByLabel('Select a drive to confirm its purpose').selectOption('801');
    await panel.getByLabel('Receipt 1 reference').fill('Corrected synthetic receipt');
    const corrected = waitForWrite('PATCH');
    await panel.getByRole('button', { name: 'Confirm purpose and receipt references' }).press('Enter');
    expect((await corrected).status()).toBe(204);
    await expect(panel.getByText('Corrected synthetic receipt', { exact: true })).toBeVisible();
    await tick('recheck');
    const dismiss = panel.getByRole('button', { name: /^Dismiss this month/ });
    await dismiss.press('Enter');
    await expect(finding).toHaveCount(0);
    await panel.getByRole('button', { name: 'Pause private packets' }).press('Enter');
    await expect(panel.getByText(/^Paused\./)).toBeVisible();
    const clearLabel = 'Turn off and clear private packet';
    await panel.getByRole('button', { name: clearLabel }).press('Enter');
    await page.getByRole('dialog', { name: clearLabel }).getByRole('button', { name: clearLabel }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(writes).toEqual([`PUT ${endpoint}`, `PATCH ${endpoint}`, `POST ${endpoint}`, `PATCH ${endpoint}`, `PATCH ${endpoint}`, `PUT ${endpoint}`, `DELETE ${endpoint}`]);
    expect(errors).toEqual([]);
    expect(externalOrigins).toEqual([]);
  });
}
