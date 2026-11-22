import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { healthFixture, installExistingBatterySources } from './operationalbrief-contracts/battery.fixtures';
import { expectNoHorizontalOverflow } from './qualityAssertions';

test.skip(process.env.SMART_CAPACITY_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const reviewPath = '/battery-degradation?vehicle_id=7';
const endpoint = '/api/v1/battery/capacity-digest';
const title = 'Private monthly battery digest';
const cardTitle = 'Estimated usable battery energy changed';

async function installFixtures(page: Page, subject: string, theme: 'dark' | 'light', pack: string) {
  const api = await installApiMocks(page, 'populated', theme);
  if (!api) throw new Error('Missing isolated API fixtures');
  await installExistingBatterySources(page, api);
  await page.route(url => url.pathname === '/api/v1/analytics/battery-health', route =>
    fulfillApiFixture(route, api, { json: healthFixture() }));
  await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
    json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
  }));
  await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillApiFixture(route, api, {
      json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: pack, app_wide: true },
    });
  });
  await page.route(url => url.pathname === endpoint, async route => {
    const headers = await route.request().allHeaders();
    expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
    expect(new URL(route.request().url()).searchParams.get('vehicle_id')).toBe('7');
    await forwardLocalApiFixture(route, api, headers);
  });
  return api;
}

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`private capacity digest with measured charge sessions: ${variant.name}`, async ({ context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const owner = `synthetic-capacity-${variant.name}`;
    const foreign = `synthetic-capacity-foreign-${variant.name}`;
    const now = '2026-11-02T09:00:00Z';
    const due = '2026-11-02T10:00:00Z';
    const actions: string[] = [];
    context.on('request', request => {
      const { pathname } = new URL(request.url());
      if (request.method() !== 'GET' && pathname.startsWith('/api/v1/') && pathname !== '/api/v1/pinned') {
        actions.push(`${request.method()} ${pathname}`);
      }
    });
    const tick = async (phase: string) => {
      const response = await context.request.post(`${origin}/__fixture/capacity-digest?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const open = async (subject: string, at: string) => {
      await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
      const page = await context.newPage();
      await page.setViewportSize({ width: variant.width, height: variant.height });
      await page.clock.setFixedTime(new Date(at));
      await seedBrowserState(page, variant.theme, reviewPath);
      const api = await installFixtures(page, subject, variant.theme, variant.pack);
      await page.goto(reviewPath);
      await waitForHarnessReady(page, api);
      const panel = page.getByRole('region', { name: title, exact: true });
      await panel.getByRole('button', { name: 'Review monthly battery digest' }).press('Enter');
      return { page, panel, api };
    };

    await tick('setup');
    const enrollment = await open(owner, now);
    await expect(enrollment.panel.getByText(/^Off\./)).toBeVisible();
    expect(actions).toEqual([]);
    await enrollment.panel.getByRole('button', { name: 'Set up monthly battery review' }).press('Enter');
    await expect(enrollment.panel.getByLabel('Digest time zone')).toBeFocused();
    await enrollment.panel.getByLabel('Digest time zone').fill('America/New_York');
    const save = enrollment.panel.getByRole('button', { name: 'Confirm private monthly digest' });
    await expect(save).toBeDisabled();
    await enrollment.panel.getByRole('switch', { name: /^I want a private monthly digest/ }).press('Space');
    await save.press('Enter');
    await expect(enrollment.panel.getByText(/^Active\. No digest/)).toBeVisible();
    await expect(enrollment.panel.getByRole('button', { name: 'Change digest time zone' })).toBeFocused();
    await assertMockApiComplete(enrollment.page, enrollment.api);
    await enrollment.page.close();

    await tick('due');
    const guest = await open(foreign, due);
    await expect(guest.panel.getByText(/^Off\./)).toBeVisible();
    await expect(guest.panel.getByText(cardTitle)).not.toBeVisible();
    await assertMockApiComplete(guest.page, guest.api);
    await guest.page.close();

    const review = await open(owner, due);
    await expect(review.panel.getByRole('heading', { name: cardTitle })).toBeVisible();
    await expect(review.panel.getByText(/Estimated change:.+6\.5\s*kWh.+5\.5\s*kWh/)).toBeVisible();
    await expect(review.panel.getByText(/Sep.*2026.+8 comparable charge days/)).toBeVisible();
    await expect(review.panel.getByText(/Oct.*2026.+8 comparable charge days/)).toBeVisible();
    await expect(review.panel.getByText(/not a capacity test or diagnosis/)).toBeVisible();
    await expect(review.panel.getByText(/Latest observation:.+digest expires.+America\/New_York/)).toBeVisible();
    await expectNoHorizontalOverflow(review.page);
    await review.panel.getByRole('link', { name: 'Review degradation history' }).press('Enter');
    await expect(review.page).toHaveURL(/#battery-degradation-history$/);
    await expect(review.page.getByRole('heading', { name: 'Degradation history', exact: true })).toBeVisible();
    expect(actions).toEqual([`PUT ${endpoint}`]);
    if (variant.name === 'desktop') {
      await review.panel.getByRole('button', { name: /^Dismiss this month/ }).press('Enter');
      await expect(review.panel.getByText(/^Active\. No digest/)).toBeVisible();
      await expect(review.panel.getByText(cardTitle)).not.toBeVisible();
      expect(actions).toEqual([`PUT ${endpoint}`, `PATCH ${endpoint}`]);
    } else {
      await tick('expiry');
      const expiredRead = review.page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.status() === 200);
      const panelToggle = review.panel.getByRole('button', { name: 'Review monthly battery digest' });
      await panelToggle.press('Enter');
      await panelToggle.press('Enter');
      await expiredRead;
      await expect(review.panel.getByText(/^Active\. No digest/)).toBeVisible();
      await expect(review.panel.getByText(cardTitle)).not.toBeVisible();
      expect(actions).toEqual([`PUT ${endpoint}`]);
    }
    await review.panel.getByRole('button', { name: 'Pause monthly review' }).press('Enter');
    await expect(review.panel.getByText(/^Paused\./)).toBeVisible();
    await review.panel.getByRole('button', { name: 'Turn off and clear monthly digest' }).press('Enter');
    await expect(review.panel.getByText(/^Off\./)).toBeVisible();
    expect(actions.slice(-2)).toEqual([`PUT ${endpoint}`, `DELETE ${endpoint}`]);
    await assertMockApiComplete(review.page, review.api);
  });
}
