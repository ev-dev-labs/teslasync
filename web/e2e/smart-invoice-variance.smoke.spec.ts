import { expect, test } from '@playwright/test';
import { assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, waitForHarnessReady } from './mockApi';
import { installSyntheticMediaShell } from './smart-media-shell.fixtures';

const route = '/ownership/charging-reconciliation?vehicle_id=7';
const endpoint = '/api/v1/charging-reconciliation/invoices';
const now = '2026-11-20T14:00:00Z';

test.use({ timezoneId: 'America/Los_Angeles', ...(process.env.SMART_INVOICE_REAL_BACKEND === '1' ? { headless: false } : {}) });
test.skip(process.env.SMART_INVOICE_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`import a private statement and show only a material unexplained gap: ${variant.name}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-invoice-${variant.name}`;
    const writes: string[] = [];
    const errors: string[] = [];
    const external: string[] = [];
    context.on('request', request => {
      const { origin: destination, pathname } = new URL(request.url());
      if (destination !== origin && destination !== 'null') external.push(destination);
      if (pathname === '/api/v1/web-errors') errors.push(request.postData() ?? pathname);
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) {
        writes.push(`${request.method()} ${pathname}`);
      }
    });
    page.on('pageerror', error => errors.push(error.stack ?? error.message));
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const api = await installSyntheticMediaShell(page, subject, route, now, variant);
    await page.route(url => url.pathname === endpoint || url.pathname.startsWith(`${endpoint}/`), async intercepted => {
      const request = intercepted.request();
      const headers = await request.allHeaders();
      expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
      const url = new URL(request.url());
      if (request.method() === 'GET') expect(url.searchParams.get('vehicle_id')).toBe('7');
      await forwardLocalApiFixture(intercepted, api, headers);
    });
    await page.goto(route);
    await waitForHarnessReady(page, api);
    const material = page.getByRole('heading', { name: 'Check the unexplained difference' });
    const reviewToggle = page.getByRole('switch', { name: 'Enable private statement check for this import' });
    const field = (name: string) => page.getByLabel(new RegExp(
      `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*\\*?\\s*required)?$`,
    ));
    const fill = (name: string, value: string) => field(name).fill(value);
    const enterStatement = async (label: string, total: string) => {
      await page.getByRole('button', { name: 'Import statement' }).press('Enter');
      await expect(reviewToggle).not.toBeChecked();
      await expect(field('Minimum material money difference')).toHaveCount(0);
      await fill('Provider', 'Synthetic billing');
      await fill('Invoice reference', label);
      await fill('ISO currency code', 'USD');
      await fill('Period start', '2026-11-12');
      await fill('Period end (exclusive)', '2026-11-13');
      await fill('Statement total', total);
      await fill('Line reference', label);
      await fill('Occurred at', '2026-11-12T18:00');
      await fill('Location', 'Synthetic site');
      await fill('Billed energy (Wh)', '24000');
      await fill('Billed energy charge', '600');
      await fill('Billed idle or occupancy fee', '100');
      await fill('Billed tax', '80');
      await fill('Line total', '810');
      await reviewToggle.press('Space');
      await fill('Minimum material money difference', '100');
      await page.getByLabel('Billed meter boundary', { exact: true }).selectOption('station');
      await page.getByLabel('Independent meter boundary', { exact: true }).selectOption('battery');
      await fill('Independent meter reading (Wh)', '20000');
    };
    const save = async () => {
      const response = page.waitForResponse(candidate => new URL(candidate.url()).pathname === endpoint
        && candidate.request().method() === 'POST');
      await page.getByRole('button', { name: 'Import and reconcile' }).press('Enter');
      const result = await response;
      expect(result.status(), await result.text()).toBe(201);
      expect(result.request().postDataJSON()).toMatchObject({
        period_start: '2026-11-12T08:00:00.000Z', period_end: '2026-11-13T08:00:00.000Z',
        lines: [{ occurred_at: '2026-11-13T02:00:00.000Z' }],
      });
    };

    await expect(material).toHaveCount(0);
    await enterStatement('Synthetic positive invoice', '910');
    await fill('Line total', '');
    await expect(field('Line total')).toHaveValue('');
    await page.getByRole('button', { name: 'Import and reconcile' }).press('Enter');
    await expect(field('Line total')).toBeFocused();
    expect(writes).toEqual([]);
    await fill('Line total', '810');
    await page.getByRole('switch', { name: 'I entered every line and the statement has no unlisted adjustments or credits' }).press('Space');
    await fill('All other line fees (zero if fully itemized and none)', '30');
    await fill('Documented upper loss bound (Wh)', '2500');
    await page.getByRole('switch', { name: /independently documented flat session rate/ }).press('Space');
    await fill('Documented energy rate amount', '18');
    await save();
    await expect(material).toBeVisible();
    await expect(page.getByText('Matched session #79', { exact: false })).toBeVisible();
    await expect(page.getByText(/Fully entered statement:.*9\.10.*8\.10.*1\.00/)).toBeVisible();
    await expect(page.getByText(/Energy charge:.*6\.00.*4\.32.*1\.68/)).toBeVisible();
    await expect(page.getByText(/Entered components: energy .*6\.00.*1\.00.*0\.80.*0\.30/)).toBeVisible();
    await expect(page.getByText(/Energy outside the comparable range/)).toBeVisible();
    await expect(page.getByText(/not a finding of overbilling/)).toBeVisible();
    await page.getByRole('link', { name: 'Review the statement lines' }).press('Enter');
    await expect(page).toHaveURL(/#invoice-line-audit$/);

    await enterStatement('Synthetic unknown loss invoice', '810');
    await fill('Billed tax', '');
    await fill('All other line fees (zero if fully itemized and none)', '30');
    await fill('Minimum material money difference', '50');
    await save();
    await expect(page.getByText(/No comparison is supported by the evidence entered/)).toBeVisible();
    await expect(material).toHaveCount(0);
    const restoredRegister = page.waitForResponse(response =>
      new URL(response.url()).pathname === endpoint && response.request().method() === 'GET',
      { timeout: 20_000 });
    await page.reload();
    const register = await restoredRegister;
    expect(register.ok(), await register.text()).toBe(true);
    expect(await register.json()).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ invoice_ref: 'Synthetic positive invoice' })]),
    });
    if (variant.name === 'mobile') {
      await page.getByRole('button', { name: 'Synthetic positive invoice · Synthetic billing', exact: true }).press('Enter');
      const details = page.getByRole('dialog', { name: 'Synthetic positive invoice' });
      await details.getByRole('button', { name: 'Audit', exact: true }).press('Enter');
      await details.getByRole('button', { name: 'Close', exact: true }).last().press('Enter');
    } else {
      await page.getByRole('row').filter({
        has: page.getByText('Synthetic positive invoice', { exact: true }),
      }).getByRole('button', { name: 'Audit', exact: true }).press('Enter');
    }
    await expect(material).toBeVisible();
    const check = page.getByRole('heading', { name: 'Private statement check', exact: true });
    await expect(check).toBeVisible();
    const reviewWrite = (method: string) => page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith('/review') && response.request().method() === method);
    await page.getByRole('button', { name: 'Edit statement check', exact: true }).press('Enter');
    const lossField = field('Documented upper loss bound (Wh)');
    await expect(lossField).toHaveValue('2500');
    await expect(lossField.locator('xpath=ancestor::form')).toBeFocused();
    await expect(field('Billed energy charge')).toHaveCount(0);
    await lossField.fill('5000');
    const saveCheck = page.getByRole('button', { name: 'Save statement check', exact: true });
    await expect(saveCheck).toBeDisabled();
    await page.getByRole('switch', { name: 'Use this evidence only for my private statement check' }).press('Space');
    const editedPending = reviewWrite('PUT');
    await saveCheck.press('Enter');
    const edited = await editedPending;
    expect(edited.status()).toBe(204);
    expect(edited.request().postDataJSON()).toMatchObject({
      confirmed: true, vehicle_id: 7, lines: [{ evidence: { meter: { max_loss_wh: 5000 } } }],
    });
    await expect(page.getByText(/Energy outside the comparable range/)).toHaveCount(0);
    await expect(page.getByText(/Energy charge:.*6\.00.*4\.32.*1\.68/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit statement check', exact: true })).toBeFocused();

    await page.getByRole('button', { name: 'Open dispute', exact: true }).press('Enter');
    await fill('Amount claimed', '100');
    await page.getByLabel('Note for this local dispute', { exact: true }).fill('Synthetic local claim');
    const disputePending = page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith('/disputes') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Record dispute', exact: true }).press('Enter');
    const dispute = await disputePending;
    expect(dispute.status(), await dispute.text()).toBe(201);
    expect(dispute.request().postDataJSON()).toMatchObject({
      claimed_minor: 100, vehicle_id: 7, expected_version: 2, expected_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(page.getByText(/This statement is already handled/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record dispute', exact: true })).toHaveCount(0);
    const clearLabel = 'Turn off and clear statement check';
    const clear = page.getByRole('button', { name: clearLabel, exact: true });
    await clear.press('Enter');
    const dialog = page.getByRole('dialog', { name: clearLabel, exact: true });
    await expect(dialog).toContainText('Imported statements, charging sessions, and local dispute history will be kept.');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
    await expect(clear).toBeFocused();
    await clear.press('Enter');
    const clearedPending = reviewWrite('DELETE');
    await dialog.getByRole('button', { name: clearLabel, exact: true }).press('Enter');
    const cleared = await clearedPending;
    expect(cleared.status()).toBe(204);
    await expect(page.getByText('Off. No sessions are compared for this statement.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable statement check again', exact: true })).toBeFocused();
    await expect(page.locator('[data-app-record-kind="charging-dispute"]').getByText(/Synthetic local claim$/)).toBeVisible();
    expect(new URL(cleared.url()).searchParams.get('expected_version')).toBe('2');
    const reviewPath = new URL(edited.url()).pathname;
    const disputePath = new URL(dispute.url()).pathname;
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(writes).toEqual([`POST ${endpoint}`, `POST ${endpoint}`, `PUT ${reviewPath}`, `POST ${disputePath}`, `DELETE ${reviewPath}`]);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
}
