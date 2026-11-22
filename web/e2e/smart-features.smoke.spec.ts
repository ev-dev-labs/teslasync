import { expect, test } from '@playwright/test';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

const pagePath = '/settings/smart-features';
const apiPath = `/api/v1${pagePath}`;

for (const { width, theme } of [{ width: 390, theme: 'dark' }, { width: 1440, theme: 'light' }] as const) {
  test(`Smart Features switches persist and remain independent at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    await seedBrowserState(page, theme, pagePath);
    const api = await installApiMocks(page, 'populated', theme);
    if (!api) throw new Error('Smart Features requires the synthetic API');
    let charging = true;
    let saves = 0;
    await page.route(`**${apiPath}`, route => fulfillApiFixture(route, api, {
      json: { data: [{ feature: 'charging_readiness', allowed: charging }, { feature: 'site_rates', allowed: true }] },
    }));
    await page.route(`**${apiPath}/charging_readiness`, route => {
      const request = route.request();
      expect(request.method()).toBe('PUT');
      expect(request.headers()['x-teslasync-expected-principal']).toBe('open');
      charging = request.postDataJSON().allowed;
      saves += 1;
      return fulfillApiFixture(route, api, { json: { data: { feature: 'charging_readiness', allowed: charging } } });
    });
    await page.goto(pagePath);
    await waitForHarnessReady(page, api);
    const main = page.getByRole('main');
    const readiness = main.getByRole('switch', { name: 'Allow Charging readiness' });
    const rates = main.getByRole('switch', { name: 'Allow Charging-hour rate comparison' });
    await expect(readiness).toBeChecked();
    await expect(rates).toBeChecked();
    await readiness.click();
    await expect(readiness).not.toBeChecked();
    await expect(rates).toBeChecked();
    await page.reload();
    await expect(readiness).not.toBeChecked();
    await expect(rates).toBeChecked();
    expect(saves).toBe(1);
    await expectNoHorizontalOverflow(page);
    assertMockApiComplete(api);
  });
}
