import { expect, test, type Page } from '@playwright/test';
import {
  assertMockApiComplete,
  expectThemeApplied,
  installApiMocks,
  seedBrowserState,
  type E2EUIDensity,
  waitForHarnessReady,
  waitForNoVisibleActivity,
} from './mockApi';
import { VISUAL_ROUTES, type DataScenario } from './routeRegistry';

type VisualProfile =
  | 'core'
  | 'density'
  | 'long-content'
  | 'large-fleet'
  | 'degraded'
  | 'forced-colors';

const PROFILE_ROUTES: Record<VisualProfile, ReadonlySet<string>> = {
  core: new Set(VISUAL_ROUTES.map((route) => route.name)),
  density: new Set(['drives', 'charging']),
  'long-content': new Set(['settings', 'battery']),
  'large-fleet': new Set(['fleet']),
  degraded: new Set(['dashboard', 'fleet', 'battery', 'data-repair']),
  'forced-colors': new Set(['dashboard']),
};

const DEGRADED_SCENARIOS: Readonly<Record<string, DataScenario>> = {
  dashboard: 'empty',
  fleet: 'partial',
  battery: 'error',
  'data-repair': 'stale',
};

function visualProfile(metadata: Record<string, unknown>): VisualProfile {
  const profile = metadata.visualProfile;
  if (
    profile === 'density' ||
    profile === 'long-content' ||
    profile === 'large-fleet' ||
    profile === 'degraded' ||
    profile === 'forced-colors'
  ) {
    return profile;
  }
  return 'core';
}

function visualDensity(metadata: Record<string, unknown>): E2EUIDensity {
  const density = metadata.density;
  return density === 'compact' || density === 'spacious' ? density : 'comfortable';
}

async function stressVisibleCopy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement;
      const copy = node.textContent?.trim() ?? '';
      if (
        copy.length >= 3 &&
        copy.length <= 80 &&
        parent &&
        !parent.closest('[aria-hidden="true"], [role="contentinfo"], script, style, svg')
      ) {
        nodes.push(node);
      }
    }
    for (const node of nodes) {
      const copy = node.textContent?.trim() ?? '';
      node.textContent = `[!! ${copy} - ${copy} with extended localization !!]`;
    }
  });
}

for (const route of VISUAL_ROUTES) {
  test(`${route.name} visual baseline`, async ({ page }, testInfo) => {
    const profile = visualProfile(testInfo.project.metadata);
    test.skip(
      !PROFILE_ROUTES[profile].has(route.name),
      `${route.name} is outside the targeted ${profile} visual profile`,
    );

    const theme = testInfo.project.name.endsWith('-light') ? 'light' : 'dark';
    const density = visualDensity(testInfo.project.metadata);
    const scenario = profile === 'degraded'
      ? (DEGRADED_SCENARIOS[route.name] ?? 'populated')
      : profile === 'large-fleet'
        ? 'large-fleet'
        : 'populated';
    await seedBrowserState(page, theme, route.path, { density });
    const mockApi = await installApiMocks(page, scenario, theme, density);
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await waitForHarnessReady(page, mockApi);
    await expectThemeApplied(page, theme);
    await expect(page.locator('body')).toHaveAttribute('data-density', density);
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const viewportHeight = page.viewportSize()?.height ?? 900;
    for (let top = viewportHeight; top < pageHeight; top += viewportHeight) {
      await page.evaluate((scrollTop) => window.scrollTo(0, scrollTop), top);
      await waitForNoVisibleActivity(page);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForHarnessReady(page, mockApi);
    const sidebar = page.getByRole('navigation', { name: /sidebar navigation/i });
    if (await sidebar.count()) {
      await sidebar.evaluate((element) => { element.scrollTop = 0; });
    }
    if (route.name === 'battery' && scenario !== 'error') {
      await expect(page.getByText('State of Health', { exact: true })).toBeVisible();
    }
    if (route.name === 'battery' && scenario === 'error') {
      await expect(page.getByText('Service unavailable', { exact: true })).toBeVisible();
    }
    if (profile === 'large-fleet') {
      const fleetItems = page.locator('[role="listitem"][aria-setsize="120"]');
      await expect(fleetItems.first()).toBeVisible();
      expect(await fleetItems.count()).toBeLessThan(120);
      await fleetItems.first().scrollIntoViewIfNeeded();
      await waitForNoVisibleActivity(page);
    }
    if (profile === 'long-content') {
      await stressVisibleCopy(page);
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
    }
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          caret-color: transparent !important;
        }
        [aria-label^="API connection status"] {
          min-width: 8rem !important;
        }
        [aria-label^="Refresh data"],
        [aria-label^="Data freshness:"] {
          width: 8.5rem !important;
          min-width: 8.5rem !important;
          max-width: 8.5rem !important;
        }
      `,
    });
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      animations: 'disabled',
      fullPage: true,
      mask: [
        page.locator('time'),
        page.locator('[data-testid*="timestamp"], [data-testid*="relative-time"]'),
        page.locator('[aria-label^="API connection status"], [aria-label^="Refresh data"], [aria-label^="Data freshness:"]'),
        page.locator('.recharts-tooltip-wrapper'),
      ],
      threshold: 0.1,
      maxDiffPixels: 500,
    });
    await assertMockApiComplete(page, mockApi);
  });
}
