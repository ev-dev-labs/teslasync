import { test, expect, type Page } from '@playwright/test';

/**
 * Helper: stub the minimum set of backend endpoints the dashboard
 * fetches on mount so the SPA renders deterministically without a
 * live backend. Each test should call this BEFORE page.goto.
 */
export async function stubBackend(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/v1/vehicles') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            display_name: 'Test Tesla',
            vin: '5YJSA1E26HF000001',
            state: 'asleep',
            in_service: false,
            color: null,
            model: 'modelY',
            trim_badging: null,
          },
        ]),
      });
      return;
    }

    if (path === '/api/v1/system/health') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          checks: { database: 'ok', redis: 'ok', mqtt: 'ok' },
          version: 'e2e-test',
        }),
      });
      return;
    }

    if (path === '/api/v1/system/status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 'e2e-test',
          build_time: new Date().toISOString(),
          uptime_seconds: 60,
          go_version: 'go1.25',
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });

  await page.route('**/auth/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: 'e2e-user' }),
    });
  });
}

test.describe('@smoke SPA boot + navigation', () => {
  test('home route mounts without uncaught errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await stubBackend(page);
    await page.goto('/');

    await expect(page.locator('#root')).toBeVisible();
    await expect(page).toHaveTitle(/TeslaSync|Tesla/i);

    const real = consoleErrors.filter(
      (e) =>
        !/sw\.ts|workbox|chunk|manifest|favicon|prefetch/i.test(e) &&
        !/Failed to load resource/i.test(e),
    );
    expect(real, real.join('\n')).toHaveLength(0);
  });

  test('404 route renders without crash', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/this-route-does-not-exist');
    await expect(page.locator('#root')).toBeVisible();
  });
});
