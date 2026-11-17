import { expect, test, type Page } from '@playwright/test';
import {
  assertMockApiComplete, fulfillApiMock, installApiMocks, resolveApiFixture,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';

const BUCKET = 'a'.repeat(32);
const policyHeaders = {
  'X-RateLimit-Bucket': BUCKET,
  'X-RateLimit-Scope': '/vehicles',
  'X-RateLimit-Methods': 'GET',
  'X-RateLimit-Source': 'teslasync',
  'X-RateLimit-Enforcement': 'process',
};

async function fleet(page: Page, retryAfter = 3) {
  await seedBrowserState(page, 'dark', '/vehicles');
  const mocks = await installApiMocks(page, 'populated');
  const state = { reads: 0, rejectNext: false };
  await page.route(url => url.pathname === '/api/v1/vehicles' && !url.search, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    state.reads++;
    const limited = state.rejectNext;
    state.rejectNext = false;
    await fulfillApiMock(route, mocks, {
      status: limited ? 429 : 200,
      headers: {
        ...policyHeaders, 'Content-Type': 'application/json',
        ...(limited ? { 'X-RateLimit-Limited': 'true', 'Retry-After': String(retryAfter) } : {}),
      },
      body: JSON.stringify(limited
        ? { error: { code: 'RATE_LIMITED', message: 'Test quota exhausted' } }
        : resolveApiFixture('/vehicles', 'GET', 'populated').body),
    });
  });
  await page.goto('/vehicles', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mocks);
  await expect(page.getByRole('main').getByText('Aurora', { exact: true }).first()).toBeVisible();
  return { state, mocks };
}

function refresh(page: Page) {
  return page.getByRole('main').locator('[data-role="page-header"]')
    .getByRole('button', { name: /^Refresh data/ });
}

test('one 429 pauses only affected reads, retains fleet data, and recovers without duplicate requests', async ({ page }) => {
  const { state, mocks } = await fleet(page);
  const baseline = state.reads;
  state.rejectNext = true;
  await refresh(page).click();
  const banner = page.getByTestId('rate-limit-banner');
  await expect(banner).toContainText('TeslaSync request limit reached');
  await expect(page.getByTestId('rate-limit-banner-retry')).toBeDisabled();
  await expect(page.getByRole('main').getByText('Aurora', { exact: true }).first()).toBeVisible();
  await refresh(page).click();
  await refresh(page).click();
  expect(state.reads).toBe(baseline + 1);
  await expect.poll(() => state.reads, { timeout: 10_000 }).toBe(baseline + 2);
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Aurora', { exact: true }).first()).toBeVisible();
  await assertMockApiComplete(page, mocks);
});

test('a known identity-bound quota coordinates two tabs without another 429 request', async ({ page, context }) => {
  const first = await fleet(page, 30);
  const peer = await context.newPage();
  const second = await fleet(peer, 30);
  first.state.rejectNext = true;
  await page.bringToFront();
  await refresh(page).click();
  await expect(page.getByTestId('rate-limit-banner')).toBeVisible();
  await expect(peer.getByTestId('rate-limit-banner')).toContainText('TeslaSync request limit reached');
  const baseline = second.state.reads;
  await peer.bringToFront();
  await refresh(peer).click();
  expect(first.state.reads).toBe(2);
  expect(second.state.reads).toBe(baseline);
  await assertMockApiComplete(peer, second.mocks);
  await assertMockApiComplete(page, first.mocks);
});

test('a write-only quota leaves fleet reads usable and never replays the operator action', async ({ page }) => {
  const { state, mocks } = await fleet(page);
  let writes = 0;
  await page.route(url => url.pathname === '/api/v1/vehicles/sync', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    writes++;
    await fulfillApiMock(route, mocks, {
      status: 429,
      headers: {
        ...policyHeaders, 'Content-Type': 'application/json',
        'X-RateLimit-Bucket': 'b'.repeat(32), 'X-RateLimit-Scope': '/*',
        'X-RateLimit-Methods': 'WRITE', 'X-RateLimit-Limited': 'true', 'Retry-After': '1',
      },
      body: JSON.stringify({ error: 'Test write quota exhausted', code: 'WRITE_RATE_LIMITED' }),
    });
  });
  await page.getByRole('button', { name: 'Sync from Tesla', exact: true }).click();
  await expect(page.getByTestId('rate-limit-banner')).toContainText('Retry the action yourself');
  await expect(page.getByTestId('rate-limit-banner-retry')).toHaveCount(0);
  const baseline = state.reads;
  await refresh(page).click();
  await expect.poll(() => state.reads).toBe(baseline + 1);
  await page.waitForTimeout(1500);
  expect(writes).toBe(1);
  await assertMockApiComplete(page, mocks);
});
