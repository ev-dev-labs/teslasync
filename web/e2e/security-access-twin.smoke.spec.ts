import { expect } from '@playwright/test';
import { routeBuiltApplication, test } from './app-design-test';
import { assertMockApiComplete, closeMockApiFixtures, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';
import { createReviewPreference, installPackReview } from './widget-design-packs.mock';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic application fixtures');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const [theme, pack] of [['dark', 'classic'], ['light', 'v1']] as const) {
  test(`Security Access twin has usable phone targets in ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const baseURL = testInfo.project.use.baseURL;
    if (typeof baseURL !== 'string') throw new Error('A local test origin is required');
    const origin = new URL(baseURL).origin;
    const preference = createReviewPreference();
    preference.pack_id = pack;
    preference.app_wide = true;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    });
    await page.setViewportSize({ width: 360, height: 900 });
    const mocks = await installPackReview(page, theme, 390, false, [], true, preference, origin);
    await page.route(url => url.pathname === '/api/v1/security/latest', request => {
      if (request.request().method() !== 'GET') return request.fallback();
      return fulfillApiFixture(request, mocks, {
        json: { vehicle_id: 7, ts: new Date().toISOString(), locked: true, sentry_mode: true },
      });
    });
    await routeBuiltApplication(page, origin, ['/security-access'], process.env.DESIGN_PACK_DIST_DIR);
    await page.goto('/security-access', { waitUntil: 'domcontentloaded' });
    await waitForHarnessReady(page, mocks);
    const twin = page.locator('[data-vehicle-twin]');
    await expect(twin).toBeVisible();
    const targets = twin.locator('[data-twin-touch-target]');
    const expected = ['frunk', 'trunk', 'frontWindow', 'rearWindow', 'frontDoor', 'rearDoor', 'chargePort', 'sentry', 'lock'];

    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 900 });
      const scene = await twin.evaluate(element => ({
        width: element.getBoundingClientRect().width,
        clientWidth: element.clientWidth,
        parentWidth: element.parentElement?.getBoundingClientRect().width,
        touchQuery: matchMedia('(max-width: 767px), (pointer: coarse)').matches,
        viewBox: element.querySelector('svg')?.getAttribute('viewBox'),
      }));
      await expect(targets, `${width}px twin geometry: ${JSON.stringify(scene)}`).toHaveCount(expected.length);
      await expect.poll(async () => {
        const sizes = await targets.locator('button').evaluateAll(buttons =>
          buttons.map(button => {
            const box = button.getBoundingClientRect();
            return Math.min(box.width, box.height);
          }));
        return sizes.length === expected.length ? Math.min(...sizes) : 0;
      }, { message: `${width}px twin targets must be at least 44px` }).toBeGreaterThanOrEqual(44);

      const boxes = await targets.evaluateAll(elements => elements.map(element => {
        const button = element.querySelector('button');
        if (!button) throw new Error('A twin target has no button');
        const box = button.getBoundingClientRect();
        return {
          name: element.getAttribute('data-twin-touch-target'),
          label: button.getAttribute('aria-label'),
          left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        };
      }));
      expect(boxes.map(box => box.name).sort()).toEqual([...expected].sort());
      const bounds = await twin.boundingBox();
      if (!bounds) throw new Error('Twin scene has no bounds');
      for (const box of boxes) {
        expect(box.label).toBeTruthy();
        expect(box.left).toBeGreaterThanOrEqual(bounds.x - 0.5);
        expect(box.right).toBeLessThanOrEqual(bounds.x + bounds.width + 0.5);
        expect(box.top).toBeGreaterThanOrEqual(bounds.y - 0.5);
        expect(box.bottom).toBeLessThanOrEqual(bounds.y + bounds.height + 0.5);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          expect(a.right <= b.left + 0.5 || b.right <= a.left + 0.5
            || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5, `${width}px: ${a.name} / ${b.name}`).toBe(true);
        }
      }
      await expectNoHorizontalOverflow(page);
    }

    for (const name of expected) {
      const target = twin.locator(`[data-twin-touch-target="${name}"] button`);
      if (testInfo.project.use.hasTouch) await target.tap();
      else await target.focus();
      const tooltipId = await target.getAttribute('aria-describedby');
      if (!tooltipId) throw new Error(`${name} inspection control has no tooltip relationship`);
      const tooltip = page.locator(`[id="${tooltipId}"]`);
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveCSS('opacity', '1');
      await expect(tooltip).toHaveText(await target.getAttribute('aria-label') ?? '');
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      await expect(targets).toHaveCount(expected.length);
    } else {
      await expect(targets).toHaveCount(0);
      await expect(twin.locator('foreignObject button')).toHaveCount(expected.length);
    }
    await assertMockApiComplete(page, mocks);
  });
}
