import { expect } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import {
  expectNoHorizontalOverflow,
  expectNoRuntimeFailures,
  monitorPage,
} from './qualityAssertions';
import { routeBuiltApplication, test } from './app-design-test';
import { createReviewPreference, installPackReview, selectReviewPack } from './widget-design-packs.mock';
import { installSpecializedReviewSources } from './widget-design-packs.specialized.mock';

for (const path of ['/', '/data-repair']) {
  test(`critical route loads in secondary engine: ${path}`, async ({ page }) => {
    await seedBrowserState(page, 'dark', path);
    const mockApi = await installApiMocks(page, 'populated');
    const diagnostics = process.env.E2E_MOCKS === '0' ? monitorPage(page) : null;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByText(/page failed to load/i)).toHaveCount(0);
    await waitForHarnessReady(page, mockApi);
    await expectNoHorizontalOverflow(page);
    if (diagnostics) await expectNoRuntimeFailures(diagnostics);
    await assertMockApiComplete(page, mockApi);
  });
}

test('installed mobile navigation opens and follows a shortcut in secondary engines', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
  await seedBrowserState(page, 'dark', '/');
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);

  // The Home tab opens the Home-view sheet directly (polish keeps tabbed
  // sections out of the More grid); the drawer-era data-sidebar-open hook
  // is gone by design and unit tests pin its absence.
  await page.locator('.sidenav-phone-tabs').getByRole('button', { name: 'Home' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  // The section sheet hosts panel navigation with the All pages shortcut.
  await expect(page.getByRole('navigation', { name: 'Sidebar navigation' })).toBeVisible();
  await page.getByRole('link', { name: 'All pages' }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Explore features', exact: true })).toBeVisible();
  await waitForHarnessReady(page, mockApi);
  await assertMockApiComplete(page, mockApi);
});

test('live map fills its stage across phone and desktop layouts', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const origin = testInfo.project.use.baseURL;
  if (typeof origin !== 'string') throw new Error('A local test origin is required');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const preference = createReviewPreference();
  preference.app_wide = true;
  const mocks = await installPackReview(page, 'dark', 1440, false, [], false, preference, origin);
  await installSpecializedReviewSources(page, mocks, 'dark');
  await page.addInitScript(() => localStorage.setItem('teslasync:low-bandwidth:v1', 'on'));
  await routeBuiltApplication(page, new URL(origin).origin, ['/live'], process.env.DESIGN_PACK_DIST_DIR);
  await page.goto('/live');
  await waitForHarnessReady(page, mocks);
  const stage = page.getByRole('region', { name: 'Recorded location map', exact: true });
  const map = stage.locator('.leaflet-container');
  for (const pack of ['classic', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'motorsport', 'blueprint',
    'editorial', 'ambient', 'terminal', 'atlas', 'analog'] as const) {
    await selectReviewPack(page, pack);
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', pack);
    await expect(map, `${pack} live map`).toBeVisible();
  }
  for (const width of [1440, 360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(map, `map at ${width}px`).toBeVisible();
    await expect.poll(async () => {
      const bounds = await stage.evaluate(element => {
        const outer = element.getBoundingClientRect();
        const inner = element.querySelector('.leaflet-container')?.getBoundingClientRect();
        return inner ? { outer: outer.height, inner: inner.height } : null;
      });
      return bounds && bounds.outer >= (width >= 1024 ? 560 : 380)
        && Math.abs(bounds.outer - bounds.inner) < 1;
    }, { message: `map fills its ${width}px stage` }).toBe(true);
    await expectNoHorizontalOverflow(page);
  }
  const streets = page.getByRole('group', { name: 'Map style' }).getByRole('button', { name: 'Streets' });
  const observationTime = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(observationTime);
  try {
    await streets.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const box = await streets.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error('Map style control has no visible bounds');
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(await streets.evaluate((element, center) =>
      element.contains(document.elementFromPoint(center.x, center.y)), point)).toBe(true);
    await page.mouse.click(point.x, point.y);
  } finally {
    await page.clock.setFixedTime(observationTime);
  }
  await expect(streets).toHaveAttribute('aria-pressed', 'true');
  await assertMockApiComplete(page, mocks);
});
