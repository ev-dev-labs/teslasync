const path = require('node:path');
const { test } = require(path.resolve(process.cwd(), 'e2e', 'app-design-test'));
const { expect } = require(path.resolve(process.cwd(), 'node_modules', '@playwright', 'test'));
const { createReviewPreference, installPackReview } = require(path.resolve(process.cwd(), 'e2e', 'widget-design-packs.mock'));
const { installSpecializedReviewSources } = require(path.resolve(process.cwd(), 'e2e', 'widget-design-packs.specialized.mock'));
const { closeMockApiFixtures, waitForHarnessReady } = require(path.resolve(process.cwd(), 'e2e', 'mockApi'));
const { findClippedBottomNavigationLabels, findSplitBottomNavigationWords } = require(path.resolve(process.cwd(), 'e2e', 'design-packs-capture'));

const selection = [
  ['onboarding-checklist', 'Onboarding'], ['vehicle-hero', 'Vehicle card'],
  ['vehicle-twin', 'Digital Twin'], ['digital-twin-mini', 'Digital Twin Mini'],
  ['battery-gauge', 'Battery'], ['climate-status', 'Climate'],
  ['recent-drives', 'Recent drives'], ['charge-status', 'Charge status'],
  ['security-status', 'Security'], ['quick-nav', 'Quick navigation'],
  ['fleet-posture', 'Fleet posture'],
];

test.afterAll(async () => { await closeMockApiFixtures(); });

async function openDrives(page, width) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  const preference = createReviewPreference();
  preference.pack_id = 'v4';
  preference.app_wide = true;
  const mocks = await installPackReview(
    page, 'dark', width, false, selection, true, preference, 'http://127.0.0.1:54872', { font_scale: 1 },
  );
  await installSpecializedReviewSources(page, mocks, 'dark');
  await page.goto('/drives', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mocks);
  return mocks;
}

test('phone labels fit after v4 navigation correction', async ({ page }) => {
  await openDrives(page, 390);
  const clipped = await findClippedBottomNavigationLabels(page);
  const split = await findSplitBottomNavigationWords(page);
  const geometry = await page.locator('[data-role="bottom-tab-bar"]').evaluate(nav => {
    const navStyle = getComputedStyle(nav);
    return {
      paddingTop: navStyle.paddingTop,
      paddingBottom: navStyle.paddingBottom,
      rowGap: navStyle.rowGap,
      buttons: Array.from(nav.querySelectorAll('button')).map(button => {
        const label = button.querySelector('.sidenav-tab-label');
        const rect = button.getBoundingClientRect();
        return {
          text: button.innerText,
          buttonFont: getComputedStyle(button).fontSize,
          labelFont: getComputedStyle(label).fontSize,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
        };
      }),
    };
  });
  console.log('PHONE_NAV', JSON.stringify({ clipped, split, geometry }));
  expect(clipped).toEqual([]);
  expect(split).toEqual([]);
});

test('phone bottom tab hit areas do not overlap or leave viewport', async ({ page }) => {
  await openDrives(page, 390);
  const bounds = await page.locator('[data-role="bottom-tab-bar"] button').evaluateAll(buttons =>
    buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    }));
  console.log('PHONE_HIT_AREAS', JSON.stringify(bounds));
  expect.soft(bounds[0].bottom).toBeLessThanOrEqual(bounds[3].top);
  expect.soft(bounds[4].bottom).toBeLessThanOrEqual(844);
});

test('desktop workspace controls stay on one row', async ({ page }) => {
  await openDrives(page, 1440);
  const geometry = await page.locator('[data-role="workspace-header"]').evaluate(header => {
    const controls = header.querySelector('[data-app-header-slot="controls"]');
    const rect = header.getBoundingClientRect();
    return {
      headerHeight: rect.height,
      tracks: getComputedStyle(header).gridTemplateColumns,
      controls: Array.from(controls.children).map(child => {
        const element = child;
        const box = element.getBoundingClientRect();
        return { label: element.innerText || element.getAttribute('aria-label') || element.outerHTML.slice(0, 100), top: box.top, bottom: box.bottom, width: box.width };
      }),
    };
  });
  console.log('DESKTOP_HEADER', JSON.stringify(geometry));
  const centers = geometry.controls.map(control => (control.top + control.bottom) / 2);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
});
