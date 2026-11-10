import { expect, test, type Page } from '@playwright/test';
import { assertMockApiComplete, closeMockApiFixtures, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import { installPackReview, reviewWidgets } from './widget-design-packs.mock';

const endpoint = process.env.WIDGET_PACK_PREFERENCE_URL;

async function openAppearance(page: Page) {
  await page.getByRole('navigation', { name: 'Settings categories', exact: true })
    .getByRole('button', { name: /Appearance & experience/ }).click();
  return page.locator('[aria-labelledby="settings-widget-design-packs"]');
}

test.afterAll(async () => { await closeMockApiFixtures(); });

test('real PostgreSQL preference synchronizes isolated browsers by external-provider identity', async ({ browser }, info) => {
  test.skip(!endpoint, 'Requires a disposable live preference endpoint in WIDGET_PACK_PREFERENCE_URL');
  expect(new URL(endpoint!).hostname, 'Use only a disposable loopback test server').toBe('127.0.0.1');
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({
    viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block',
  })));
  const failures: string[] = [];
  try {
    const subjects = ['widget-browser-account-a', 'widget-browser-account-a', 'widget-browser-account-b'];
    for (const subject of [subjects[0], subjects[2]]) {
      const reset = await contexts[0].request.put(endpoint!, {
        headers: { 'X-Forwarded-User': subject }, data: { pack_id: 'classic' },
      });
      expect(reset.ok()).toBe(true);
    }
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const mocks = await Promise.all(pages.map(async (page, index) => {
      page.on('pageerror', error => failures.push(error.message));
      const fixture = await installPackReview(page, 'dark', 1440, false, reviewWidgets.slice(0, 7));
      await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, fixture, {
        json: {
          mode: 'forward_auth', subject: subjects[index], subject_header: 'X-Forwarded-User',
          authentication_owner: 'external_provider', access_policy: 'all_proxy_users_are_operators',
          capabilities: { step_up_reauth: false, totp_enrollment: false, session_list: false, impersonation: false, rbac: false },
        },
      }));
      // Only this route reaches the real implementation and disposable database.
      await page.route('**/api/v1/settings/widget-design-pack', async route => {
        const response = await route.fetch({
          url: endpoint!,
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-User': subjects[index] },
        });
        await fulfillApiFixture(route, fixture, { response });
      });
      return fixture;
    }));

    await pages[0].goto('/settings');
    await waitForHarnessReady(pages[0], mocks[0]);
    const first = await openAppearance(pages[0]);
    await expect(first.getByRole('button', { name: 'Classic active', exact: true })).toBeDisabled();
    await first.getByRole('button', { name: 'Use Cyberdeck pack', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Cyberdeck active', exact: true })).toBeDisabled();

    await pages[1].goto('/settings');
    await waitForHarnessReady(pages[1], mocks[1]);
    const second = await openAppearance(pages[1]);
    await expect(second.getByRole('button', { name: 'Cyberdeck active', exact: true })).toBeDisabled();
    expect(await pages[1].evaluate(() => Object.keys(localStorage)
      .filter(key => key.startsWith('teslasync.widget-design-pack.')))).toEqual([]);

    await first.getByRole('button', { name: 'Use Memphis Pop pack', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Memphis Pop active', exact: true })).toBeDisabled();
    await expect(second.getByRole('button', { name: 'Memphis Pop active', exact: true })).toBeDisabled({ timeout: 35_000 });

    await pages[2].goto('/settings');
    await waitForHarnessReady(pages[2], mocks[2]);
    const otherAccount = await openAppearance(pages[2]);
    await expect(otherAccount.getByRole('button', { name: 'Classic active', exact: true })).toBeDisabled();
    await otherAccount.getByRole('button', { name: 'Use Quiet Form pack', exact: true }).click();
    await expect(otherAccount.getByRole('button', { name: 'Quiet Form active', exact: true })).toBeDisabled();
    await pages[0].reload();
    const restored = await openAppearance(pages[0]);
    await expect(restored.getByRole('button', { name: 'Memphis Pop active', exact: true })).toBeDisabled();

    await pages[0].route('**/api/v1/settings/widget-design-pack', async route => {
      if (route.request().method() === 'PUT') {
        await fulfillApiFixture(route, mocks[0], { status: 503, json: { error: 'Synthetic connection interruption' } });
      } else {
        await route.fallback();
      }
    });
    await restored.getByRole('button', { name: 'Use Neo Brutal pack', exact: true }).click();
    await expect(restored.getByRole('button', { name: 'Memphis Pop active', exact: true })).toBeDisabled();
    await expect(restored.getByRole('alert')).toContainText('Your last confirmed selection remains visible.');
    await expect(second.getByRole('button', { name: 'Memphis Pop active', exact: true })).toBeDisabled();
    await restored.screenshot({ path: info.outputPath('confirmed-selection-after-save-failure.png'), animations: 'disabled' });
    await second.screenshot({ path: info.outputPath('independent-browser-saved-selection.png'), animations: 'disabled' });
    expect(failures).toEqual([]);
    for (let index = 0; index < pages.length; index += 1) {
      await assertMockApiComplete(pages[index], mocks[index]);
    }
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
