import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ChargingSession } from '../src/api/types';
import { PACK_IDS, type PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { attachJsonEvidence, routeBuiltApplication, test } from './app-design-test';
import { catalogueOperationalSources } from './dashboardCatalogueOperationalSources';
import { findSmallBodyText } from './design-packs-capture';
import { assertMockApiComplete, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import { createReviewPreference, installPackReview, packNames, selectReviewPack } from './widget-design-packs.mock';
import { inspectEnergyReview } from './widget-design-packs.energy';
import { energyReviewPath, installEnergyReviewSources } from './widget-design-packs.energy.mock';

// Separate the substantive source-state work from the existing four all-route
// cases, without another project/workflow or reloading on ordinary pack changes.
test.setTimeout(1_800_000);

test('phone charger details stay legible on a contrast-checkable Terminal chart', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setContent(`
    <style>
      :root { --font-scale: 0.85; --density-gap: 8px; --surface-1: #fafbfc;
        --text-muted: #57667c; --border-default: #a0a9b5; --border-strong: #69798a; }
      .text-xs { font-size: 12px; color: var(--text-muted); }
      .justify-between { display: flex; justify-content: space-between; }
      [data-chart-viewport] { width: 300px; }
    </style>
    <section data-battery-panel="energy-charger-breakdown">
      <div id="plot" data-chart-viewport="bounded" data-app-design-owner="pack-terminal">
        <div class="justify-between" data-app-design-owner="pack-terminal">
          <span class="text-xs" data-app-design-owner="pack-terminal">1 session</span>
          <span class="text-xs" data-app-design-owner="pack-terminal"><span>$0.16</span>/kWh</span>
        </div>
        <span id="preserved" data-app-design-preserve>
          <span class="text-xs" data-app-design-owner="pack-terminal">Preserved</span>
        </span>
        <span id="unowned" class="text-xs">Unowned</span>
      </div>
    </section>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'terminal');
    element.setAttribute('data-app-design-owner', 'pack-terminal');
  });
  for (const file of ['packs/terminal.css', 'mobile.css']) {
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', file), 'utf8') });
  }
  const metadata = page.locator('#plot .justify-between .text-xs');
  await expect(metadata).toHaveCount(2);
  expect(await metadata.evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)))).toEqual([16, 16]);
  expect(await page.locator('#plot .justify-between').evaluate(node => getComputedStyle(node).flexWrap)).toBe('wrap');
  expect(await page.locator('#preserved .text-xs').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(12);
  expect(await page.locator('#unowned').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(12);
  const undersized = (await findSmallBodyText(page)).map(item => item.text);
  expect(undersized).toEqual(expect.arrayContaining(['Preserved', 'Unowned']));
  expect(undersized).not.toContain('1 session');
  const audit = await new AxeBuilder({ page }).include('#plot').withRules(['color-contrast']).analyze();
  expect(audit.violations).toEqual([]);
  expect(audit.incomplete).toEqual([]);

  await page.locator('html').evaluate(element => element.style.setProperty('--font-scale', '1.35'));
  expect(await metadata.first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(21.6, 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await metadata.first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(12);
});

for (const theme of ['dark', 'light'] as const) {
  for (const width of [360, 430]) {
    for (const fontScale of [1, 1.35]) {
      test(`Energy charger details fit ${width}px in ${theme} at ${fontScale} scale`, async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        const baseURL = testInfo.project.use.baseURL;
        if (typeof baseURL !== 'string') throw new Error('Review origin is required');
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        const saved = createReviewPreference();
        saved.pack_id = 'terminal';
        saved.app_wide = true;
        const mocks = await installPackReview(page, theme, 390, false, [], true, saved, baseURL,
          { font_scale: fontScale });
        const [session] = catalogueOperationalSources(new Date().toISOString())['/charging'] as ChargingSession[];
        const sessions = [session, { ...session, id: 702, charger_type: 'Tesla' },
          { ...session, id: 703, charger_type: 'CCS' }];
        await page.route(url => url.pathname === '/api/v1/charging', request => {
          if (request.request().method() !== 'GET') return request.fallback();
          return fulfillApiFixture(request, mocks, { json: sessions });
        });
        await routeBuiltApplication(page, new URL(baseURL).origin, ['/energy'], process.env.DESIGN_PACK_DIST_DIR);
        await page.goto('/energy');
        await waitForHarnessReady(page, mocks);
        const panel = page.locator('[data-battery-panel="energy-charger-breakdown"]');
        const plot = panel.locator('[data-chart-viewport]');
        const packs = fontScale === 1.35 ? PACK_IDS : ['terminal'] as const;
        let selected: PackId = 'terminal';
        for (const packId of packs) {
          await test.step(`${packId} charger metadata`, async () => {
            if (packId !== selected) {
              await selectReviewPack(page, packId);
              selected = packId;
            }
            await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', packId, { timeout: 20_000 });
            await expect(plot).toBeVisible();
            const metadata = plot.locator('.text-xs');
            await expect(metadata).toHaveCount(6);
            const measurements = await metadata.evaluateAll(nodes => nodes.map(node => {
              const bounds = node.getBoundingClientRect();
              const viewport = node.closest('[data-chart-viewport]')!.getBoundingClientRect();
              return {
                text: node.textContent?.trim(),
                fontSize: parseFloat(getComputedStyle(node).fontSize),
                left: bounds.left - viewport.left,
                right: viewport.right - bounds.right,
                top: bounds.top - viewport.top,
                bottom: viewport.bottom - bounds.bottom,
              };
            }));
            for (const item of measurements) {
              expect(item.text).toBeTruthy();
              expect(item.fontSize).toBeGreaterThanOrEqual(Math.max(16, 16 * fontScale) - 0.1);
              expect(Math.min(item.left, item.right, item.top, item.bottom)).toBeGreaterThanOrEqual(-1);
            }
            const overflow = await page.evaluate(() =>
              document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow).toBeLessThanOrEqual(1);
            if (packId === 'terminal') {
              const audit = await new AxeBuilder({ page }).include('[data-battery-panel="energy-charger-breakdown"]')
                .withRules(['color-contrast']).analyze();
              expect(audit.violations).toEqual([]);
              expect(audit.incomplete).toEqual([]);
            }
          });
        }
        await assertMockApiComplete(page, mocks);
      });
    }
  }
}

test('keeps live energy reads mocked while navigating away', async ({ page }, testInfo) => {
  const saved = createReviewPreference();
  saved.app_wide = true;
  const mocks = await installPackReview(page, 'dark', 390, false, [], false, saved,
    testInfo.project.use.baseURL);
  const sources = await installEnergyReviewSources(page, mocks);
  sources.setActive(true);
  await page.goto(energyReviewPath);
  await waitForHarnessReady(page, mocks);

  let finalPollStatus = 0;
  await page.exposeFunction('recordEnergyExitPoll', (status: number) => { finalPollStatus = status; });
  await page.evaluate(() => {
    const owner = window as Window & {
      __teslasyncNavigateAfterReads?: (destination: string | null) => Promise<void>;
      recordEnergyExitPoll: (status: number) => Promise<void>;
    };
    const navigate = owner.__teslasyncNavigateAfterReads;
    if (!navigate) throw new Error('Application navigation tracker is missing');
    owner.__teslasyncNavigateAfterReads = async destination => {
      await owner.recordEnergyExitPoll((await fetch('/api/v1/vehicles/7/energy/flow')).status);
      await navigate(destination);
    };
  });
  await sources.leaveToSettings();
  expect(finalPollStatus).toBe(200);
  await assertMockApiComplete(page, mocks);
});

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1440, 390]) {
    test(`Energy flow real source states at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      const saved = createReviewPreference();
      saved.app_wide = true;
      const mocks = await installPackReview(page, theme, width, false, [], false, saved,
        testInfo.project.use.baseURL);
      const sources = await installEnergyReviewSources(page, mocks);
      sources.setActive(true);
      await page.addInitScript(() => localStorage.setItem('teslasync:low-bandwidth:v1', 'on'));
      await page.goto(energyReviewPath);
      await waitForHarnessReady(page, mocks);
      const evidence: Record<string, unknown> = {};
      const signatures = new Map<string, Set<string>>();
      for (const packId of Object.keys(packNames) as PackId[]) {
        await test.step(`${packId} independent energy sources and actual open controls`, async () => {
          await selectReviewPack(page, packId);
          await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', packId);
          const geometry = await inspectEnergyReview(page, packId, testInfo, sources, true);
          evidence[packId] = geometry;
          for (const [state, measured] of Object.entries(geometry)) {
            const values = signatures.get(state) ?? new Set<string>();
            values.add(JSON.stringify(measured));
            signatures.set(state, values);
          }
        });
      }
      await attachJsonEvidence(testInfo, 'energy-flow-source-state-geometry.json', evidence);
      // Require every authored real state, not just whichever entries happen
      // to survive. Signatures contain measured page + focused-surface geometry.
      const requiredStates = [
        'review-retained-sort', 'unknown-live', 'partial-live', 'empty-history',
        'missing-positive-efficiency', 'flow-retained', 'history-retained',
        'flow-initial-loading', 'flow-initial-error', 'flow-recovered',
        'history-initial-loading', 'history-initial-error', 'history-recovered',
        ...(width === 390 ? ['row-detail'] : []),
      ];
      for (const state of requiredStates) {
        expect.soft(signatures.get(state)?.size ?? 0,
          `EXACTLY 27 rendered ${state} compositions at ${width}px/${theme}`).toBe(27);
      }
      expect(sources.reads.some(read => read.kind === 'held')).toBe(true);
      expect(sources.reads.some(read => read.kind === 'error')).toBe(true);
      expect(mocks.requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        && !['/api/v1/settings/widget-design-pack', '/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path))).toEqual([]);
      expect(failures).toEqual([]);
      // Live queries keep polling through this check; their fixtures belong to the page lifetime.
      await assertMockApiComplete(page, mocks);
    });
  }
}

test('Energy mobile header tooltips stay contained across all designs', async ({ browser }, testInfo) => {
  const { assertContained, assertOwnedTree, profileAttributes } = await import('./widget-design-packs.acceptance');
  for (const theme of ['dark', 'light'] as const) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 1000 },
      colorScheme: theme,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const page = await context.newPage();
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    const saved = createReviewPreference();
    saved.app_wide = true;
    const mocks = await installPackReview(page, theme, 390, false, [], false, saved,
      testInfo.project.use.baseURL);
    const sources = await installEnergyReviewSources(page, mocks);
    sources.setActive(true);
    const evidence: Record<string, unknown> = {};
    try {
      await page.addInitScript(() => localStorage.setItem('teslasync:low-bandwidth:v1', 'on'));
      await page.goto(energyReviewPath);
      await waitForHarnessReady(page, mocks);
      const main = page.locator('main');
      const header = main.locator('[data-app-part~="page-header"]');
      const heading = header.getByRole('heading', { level: 1, name: 'Energy flow', exact: true });
      for (const packId of Object.keys(packNames) as PackId[]) {
        await test.step(`${theme}/${packId} closed, hovered and keyboard-focused header help`, async () => {
          await selectReviewPack(page, packId);
          await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', packId);
          await assertOwnedTree(header, packId);
          await heading.scrollIntoViewIfNeeded();
          await page.mouse.move(0, 0);
          await heading.focus();
          const buttons = [
            header.getByRole('button', { name: 'More info: Energy flow', exact: true }),
            header.getByRole('button', { name: /^Refresh data ·/ }),
          ];
          await expect(header.locator('button[aria-describedby]')).toHaveCount(buttons.length);
          const measurements: Record<string, unknown> = {};
          for (const [index, button] of buttons.entries()) {
            const id = await button.getAttribute('aria-describedby');
            expect(id).toBeTruthy();
            const tooltip = page.locator(`[id="${id}"]`);
            await expect(tooltip).toHaveAttribute('role', 'tooltip');
            const text = await tooltip.textContent();
            expect(text?.trim().length).toBeGreaterThan(0);
            if (index === 0) expect(text).toBe('Power distribution and energy analysis');
            const states: Record<string, unknown> = {};
            const contained = async (state: string) => {
              await expect(tooltip).toHaveText(text!);
              await assertContained(main, `${theme}/${packId}/${state} energy main`);
              await assertContained(header, `${theme}/${packId}/${state} energy header`);
              await assertContained(header.locator('[data-app-part~="page-actions"]'),
                `${theme}/${packId}/${state} trailing commands`);
              await assertContained(tooltip, `${theme}/${packId}/${state} complete tooltip`);
              await assertOwnedTree(tooltip, packId);
              const geometry = await tooltip.evaluate(node => {
                const box = node.getBoundingClientRect();
                return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
              });
              expect(geometry.top).toBeGreaterThanOrEqual(0);
              expect(geometry.bottom).toBeLessThanOrEqual(1000);
              const scope = (node: Element, attributes: readonly string[]) => {
                const owner = node.closest('[data-app-design-preview]') ?? document.documentElement;
                return Object.fromEntries(attributes.map(name => [name, owner.getAttribute(name)]));
              };
              expect(await tooltip.evaluate(scope, profileAttributes))
                .toEqual(await button.evaluate(scope, profileAttributes));
              states[state] = geometry;
            };
            await expect(tooltip).toHaveCSS('opacity', '0');
            await contained('closed');
            await button.hover();
            await expect(tooltip).toHaveCSS('opacity', '1');
            await contained('hover');
            await page.mouse.move(0, 0);
            await expect(tooltip).toHaveCSS('opacity', '0');
            await page.keyboard.press('Tab');
            await expect(button).toBeFocused();
            await expect(tooltip).toHaveCSS('opacity', '1');
            await contained('focus');
            await page.keyboard.press('Escape');
            await expect(button).toBeFocused();
            await expect(tooltip).toHaveCSS('opacity', '0');
            await contained('dismissed');
            measurements[index] = { text, states };
          }
          await heading.focus();
          evidence[packId] = measurements;
        });
      }
      expect(Object.keys(evidence)).toHaveLength(27);
    } finally {
      await attachJsonEvidence(testInfo, `energy-mobile-header-${theme}.json`, evidence);
      await testInfo.attach(`energy-mobile-header-${theme}.png`, {
        body: await page.screenshot(), contentType: 'image/png',
      });
      try {
        expect(mocks.requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
          && !['/api/v1/settings/widget-design-pack', '/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path))).toEqual([]);
        expect(failures).toEqual([]);
        await assertMockApiComplete(page, mocks);
      } finally {
        await context.close();
      }
    }
  }
});
