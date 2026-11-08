import { expect, test } from '@playwright/test';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';

const policy = {
  mode: 'forward_auth', subject_header: 'X-Forwarded-User', subject: 'synthetic-provider-owner',
  authentication_owner: 'external_provider', access_policy: 'all_proxy_users_are_operators',
  capabilities: { step_up_reauth: false, totp_enrollment: false, session_list: false, impersonation: true, rbac: false },
};

test.describe('external browser authentication', () => {
  test.skip(process.env.E2E_MOCKS === '0', 'Synthetic gateway regression cases');

  for (const path of ['/account/2fa', '/account/sessions']) {
    for (const theme of ['dark', 'light'] as const) {
      for (const width of [390, 1440]) {
        test(`provider-owned controls at ${path}, ${theme}, ${width}px`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height: 900 });
          await seedBrowserState(page, theme, path);
          const api = await installApiMocks(page, 'populated', theme);
          if (!api) throw new Error('Missing synthetic API fixtures');
          await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, { json: policy }));
          const errors: string[] = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.goto(path);
          await waitForHarnessReady(page, api);
          await expect(page.getByRole('heading', { name: 'Connection identity', exact: true })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Sign-in, MFA and device sessions', exact: true })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Access policy', exact: true })).toBeVisible();
          await expect(page.getByText('synthetic-provider-owner', { exact: true })).toBeVisible();
          await expect(page.getByTestId('session-expired-modal')).toHaveCount(0);
          expect(api.requests.filter(request => /^\/auth\/(?:session|sessions|totp|reauth)(?:\/|$)/.test(request.path)
            || request.path === '/admin/rbac/matrix')).toEqual([]);
          expect(errors).toEqual([]);
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
          await page.screenshot({ path: testInfo.outputPath('provider-guidance.png'), fullPage: true });
          await page.getByRole('heading', { name: 'Access policy', exact: true }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath('provider-access-policy.png'), fullPage: true });
          await assertMockApiComplete(page, api);
        });
      }
    }
  }

  test('unavailable policy keeps all management guidance visible without inventing open mode', async ({ page }) => {
    await seedBrowserState(page, 'light', '/account/sessions');
    const api = await installApiMocks(page, 'populated', 'light');
    if (!api) throw new Error('Missing synthetic API fixtures');
    await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
      status: 501, json: { error: 'Policy unavailable' },
    }));
    await page.goto('/account/sessions');
    await waitForHarnessReady(page, api);
    for (const name of ['Connection identity', 'Sign-in, MFA and device sessions', 'Access policy']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByText('The server authentication policy is not available yet.', { exact: true })).toBeVisible();
    await expect(page.getByText('No verified user identity was supplied for this request.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check provider sign-in', exact: true })).toHaveCount(0);
    await expect(page.getByText(/Open mode: no browser authentication is configured/)).toHaveCount(0);
    await assertMockApiComplete(page, api);
  });

  test('declining a sensitive settings action sends nothing and asks for no password', async ({ page }) => {
    await seedBrowserState(page, 'dark', '/settings');
    const api = await installApiMocks(page, 'populated', 'dark');
    if (!api) throw new Error('Missing synthetic API fixtures');
    await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, { json: policy }));
    await page.goto('/settings#reset');
    await waitForHarnessReady(page, api);
    await page.locator('[data-testid^="reset-section-button-"]').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reset', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirm sensitive action', exact: true });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
    await expect(confirm.getByRole('textbox')).toHaveCount(1);
    await confirm.getByRole('textbox').fill('CONFIRM');
    await expect(confirm.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect(api.requests.filter(request => request.path === '/settings/reset'
      || request.path === '/auth/reauth' || request.path.startsWith('/auth/totp/'))).toEqual([]);
    await assertMockApiComplete(page, api);
  });

  test('expired gateway session navigates to protected login without local credential requests', async ({ page }) => {
    await seedBrowserState(page, 'dark', '/settings');
    const api = await installApiMocks(page, 'populated', 'dark');
    if (!api) throw new Error('Missing synthetic API fixtures');
    await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
      status: 401, json: { error: 'External provider authentication required' },
    }));
    await page.route('**/api/v1/auth/browser-login?**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>External provider</title></head><body><h1>Provider sign-in</h1></body></html>',
    }));
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/api\/v1\/auth\/browser-login\?rd=/);
    await expect(page.getByRole('heading', { name: 'Provider sign-in' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('rd')).toBe('/settings');
    expect(api.requests.filter(request => request.path === '/auth/reauth'
      || request.path.startsWith('/auth/totp/'))).toEqual([]);
  });
});
