import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { resolve } from 'node:path';
import { routeBuiltApplication, test } from './app-design-test';
import { assertMockApiComplete, closeMockApiFixtures, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import { createReviewPreference, installGeofenceReviewSources, installPackReview, packNames, selectReviewPack } from './widget-design-packs.mock';
import { assertContained, assertNavigationTextContained, assertOwnerGuardActivation, assertPlotAndMap, assertTableNoMatchContained, compositionGeometry, inspectNestedDialog, inspectPortaledIsolation, inspectPreviewInteractions, isolationAppearance, profileAttributes, unexpectedNeutralScopes } from './widget-design-packs.acceptance';
import { getAppDesignAttributes } from '../src/components/ui/app-designs/designs';
import { PACK_IDS, type PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { CHART_COLORS_NEON_DARK } from '../src/lib/colors';
import { inspectSpecializedRoute, specializedReviewRoutes } from './widget-design-packs.specialized';
import { installSpecializedReviewSources } from './widget-design-packs.specialized.mock';
import { specializedDrives } from './widget-design-packs.specialized.fixtures';
import { inspectEnergyReview } from './widget-design-packs.energy';
import { energyReviewPath, installEnergyReviewSources } from './widget-design-packs.energy.mock';

test.setTimeout(1_800_000);
const packIds = Object.keys(packNames) as PackId[];
const preservedVariables = ['--theme-accent', '--surface-1', '--font-sans', '--font-mono',
  '--font-scale', '--leading', '--tracking', '--font-weight-bold', '--semantic-danger', '--semantic-success'];
const publicPaths = ['/watch', '/onboarding'] as const;
const acceptanceFamilies = [
  'shell-navigation', 'page-composition', 'controls-forms', 'tables-lists', 'dialogs-popovers',
  'metrics-timelines', 'charts-gauges', 'maps-geofences', 'feedback-all-states',
  'responsive-accessibility', 'real-page-adoption', 'distinct-rendered-identity',
] as const;

for (const mode of ['dark', 'light'] as const) {
  test(`hidden chart legends stay readable and reversible in ${mode}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const origin = testInfo.project.use.baseURL;
    if (typeof origin !== 'string') throw new Error('A running application origin is required');
    const preference = createReviewPreference();
    preference.pack_id = 'classic';
    preference.app_wide = true;
    const mocks = await installPackReview(page, mode, 390, false, [], true, preference, origin);
    await routeBuiltApplication(page, new URL(origin).origin, ['/command-history'], process.env.DESIGN_PACK_DIST_DIR);
    try {
      await page.goto('/command-history');
      await waitForHarnessReady(page, mocks);
      const legend = page.locator('button[data-chart-legend-label][data-series-key="success"]').first();
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await legend.scrollIntoViewIfNeeded();
        await expect(legend).toHaveAttribute('aria-pressed', 'false');
        await legend.click();
        await expect(legend).toHaveAttribute('aria-pressed', 'true');
        const appearance = await legend.evaluate(element => {
          const color = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
          const style = getComputedStyle(element);
          const foreground = color(style.color);
          let background: number[] = [];
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement) {
            const current = getComputedStyle(node);
            opacity *= Number(current.opacity);
            const candidate = color(current.backgroundColor);
            if (candidate.length >= 3 && (candidate.length === 3 || candidate[3] === 1)) {
              background = candidate;
              break;
            }
          }
          if (foreground.length < 3 || background.length < 3) throw new Error('Chart legend colors are unavailable');
          const blended = foreground.slice(0, 3).map((value, index) => value * opacity + background[index] * (1 - opacity));
          const luminance = (values: number[]) => values.map(value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
          const a = luminance(blended);
          const b = luminance(background.slice(0, 3));
          return {
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            decoration: style.textDecorationLine,
          };
        });
        expect(appearance.ratio, `${mode} ${width}px hidden legend contrast`).toBeGreaterThanOrEqual(4.5);
        expect(appearance.decoration).toContain('line-through');
        await legend.click();
        await expect(legend).toHaveAttribute('aria-pressed', 'false');
      }
      await assertMockApiComplete(page, mocks);
    } finally {
      await closeMockApiFixtures();
    }
  });
}

for (const mode of ['dark', 'light'] as const) {
  test(`Expressive Form phone headings have room for short titles in ${mode}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const origin = testInfo.project.use.baseURL;
    if (typeof origin !== 'string') throw new Error('A running application origin is required');
    const preference = createReviewPreference();
    preference.pack_id = 'v6';
    preference.app_wide = true;
    const mocks = await installPackReview(page, mode, 390, false, [], true, preference, origin);
    await installSpecializedReviewSources(page, mocks, mode);
    await routeBuiltApplication(page, new URL(origin).origin, ['/drives'], process.env.DESIGN_PACK_DIST_DIR);
    try {
      await page.goto('/drives');
      await waitForHarnessReady(page, mocks);
      await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'v6');
      const heading = page.getByRole('heading', { name: 'Drive history', exact: true });
      const help = page.getByRole('button', { name: 'More info: Drive history', exact: true });
      await expect(heading).toBeVisible();
      for (const forcedColors of ['none', 'active'] as const) {
        await page.emulateMedia({ forcedColors });
        for (const width of [360, 390, 430, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          for (const scale of [0.85, 1, 1.35]) {
            await page.evaluate(value => document.documentElement.style.setProperty('--font-scale', String(value)), scale);
            const geometry = await heading.evaluate(element => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const lines = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).length;
              const title = element.closest('[data-app-part~="page-title"]')?.getBoundingClientRect();
              const header = element.closest('[data-app-part~="page-header"]')?.getBoundingClientRect();
              const actions = element.closest('[data-app-part~="page-header"]')
                ?.querySelector('[data-app-part~="page-actions"]')?.getBoundingClientRect();
              if (!title || !header || !actions) throw new Error('Page heading geometry is missing');
              return {
                lines,
                titleWithinHeader: title.left >= header.left - 1 && title.right <= header.right + 1,
                actionsWithinHeader: actions.left >= header.left - 1 && actions.right <= header.right + 1,
                overlapping: title.left < actions.right - 1 && title.right > actions.left + 1
                  && title.top < actions.bottom - 1 && title.bottom > actions.top + 1,
                overflow: element.scrollWidth - element.clientWidth,
              };
            });
            const label = `${mode} ${forcedColors} ${width}px scale ${scale}`;
            if (scale === 1) expect(geometry.lines, `${label} title lines`).toBe(1);
            expect(geometry.titleWithinHeader, `${label} title containment`).toBe(true);
            expect(geometry.actionsWithinHeader, `${label} action containment`).toBe(true);
            expect(geometry.overlapping, `${label} overlapping actions`).toBe(false);
            expect(geometry.overflow, `${label} title overflow`).toBeLessThanOrEqual(1);
            if (width < 768) {
              const helpSize = await help.boundingBox();
              expect(helpSize && Math.min(helpSize.width, helpSize.height), `${label} help target`).toBeGreaterThanOrEqual(44);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${label} page overflow`).toBeLessThanOrEqual(1);
          }
        }
      }
      await page.emulateMedia({ forcedColors: 'none' });
      await page.setViewportSize({ width: 390, height: 900 });
      const container = page.locator('[data-app-part~="page"]').first();
      const header = page.locator('[data-app-part~="page-header"]').first();
      for (const presentation of ['report', 'kiosk']) {
        await container.evaluate((element, value) => element.setAttribute('data-presentation-mode', value), presentation);
        const titleMinimum = await header.evaluate(element =>
          getComputedStyle(element).getPropertyValue('--app-header-title-min-width').trim());
        expect(titleMinimum, `${mode} ${presentation} title token`).toBe('12rem');
      }
      await container.evaluate(element => element.removeAttribute('data-presentation-mode'));
      await assertMockApiComplete(page, mocks);
    } finally {
      await closeMockApiFixtures();
    }
  });
}

test('live application thumbnails remain isolated and usable on phones', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const origin = testInfo.project.use.baseURL;
  if (typeof origin !== 'string') throw new Error('A running application origin is required');
  const preference = createReviewPreference();
  preference.pack_id = 'v7';
  preference.app_wide = true;
  const mocks = await installPackReview(page, 'dark', 390, false, [], false, preference, origin, { chart_palette: 'neon' });
  await routeBuiltApplication(page, new URL(origin).origin, ['/settings'], process.env.DESIGN_PACK_DIST_DIR);
  try {
    await page.setViewportSize({ width: 360, height: 844 });
    await page.goto('/settings');
    await waitForHarnessReady(page, mocks);
    await page.getByRole('combobox', { name: 'Settings categories', exact: true }).selectOption('appearance');
    const gallery = page.locator('[aria-labelledby="settings-widget-design-packs"]');
    const thumbnails = gallery.locator('[data-app-design-thumbnail]');
    await expect(thumbnails).toHaveCount(PACK_IDS.length);
    await expect(gallery.getByRole('button', { name: 'Pixel Cockpit active' })).toBeDisabled();
    for (const width of [360, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await thumbnails.evaluateAll(elements => elements.map(element => {
        const panel = element.querySelector<HTMLElement>('[data-app-part~="panel"]');
        const value = panel?.querySelector<HTMLElement>('[data-app-part~="metric-value"]');
        const chart = element.querySelector<HTMLElement>('[data-app-part~="chart"]');
        const navigation = element.querySelector<HTMLElement>('[data-app-part~="navigation"]');
        const card = element.closest('section');
        return {
          id: element.getAttribute('data-app-design-thumbnail'),
          owner: panel?.getAttribute('data-app-design-owner'),
          radius: panel ? getComputedStyle(panel).borderTopLeftRadius : '',
          navigation: navigation ? getComputedStyle(navigation).flexDirection : '',
          chartWidth: chart?.getBoundingClientRect().width ?? 0,
          chartColor: chart?.querySelector('polyline')?.getAttribute('stroke'),
          bounds: value && panel ? {
            reading: value.getBoundingClientRect().toJSON(),
            panel: panel.getBoundingClientRect().toJSON(),
          } : null,
          valueFits: !!value && !!panel && (() => {
            const reading = value.getBoundingClientRect();
            const bounds = panel.getBoundingClientRect();
            return reading.width > 0 && reading.height > 0 && reading.right <= bounds.right + 1
              && reading.bottom <= bounds.bottom + 1;
          })(),
          stageHeight: element.getBoundingClientRect().height,
          cardOverflow: card ? card.scrollWidth - card.clientWidth : Infinity,
          targets: [...(card?.querySelectorAll('button') ?? [])].map(button => {
            const rect = button.getBoundingClientRect();
            return Math.min(rect.width, rect.height);
          }),
        };
      }));
      expect(geometry.map(item => item.id)).toEqual(PACK_IDS);
      expect(geometry.filter(item => !item.valueFits).map(({ id, bounds }) => ({ id, bounds })), `${width}px clipped values`).toEqual([]);
      for (const item of geometry) {
        expect(item.owner, `${width}px ${item.id}`).toContain(`pack-${item.id}`);
        expect(item.stageHeight, `${width}px ${item.id}`).toBe(256);
        expect(item.chartWidth, `${width}px ${item.id}`).toBeGreaterThan(0);
        expect(item.chartColor, `${width}px ${item.id}`).toBe(CHART_COLORS_NEON_DARK[0]);
        expect(item.cardOverflow, `${width}px ${item.id}`).toBeLessThanOrEqual(1);
        for (const target of item.targets) expect(target, `${width}px ${item.id}`).toBeGreaterThanOrEqual(44);
      }
      expect(geometry.find(item => item.id === 'v2')?.navigation).toBe('column');
      expect(geometry.find(item => item.id === 'v6')?.navigation).toBe('row');
      expect(geometry.find(item => item.id === 'v2')?.radius).not.toBe(geometry.find(item => item.id === 'v7')?.radius);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 430, height: 900 });
    await gallery.getByRole('button', { name: 'Use Cyberdeck pack' }).click();
    await expect(gallery.getByRole('button', { name: 'Cyberdeck active' })).toBeDisabled();
    expect(preference.pack_id).toBe('cyber');
    await waitForHarnessReady(page, mocks);
    await page.reload();
    await waitForHarnessReady(page, mocks);
    await page.getByRole('combobox', { name: 'Settings categories', exact: true }).selectOption('appearance');
    await expect(gallery.getByRole('button', { name: 'Cyberdeck active' })).toBeDisabled();
    await assertMockApiComplete(page, mocks);
  } finally {
    await closeMockApiFixtures();
  }
});

test('all pack dashboard layout names remain readable on phones', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const origin = testInfo.project.use.baseURL;
  if (typeof origin !== 'string') throw new Error('A running application origin is required');
  const preference = createReviewPreference();
  preference.app_wide = true;
  const mocks = await installPackReview(page, 'dark', 390, false,
    [['vehicle-twin', 'Digital Twin'], ['digital-twin-mini', 'Digital Twin Mini']], true, preference, origin);
  await routeBuiltApplication(page, new URL(origin).origin, ['/'], process.env.DESIGN_PACK_DIST_DIR);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitForHarnessReady(page, mocks);
    const trigger = page.getByRole('button', { name: 'Switch dashboard layout' });
    await expect(trigger).toBeVisible();
    const failures: string[] = [];
    for (const pack of PACK_IDS) {
      await selectReviewPack(page, pack);
      await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', pack);
      await expect(trigger).toHaveAttribute('data-app-design-owner', new RegExp(`(?:^|\\s)pack-${pack}(?:\\s|$)`));
      for (const width of [360, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        const geometry = await trigger.evaluate(button => {
          const caption = button.querySelector<HTMLElement>('[data-layout-switcher-caption]');
          const name = button.querySelector<HTMLElement>('[data-layout-switcher-name]');
          if (!caption || !name) throw new Error('Dashboard layout labels are missing');
          const range = document.createRange();
          range.selectNodeContents(caption);
          const lines = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).length;
          const bounds = button.getBoundingClientRect();
          return {
            caption: caption.textContent,
            captionLines: lines,
            name: name.textContent,
            nameClipped: name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight + 1,
            buttonWidth: bounds.width,
            buttonHeight: bounds.height,
            overflow: document.documentElement.scrollWidth - innerWidth,
          };
        });
        if (geometry.caption !== 'Layout' || geometry.captionLines !== 1
          || geometry.name !== 'Implementation review - synthetic data' || geometry.nameClipped
          || geometry.buttonWidth < 44 || geometry.buttonHeight < 44 || geometry.overflow > 1) {
          failures.push(`${pack} ${width}px: ${JSON.stringify(geometry)}`);
        }
      }
    }
    expect(failures).toEqual([]);
    await waitForHarnessReady(page, mocks);
    await assertMockApiComplete(page, mocks);
  } finally {
    await closeMockApiFixtures();
  }
});

test('energy chart fallback remains readable in phone forced colors', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const origin = testInfo.project.use.baseURL;
  if (typeof origin !== 'string') throw new Error('A running application origin is required');
  const preference = createReviewPreference();
  preference.pack_id = 'observatory';
  preference.app_wide = true;
  const mocks = await installPackReview(page, 'dark', 390, false, [], false, preference, origin);
  await routeBuiltApplication(page, new URL(origin).origin, ['/energy'], process.env.DESIGN_PACK_DIST_DIR);
  try {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/energy');
    await waitForHarnessReady(page, mocks);
    const table = page.getByRole('table', { name: 'Charger type breakdown — data table' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveCount(6);
    await expect(table.getByRole('cell').first()).toBeVisible();
    const headings = await table.getByRole('columnheader').allTextContents();
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const geometry = await table.evaluate(element => {
        const scroll = element.closest('[data-table-variant="embedded"]')?.firstElementChild;
        if (!(scroll instanceof HTMLElement)) throw new Error('Chart fallback scroll container missing');
        return {
          overflow: scroll.scrollWidth - scroll.clientWidth,
          cells: [...element.querySelectorAll('tbody tr:first-child td')].map(cell => ({
            label: cell.getAttribute('data-mobile-label'),
            visibleLabel: getComputedStyle(cell, '::before').content,
            labelSize: parseFloat(getComputedStyle(cell, '::before').fontSize),
            valueSize: parseFloat(getComputedStyle(cell).fontSize),
          })),
        };
      });
      expect(geometry.overflow, `${width}px`).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${width}px document`).toBeLessThanOrEqual(1);
      expect(geometry.cells.map(cell => cell.label)).toEqual(headings);
      for (const [index, cell] of geometry.cells.entries()) {
        expect(cell.visibleLabel).toContain(headings[index]);
        expect(cell.labelSize).toBeGreaterThanOrEqual(16);
        expect(cell.valueSize).toBeGreaterThanOrEqual(16);
      }
    }
    await assertMockApiComplete(page, mocks);
  } finally {
    await closeMockApiFixtures();
  }
});

test.describe('saved appearance startup', () => {
  test.use({ serviceWorkers: 'block' });

  test('applies the verified pack before the shell appears and persists on reload', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const baseURL = testInfo.project.use.baseURL;
    if (!baseURL) throw new Error('A running application origin is required');
    const origin = new URL(baseURL).origin;
    const dist = process.env.DESIGN_PACK_DIST_DIR
      ? resolve(process.env.DESIGN_PACK_DIST_DIR)
      : resolve('e2e', '.app-dist');
    const preference = createReviewPreference();
    preference.pack_id = 'v7';
    preference.app_wide = true;
    const mocks = await installPackReview(page, 'dark', 390, false,
      [['vehicle-hero', 'Vehicle card'], ['battery-gauge', 'Battery']], false, preference, origin);

    await routeBuiltApplication(page, origin, ['/'], dist);

    let release!: () => void;
    const gate = new Promise<void>(resolveGate => { release = resolveGate; });
    let reads = 0;
    await page.route('**/api/v1/settings/widget-design-pack', async route => {
      if (route.request().method() !== 'GET' || new URL(route.request().url()).search) {
        mocks.unmatched.add(`${route.request().method()} /settings/widget-design-pack`);
        return fulfillApiFixture(route, mocks, { status: 599, json: { error: 'Unexpected design preference request' } });
      }
      reads++;
      await gate;
      await fulfillApiFixture(route, mocks, { json: preference });
    });
    await page.addInitScript(() => {
      const state = { flashes: 0 };
      Object.assign(window, { __appearanceCheck: state });
      const check = () => {
        if (document.querySelector('[data-app-part~="shell"]')
          && document.documentElement.getAttribute('data-app-design-pack') !== 'v7') state.flashes++;
      };
      new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true });
    });
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => reads).toBeGreaterThan(0);
      await expect(page.getByTestId('page-load-skeleton')).toBeVisible();
      await expect(page.locator('[data-app-part~="shell"]')).toHaveCount(0);
      release();
      await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'v7');
      await expect(page.locator('[data-app-part~="shell"]')).toBeVisible();
      await expect(page.locator('[data-vehicle-hero-pack="v7"]')).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __appearanceCheck: { flashes: number } }).__appearanceCheck.flashes)).toBe(0);
      await waitForHarnessReady(page, mocks);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'v7');
      await expect(page.locator('[data-vehicle-hero-pack="v7"]')).toBeVisible();
      expect(reads).toBeGreaterThan(1);
      expect(await page.evaluate(() => (window as unknown as { __appearanceCheck: { flashes: number } }).__appearanceCheck.flashes)).toBe(0);
      await waitForHarnessReady(page, mocks);
      await assertMockApiComplete(page, mocks);
    } finally {
      release();
      await closeMockApiFixtures();
    }
  });
});

async function auditPreview(page: Page, testInfo: TestInfo, file: string) {
  const results = await new AxeBuilder({ page })
    .include('[data-preview-synthetic="true"]')
    .options({ rules: { 'target-size': { enabled: true } } })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  await testInfo.attach(file, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results.violations, 'the real preview has no waived WCAG 2.2 AA violations').toEqual([]);
}

async function inspectRetainedAndNativeControls(preview: Locator) {
  const retained = preview.locator('[data-preview-state="retained-error"]');
  await expect(retained.getByRole('definition').nth(0)).toHaveText('0');
  await expect(retained.getByRole('definition').nth(1)).toHaveText('—');
  const before = await compositionGeometry(retained);
  await retained.getByRole('button', { name: 'Retry retained example', exact: true }).click();
  const recovered = preview.locator('[data-preview-state="retained-recovery"]');
  await expect(recovered.getByText('Sample refresh recovered', { exact: true })).toBeVisible();
  await expect(recovered.getByRole('definition').nth(0)).toHaveText('0');
  await expect(recovered.getByRole('definition').nth(1)).toHaveText('—');
  const recovery = await compositionGeometry(recovered);
  await recovered.getByRole('button', { name: 'Show refresh failure again', exact: true }).click();
  await expect(retained).toBeVisible();
  const form = preview.locator('[data-preview-section="form"]');
  await expect(form.getByRole('checkbox', { name: 'Mixed selection example' })).toHaveJSProperty('indeterminate', true);
  await expect(form.getByRole('switch', { name: 'Live connection disabled' })).toBeDisabled();
  const slider = form.getByRole('slider', { name: 'Sample review threshold' });
  await slider.focus();
  await slider.press('Home');
  await expect(slider).toHaveValue('0');
  await expect(slider).toHaveAttribute('aria-valuetext', '0%');
  await slider.press('End');
  await expect(slider).toHaveValue('100');
  await expect(slider).toHaveAttribute('aria-valuetext', '100%');
  await slider.press('ArrowLeft');
  await expect(slider).toHaveValue('99');
  const select = form.getByRole('combobox', { name: 'Sample layout' });
  await expect(select).toHaveAttribute('data-app-native-popup', 'true');
  await select.selectOption('summary');
  await select.focus();
  await select.press('ArrowDown');
  await select.press('Enter');
  await expect(select).toHaveValue('detail');
  await form.getByRole('textbox', { name: 'Local review notes' }).fill('Synthetic local notes — not persisted');
  const search = preview.getByRole('searchbox', { name: 'Search loaded rows' });
  await search.fill('No matching synthetic journey');
  await expect(preview.getByText('No sample journeys match.', { exact: true })).toBeVisible();
  await assertTableNoMatchContained(preview.locator('[data-preview-section="table"]'));
  await search.fill('');
  await expect(preview.getByRole('table', { name: 'Sample journey ledger' }).getByRole('row')).toHaveCount(4);
  const chart = preview.locator('[data-preview-section="chart"]');
  const fallback = chart.getByRole('table', { name: 'Sample battery trace — data table', includeHidden: true });
  await expect(fallback.getByRole('row', { includeHidden: true })).toHaveCount(8);
  const gap = fallback.getByRole('row', { includeHidden: true }).filter({ hasText: /^15/ });
  await expect(gap.getByRole('cell', { includeHidden: true }).nth(1)).toHaveText('—');
  const gauge = chart.getByRole('meter', { name: 'Sample battery level', exact: true });
  await expect(gauge).toHaveAttribute('aria-valuenow', '72');
  await expect(gauge).toHaveAttribute('aria-valuemin', '0');
  await expect(gauge).toHaveAttribute('aria-valuemax', '100');
  const quantitative = await gauge.evaluate(element => {
    const track = element.querySelector('[data-chart-gauge-track]')!.getBoundingClientRect();
    const fill = element.querySelector('[data-chart-gauge-fill]')!.getBoundingClientRect();
    const marker = element.querySelector('[data-chart-gauge-marker]')!.getBoundingClientRect();
    return { ratio: fill.width / track.width, marker: (marker.left + marker.width / 2 - track.left) / track.width };
  });
  expect(quantitative.ratio).toBeCloseTo(0.72, 2);
  expect(quantitative.marker).toBeCloseTo(0.8, 2);
  const navigation = preview.getByRole('navigation', { name: 'Sandbox navigation' });
  for (const [label, text] of [
    ['Activity', 'Five sample journeys are complete; one has an unavailable energy reading. Unknown is never shown as zero.'],
    ['Review', 'Review the partial journey before comparing totals. These examples do not describe the health of your vehicle.'],
    ['Overview', 'A useful overview keeps totals, source quality and the next review step together.'],
  ]) {
    await navigation.getByRole('button', { name: label, exact: true }).click();
    await expect(navigation.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(preview.getByText(text, { exact: true })).toBeVisible();
  }
  // The actual Leaflet vectors, not their data markers, must respond to zoom.
  const map = preview.locator('[data-preview-section="map"]');
  const closePopup = map.locator('.leaflet-popup-close-button');
  if (await closePopup.isVisible()) await closePopup.click();
  await map.getByRole('button', { name: 'Reset map', exact: true }).click();
  const route = map.locator('.leaflet-overlay-pane path[fill="none"]');
  await expect(route).toHaveCount(1);
  const measureRoute = () => route.evaluate(element => {
    const container = element.closest('.leaflet-container');
    if (!(element instanceof SVGPathElement) || !container) throw new Error('Native route SVG or map missing');
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('Native route projection missing');
    const frame = container.getBoundingClientRect();
    // Measure the projected centerline: Firefox includes the fixed-width stroke in client bounds.
    const bounds = element.getBBox();
    const length = element.getTotalLength();
    return {
      width: Math.abs(matrix.a * bounds.width) + Math.abs(matrix.c * bounds.height),
      height: Math.abs(matrix.b * bounds.width) + Math.abs(matrix.d * bounds.height),
      points: Array.from({ length: 5 }, (_, index) => {
        const point = element.getPointAtLength(length * index / 4).matrixTransform(matrix);
        return { x: point.x - frame.left, y: point.y - frame.top };
      }),
    };
  });
  const beforeZoom = await route.getAttribute('d');
  expect(beforeZoom).toBeTruthy();
  const originalRoute = await measureRoute();
  expect(originalRoute.width).toBeGreaterThan(0);
  expect(originalRoute.height).toBeGreaterThan(0);
  await map.getByRole('button', { name: 'Zoom sample map in', exact: true }).click();
  await expect(route).not.toHaveAttribute('d', beforeZoom!);
  await expect.poll(async () => {
    const zoomed = await measureRoute();
    return Math.max(Math.abs(zoomed.width - originalRoute.width * 2), Math.abs(zoomed.height - originalRoute.height * 2));
  }, { message: 'native zoom doubles both rendered route dimensions within SVG pixel rounding' }).toBeLessThanOrEqual(2);
  await map.getByRole('button', { name: 'Reset map', exact: true }).click();
  // Compare rendered positions: Leaflet truncates pan offsets and rounds SVG origins.
  await expect.poll(async () => {
    const reset = await measureRoute();
    return Math.max(...reset.points.flatMap((point, index) => [
      Math.abs(point.x - originalRoute.points[index]!.x), Math.abs(point.y - originalRoute.points[index]!.y),
    ]));
  }, { message: 'reset restores all five rendered route samples within native two-pixel pan/projection rounding' }).toBeLessThanOrEqual(2);
  return { retainedError: before, retainedRecovery: recovery, quantitative };
}

async function inspectIncompletePreview(page: Page, preview: Locator) {
  const settlePointer = async (host: Locator) => {
    await page.mouse.move(0, 0);
    await host.evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true })
        .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map(animation => animation.finished.catch(() => {})));
    });
  };
  await preview.evaluate(element => element.removeAttribute('data-app-data'));
  await expect(preview).not.toHaveAttribute('data-app-design-owner');
  await expect(preview.locator('[data-app-design-owner]')).toHaveCount(0);
  await expect.poll(() => preview.locator('[data-app-part~="feedback-copy"]').evaluateAll(nodes =>
    nodes.length > 0 && nodes.every(node => {
      const parent = node.parentElement;
      return parent !== null && getComputedStyle(node).color === getComputedStyle(parent).color;
    })),
  { message: 'neutral feedback wrappers settle inherited text color after owner removal' }).toBe(true);
  await settlePointer(preview);
  const inline = await isolationAppearance(preview);
  const portals: Record<string, unknown> = {};
  for (const [trigger, name] of [
    ['Preview help', 'Preview help'], ['Inspect sample journey', 'Synthetic journey details'],
    ['Source quality filter', 'Source quality filter'],
  ]) {
    await preview.getByRole('button', { name: trigger, exact: true }).click();
    const portal = page.getByRole('dialog', { name, exact: true });
    await expect(portal).toBeVisible();
    expect(await portal.evaluate((element, attributes) => {
      const boundary = element.closest('[data-app-design-preview]');
      return {
        neutralBoundary: boundary !== null && attributes.every(attribute => !boundary.hasAttribute(attribute)),
        ownedTargets: element.querySelectorAll('[data-app-design-owner]').length,
        owned: element.hasAttribute('data-app-design-owner'),
      };
    }, profileAttributes)).toEqual({ neutralBoundary: true, ownedTargets: 0, owned: false });
    await settlePointer(portal);
    portals[name] = await isolationAppearance(portal);
    if (trigger === 'Preview help') await portal.getByRole('button', { name: 'Dismiss help' }).click();
    else if (trigger === 'Source quality filter') await portal.getByRole('button', { name: 'Done', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(portal).toBeHidden();
  }
  await preview.evaluate((element, value) => element.setAttribute('data-app-data', value), getAppDesignAttributes('quiet')['data-app-data']);
  await assertOwnerGuardActivation(preview);
  return { inline, portals };
}

async function inspectGeofenceRoute(page: Page, packId: PackId, info: TestInfo) {
  const open = page.getByRole('button', { name: 'Add geofence', exact: true }).first();
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Create geofence', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${packId}(?:\\s|$)`));
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  await dialog.getByRole('tab', { name: 'Draw on map', exact: true }).click();
  const map = dialog.getByRole('application', { name: 'Geofence drawing map' });
  await map.scrollIntoViewIfNeeded();
  const toolbar = map.locator('[data-map-control="geofence"]');
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${packId}(?:\\s|$)`));
  await toolbar.locator('.leaflet-draw-draw-circle').click();
  const box = await map.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Actual geofence map has no rendered viewport');
  const start = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.55 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + Math.min(35, box.width * 0.15), start.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect(dialog.getByRole('spinbutton', { name: 'Latitude', exact: true })).not.toHaveValue('');
  await expect(dialog.getByRole('spinbutton', { name: 'Longitude', exact: true })).not.toHaveValue('');
  expect(Number(await dialog.getByRole('spinbutton', { name: 'Radius (meters)', exact: true }).inputValue())).toBeGreaterThan(10);
  const geometry = await map.locator('.leaflet-overlay-pane path').evaluateAll(nodes => nodes.map(node => {
    const box = (node as SVGPathElement).getBBox();
    return { width: box.width, height: box.height, length: (node as SVGPathElement).getTotalLength() };
  }));
  expect(geometry.some(shape => shape.width > 5 && shape.height > 5 && shape.length > 10),
    'the existing native draw plugin creates real editable geometry').toBe(true);
  const composition = await compositionGeometry(dialog);
  await assertContained(dialog, 'actual geofence editor');
  await dialog.screenshot({ path: info.outputPath(`${packId}-geofence-local-draft.png`), animations: 'disabled' });
  // Never save/create a geofence or request browser/vehicle location.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Unsaved changes', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  return { composition, geometry };
}

async function appearance(page: Page, width: number) {
  if (width < 1024) {
    await page.getByRole('combobox', { name: 'Settings categories', exact: true }).selectOption('appearance');
  } else {
    await page.getByRole('navigation', { name: 'Settings categories', exact: true })
      .getByRole('button', { name: /Appearance & experience/ }).click();
  }
  return page.locator('[aria-labelledby="settings-widget-design-packs"]');
}

async function preservedPreferences(page: Page) {
  return page.evaluate(keys => ({
    storage: Object.fromEntries(Object.entries(localStorage)),
    density: document.body.getAttribute('data-density'),
    variables: Object.fromEntries(keys.map(key => [key, getComputedStyle(document.documentElement).getPropertyValue(key)])),
  }), preservedVariables);
}

async function expectProfile(page: Page, packId: PackId) {
  for (const [attribute, value] of Object.entries(getAppDesignAttributes(packId))) {
    await expect(page.locator('html')).toHaveAttribute(attribute, value);
  }
  await expect(page.locator('html')).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${packId}(?:\\s|$)`));
}

async function expectNeutral(page: Page, noLocalScopes = false) {
  for (const attribute of profileAttributes) await expect(page.locator('html')).not.toHaveAttribute(attribute);
  await expect(page.locator('html')).not.toHaveAttribute('data-app-design-owner');
  if (noLocalScopes) {
    for (const attribute of [...profileAttributes, 'data-app-design-owner']) {
      await expect(unexpectedNeutralScopes(page, attribute), `neutral document retains no ${attribute} on stale local/portal targets`).toHaveCount(0);
    }
  }
}

test.afterAll(async () => { await closeMockApiFixtures(); });

test('Replay legend restoration survives seek persistence across application designs', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const saved = createReviewPreference();
  saved.app_wide = true;
  const mocks = await installPackReview(page, 'dark', 1440, false, [], false, saved,
    testInfo.project.use.baseURL);
  const sources = await installSpecializedReviewSources(page, mocks, 'dark');
  await page.addInitScript(() => localStorage.setItem('teslasync:low-bandwidth:v1', 'on'));
  const path = '/drives/412/replay';
  await page.goto(path);
  await waitForHarnessReady(page, mocks);
  for (const packId of packIds) {
    await test.step(`${packId} restored curves survive queued seek writes`, async () => {
      await selectReviewPack(page, packId);
      await expectProfile(page, packId);
      await inspectSpecializedRoute(page, path, packId, testInfo, sources,
        { temperature: 'C', distance: 'km' });
      await expect(page.getByRole('group', {
        name: 'Trip replay speed and power timeline area chart', exact: true,
      }).locator('.recharts-area-curve')).toHaveCount(2);
      expect(new URL(page.url()).searchParams.get('hidden_trip-replay-speed-power')).toBeNull();
    });
  }
  expect(failures).toEqual([]);
  expect(mocks.requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    && !['/api/v1/settings/widget-design-pack', '/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path))).toEqual([]);
  await assertMockApiComplete(page, mocks);
});

type MainPhase =
  | { kind: 'route'; label: string; path: string }
  | { kind: 'interactions' | 'native' | 'accessibility' | 'isolation'; label: string }
  | { kind: 'responsive'; label: string; allocatedWidth: number };

function mainPhases(width: number): MainPhase[] {
  const widths = width === 390 ? [320, 375, 390, 430] : [768, 1024, 1280, 1440, 1920, 2560];
  return [
    ...['/', '/drives', ...specializedReviewRoutes, '/geofences', '/settings'].map(path => ({
      kind: 'route' as const, label: `real-route ${path}`, path,
    })),
    { kind: 'interactions', label: 'core interactions' },
    { kind: 'native', label: 'core native-retained-quantitative' },
    { kind: 'accessibility', label: 'core accessibility-media-screens' },
    ...widths.map(allocatedWidth => ({
      kind: 'responsive' as const, label: `responsive ${allocatedWidth}px`, allocatedWidth,
    })),
    { kind: 'isolation', label: 'mixed-pack isolation' },
  ];
}

// Later phases enter the same selected form/table state through real controls.
// The exhaustive transitions and their assertions remain in the interaction phase.
async function prepareMainInteractionState(preview: Locator) {
  const form = preview.locator('[data-preview-section="form"]');
  await form.getByRole('textbox', { name: /Sample view name/ }).fill('Local review');
  await form.getByRole('combobox', { name: 'Sample layout' }).selectOption('detail');
  for (const choice of [
    form.getByRole('radio', { name: 'Include partial examples' }),
    form.getByRole('checkbox', { name: 'Show source quality', exact: true }),
  ]) {
    const id = await choice.getAttribute('id');
    expect(id, 'phase preparation uses the real associated native choice label').toBeTruthy();
    await preview.page().locator(`label[for=${JSON.stringify(id)}]`).click();
  }
  await form.getByRole('switch', { name: 'Show comparison context' }).click();
  await form.getByRole('button', { name: 'Apply locally' }).click();
  const distance = preview.getByRole('table', { name: 'Sample journey ledger' })
    .getByRole('button', { name: 'Distance', exact: true });
  await distance.click();
  await distance.click();
}

async function prepareMainNativeState(preview: Locator) {
  const form = preview.locator('[data-preview-section="form"]');
  await form.getByRole('textbox', { name: 'Local review notes' }).fill('Synthetic local notes — not persisted');
  const slider = form.getByRole('slider', { name: 'Sample review threshold' });
  await slider.focus();
  await slider.press('Home');
  await slider.press('End');
  await slider.press('ArrowLeft');
  await preview.locator('[data-preview-section="map"]').getByRole('button', { name: 'Reset map', exact: true }).click();
}

// A phase owns one complete 27-pack route or allocated-width identity family.
// Separate core state machines prevent cumulative work from consuming the
// unchanged 30-minute cap before later packs are reached.
for (const theme of ['dark', 'light', 'custom'] as const) {
  for (const { width, phase } of [1440, 390].flatMap(width => mainPhases(width).map(phase => ({ width, phase })))) {
    test(`Application design languages at ${width}px in ${theme} — phase ${phase.label}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const workspaceHeader = page.getByRole('banner', {
        name: width < 1280 ? 'Site header' : 'Workspace command bar', exact: true,
      });
      const mode = theme === 'custom' ? 'dark' : theme;
      const reviewUnits = {
        temperature: theme === 'custom' ? 'F' : 'C', distance: theme === 'custom' ? 'mi' : 'km',
      } as const;
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: mode });
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      const saved = createReviewPreference();
      const mocks = await installPackReview(page, mode, width, false,
        [['vehicle-hero', 'Vehicle card'], ['battery-gauge', 'Battery'], ['speed-heatmap', 'Speed heatmap']], false, saved,
        testInfo.project.use.baseURL, theme === 'custom' ? {
          theme: 'custom', custom_primary: '#9c6ade', custom_accent: '#c0842b',
          font_family: 'custom', font_custom_sans: 'Georgia', font_mono: 'custom', font_custom_mono: 'Consolas',
          font_scale: 1.15, font_leading: 1.75, font_tracking: '0.015em', font_heading_weight: 600,
          unit_of_length: 'mi', unit_of_temp: 'F', unit_of_pressure: 'psi', chart_palette: 'neon',
        } : {});
      await installGeofenceReviewSources(page, mocks);
      const specializedSources = await installSpecializedReviewSources(page, mocks, mode);
      const energySources = await installEnergyReviewSources(page, mocks);
      // Real persisted data-saver preference, seeded only inside the isolated
      // browser context. Preview must preserve it and still render local SVG.
      await page.addInitScript(() => localStorage.setItem('teslasync:low-bandwidth:v1', 'on'));
      const neutralBefore: Record<string, unknown> = {};
      // Match the final client-navigation baseline after Layout applies the independent appearance preferences.
      await page.goto('/settings');
      await waitForHarnessReady(page, mocks);
      for (const publicPath of publicPaths) {
        await page.evaluate(path => {
          history.pushState(null, '', path);
          dispatchEvent(new PopStateEvent('popstate'));
        }, publicPath);
        await waitForHarnessReady(page, mocks);
        await expectNeutral(page, true);
        neutralBefore[publicPath] = await isolationAppearance(page.locator('body'));
      }
      await page.goto('/settings');
      await waitForHarnessReady(page, mocks);
      let picker = await appearance(page, width);
      await expect(picker.getByRole('button', { name: 'Classic active', exact: true })).toBeDisabled();
      await expectNeutral(page, true);
      const preferences = await preservedPreferences(page);
      if (theme === 'custom') {
        expect(preferences.variables['--theme-accent'].trim()).toBe('#9c6ade');
        expect(preferences.variables['--font-scale'].trim()).toBe('1.15');
        expect(preferences.variables['--leading'].trim()).toBe('1.75');
        expect(preferences.variables['--font-sans']).toContain('Georgia');
      }
      await picker.getByRole('combobox', { name: 'Apply design to', exact: true }).selectOption('app');
      await expectProfile(page, 'classic');
      expect(packIds, 'every Main phase retains all 27 application designs').toHaveLength(27);
      const profile = `Application design languages at ${width}px in ${theme}`;
      const scope = {
        project: testInfo.project.name, profile, theme, profileWidth: width,
        allocatedWidth: phase.kind === 'responsive' ? phase.allocatedWidth : width,
        phase: phase.label,
      };
      const familyEvidence: {
        scope: typeof scope & { pack: PackId; family: typeof acceptanceFamilies[number]; route: string; state: string; outerPack?: PackId };
        status: 'observed-not-certified'; evidence: unknown;
      }[] = [];
      const observe = (
        pack: PackId, family: typeof acceptanceFamilies[number], evidence: unknown,
        state = 'default', outerPack?: PackId, allocatedWidth = scope.allocatedWidth,
      ) => {
        familyEvidence.push({
          scope: { ...scope, allocatedWidth, pack, family, route: phase.kind === 'route' ? phase.path : '/settings', state,
            ...(outerPack ? { outerPack } : {}) },
          status: 'observed-not-certified', evidence,
        });
      };
      const routeEvidence: Record<string, unknown> = {};
      const routeCollisions: Record<string, PackId[][]> = {};
      for (const path of phase.kind === 'route' ? [phase.path] : []) {
        energySources.setActive(path === energyReviewPath);
        const routeSignatures = new Map<string, PackId[]>();
        await page.goto(path);
        await waitForHarnessReady(page, mocks);
        for (const packId of packIds) {
          await test.step(`${packId} real ${path}`, async () => {
            await selectReviewPack(page, packId);
            await expectProfile(page, packId);
            await expect(workspaceHeader).toBeVisible();
            await expect(page.locator('[data-app-part~="page"]').first()).toBeVisible();
            if (path === '/') {
              await expect(page.locator('[data-vehicle-studio]')).toBeVisible();
              await expect(page.locator('[data-widget-id="pack-review-battery-gauge"]')).toBeVisible();
            }
            if (path === '/drives') {
              const evidence = page.getByRole('region', { name: 'Drive list', exact: true });
              if (width >= 1024) await expect(evidence.getByRole('table')).toBeVisible();
              else {
                const previews = evidence.getByRole('button', { name: 'Quick view drive', exact: true });
                await expect(previews).toHaveCount(specializedDrives.length);
                await expect(previews.first()).toBeVisible();
              }
              await expect(page.locator('main')).toContainText(/drive|journey/i);
            }
            const specialized = path === '/geofences'
              ? await inspectGeofenceRoute(page, packId, testInfo)
              : path === energyReviewPath
                ? await inspectEnergyReview(page, packId, testInfo, energySources, false, reviewUnits.distance)
                : await inspectSpecializedRoute(page, path, packId, testInfo, specializedSources, reviewUnits);
            await assertContained(page.locator('html'), `${packId} ${path}`);
            const geometry = { composition: await compositionGeometry(page.locator('body')), specialized };
            routeEvidence[`${path}:${packId}`] = geometry;
            observe(packId, 'real-page-adoption', geometry);
            observe(packId, 'distinct-rendered-identity', geometry);
            if (path === '/geofences') observe(packId, 'maps-geofences', specialized, 'local-geofence-draft');
            const signature = JSON.stringify(geometry);
            routeSignatures.set(signature, [...(routeSignatures.get(signature) ?? []), packId]);
            await page.screenshot({ path: testInfo.outputPath(`${packId}-${path === '/' ? 'dashboard' : path.slice(1).replace(/\W+/g, '-')}.png`), animations: 'disabled' });
          });
        }
        routeCollisions[path] = [...routeSignatures.values()].filter(group => group.length > 1);
        await testInfo.attach(`identity-collisions-${path === '/' ? 'dashboard' : path.slice(1).replace(/\W+/g, '-')}.json`, {
          body: JSON.stringify(routeCollisions[path], null, 2), contentType: 'application/json',
        });
        expect.soft(routeSignatures.size, `EXACTLY 27 real ${path} layouts at ${width}px/${theme}`).toBe(27);
      }
      if (phase.kind === 'route' && phase.path !== '/settings') {
        energySources.setActive(false);
        await page.goto('/settings');
        await waitForHarnessReady(page, mocks);
      }
      picker = await appearance(page, width);
      // Widget-only mode lets every dialog prove local scoping independently of
      // the document root; selection stays unchanged while previewing all packs.
      await picker.getByRole('combobox', { name: 'Apply design to', exact: true }).selectOption('widgets');
      await expectNeutral(page, true);
      const beforePreview = await preservedPreferences(page);
      const beforePreviewUrl = page.url();
      expect(beforePreview.storage['teslasync:low-bandwidth:v1']).toBe('on');
      const savedBeforePreview = { ...saved };
      const requestStart = mocks.requests.length;
      const widths = phase.kind === 'responsive' ? [phase.allocatedWidth] : [];
      const signatures = new Map<number, Map<string, PackId[]>>(widths.map(value => [value, new Map()]));
      const geometryEvidence: Record<string, unknown> = {};
      for (const packId of phase.kind === 'route' || phase.kind === 'isolation' ? [] : packIds) {
        await test.step(`${packId} synthetic preview — ${phase.label}`, async () => {
          await page.setViewportSize({ width, height: 1000 });
          const opener = picker.getByRole('button', { name: `Preview ${packNames[packId]}`, exact: true });
          await opener.click();
          const dialog = page.getByRole('dialog', { name: `Preview ${packNames[packId]}`, exact: true });
          const preview = dialog.locator('[data-preview-synthetic="true"]');
          await expect(preview).toBeVisible();
          await expect(dialog.getByText('Loading preview...', { exact: true })).toHaveCount(0);
          for (const [attribute, value] of Object.entries(getAppDesignAttributes(packId))) {
            await expect(preview).toHaveAttribute(attribute, value);
          }
          await expectNeutral(page);
          const requestsBefore = mocks.requests.length;
          await assertPlotAndMap(preview);
          const animations = await preview.evaluate(element => element.getAnimations({ subtree: true })
            .filter(animation => animation.playState === 'running')
            .map(animation => Number(animation.effect?.getTiming().duration ?? 0)));
          expect(animations.every(duration => duration <= 1), 'reduced-motion sandbox has no running decorative animations').toBe(true);
          await expect(preview.locator('[data-widget-pack-preview] [data-widget-pack][data-surface-variant="standalone"]')).toHaveCount(5);
          const image = preview.locator('[data-vehicle-studio] img').first();
          await expect(image).toBeVisible();
          await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
          for (const action of ['Unlock', 'Climate', 'Flash lights']) {
            await expect(preview.getByRole('button', { name: action, exact: true })).toBeDisabled();
          }
          if (phase.kind === 'interactions') {
            await inspectPreviewInteractions(page, preview, testInfo, packId);
            observe(packId, 'controls-forms', await compositionGeometry(preview.locator('[data-preview-section="form"]')), 'selected-applied');
            observe(packId, 'tables-lists', await compositionGeometry(preview.locator('[data-preview-section="table"]')), 'sort-page-filter-recovered');
            observe(packId, 'charts-gauges', await compositionGeometry(preview.locator('[data-preview-section="chart"]')), 'legend-restored-tooltip-checked');
            observe(packId, 'maps-geofences', await compositionGeometry(preview.locator('[data-preview-section="map"]')), 'popup-route-zoom-reset');
            observe(packId, 'feedback-all-states', await compositionGeometry(preview.locator('[data-preview-section="feedback"]')), 'retried-error-restored');
          } else {
            await prepareMainInteractionState(preview);
          }
          if (phase.kind === 'native') {
            const nativeAndRetained = await inspectRetainedAndNativeControls(preview);
            observe(packId, 'controls-forms', await compositionGeometry(preview.locator('[data-preview-section="form"]')), 'native-keyboard-endpoints');
            observe(packId, 'shell-navigation', await compositionGeometry(preview.locator('[data-app-part~="shell"]')), 'activity-review-overview');
            observe(packId, 'tables-lists', await compositionGeometry(preview.locator('[data-preview-section="table"]')), 'no-match-restored');
            observe(packId, 'charts-gauges', {
              composition: await compositionGeometry(preview.locator('[data-preview-section="chart"]')),
              quantitative: nativeAndRetained.quantitative,
            }, 'quantitative-gap-fallback');
            observe(packId, 'maps-geofences', await compositionGeometry(preview.locator('[data-preview-section="map"]')), 'native-projection-zoom-reset');
            observe(packId, 'feedback-all-states', {
              composition: await compositionGeometry(preview.locator('[data-preview-section="feedback"]')),
              retained: nativeAndRetained,
            }, 'retained-error-recovery-restored');
          } else if (phase.kind !== 'interactions') {
            await prepareMainNativeState(preview);
          }
          if (phase.kind === 'accessibility') await auditPreview(page, testInfo, `${packId}-axe-preview.json`);
          for (const allocatedWidth of widths) {
            await page.setViewportSize({ width: allocatedWidth, height: 1000 });
            await preview.locator('[data-preview-section="map"]').scrollIntoViewIfNeeded();
            await expect.poll(() => preview.locator('.leaflet-container').evaluate(element => element.clientWidth)).toBeGreaterThan(80);
            await assertContained(dialog, `${packId} ${allocatedWidth} dialog`);
            await assertContained(preview, `${packId} ${allocatedWidth} preview`);
            await assertNavigationTextContained(preview, `${packId} ${allocatedWidth} preview`);
            await assertPlotAndMap(preview);
            const composition = await compositionGeometry(preview);
            const nested = await inspectNestedDialog(page, preview, allocatedWidth === width
              ? { testInfo, file: `${packId}-nested-dialog.png` } : undefined);
            const signature = JSON.stringify({ composition, nested });
            const cluster = signatures.get(allocatedWidth)!;
            cluster.set(signature, [...(cluster.get(signature) ?? []), packId]);
            geometryEvidence[`${packId}:${allocatedWidth}:default`] = { composition, nested };
            observe(packId, 'distinct-rendered-identity', { composition, nested });
            observe(packId, 'dialogs-popovers', { composition, nested });
            observe(packId, 'responsive-accessibility', { composition, nested });
            const savedTextContext = await page.locator('html').evaluate(element => ({
              scale: element.style.getPropertyValue('--font-scale'),
              dir: element.getAttribute('dir'),
            }));
            const original = await preview.evaluate(element => {
              const labels = [...element.querySelectorAll<HTMLElement>('[data-app-part~="nav-item"], [data-app-part~="page-title"]')];
              const old = labels.map(label => {
                const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
                let node: Node | null;
                while ((node = walker.nextNode())) {
                  if (node.nodeValue?.trim()) {
                    const text = node.nodeValue;
                    node.nodeValue = 'مساحة عمل تجريبية — Extended local workspace review and source quality';
                    return text;
                  }
                }
                return null;
              });
              element.setAttribute('dir', 'rtl');
              return old;
            });
            await page.locator('html').evaluate(element => element.setAttribute('dir', 'rtl'));
            for (const density of ['compact', 'spacious']) {
              await page.locator('body').evaluate((element, value) => element.setAttribute('data-density', value), density);
              await page.locator('html').evaluate(element => element.style.setProperty('--font-scale', '1'));
              const normalFont = await preview.getByRole('textbox', { name: /Sample view name/ })
                .evaluate(element => parseFloat(getComputedStyle(element).fontSize));
              await page.locator('html').evaluate(element => element.style.setProperty('--font-scale', '2'));
              await assertContained(dialog, `${packId} ${allocatedWidth} RTL 200% ${density}`);
              await assertContained(preview, `${packId} ${allocatedWidth} RTL 200% ${density}`);
              await assertNavigationTextContained(preview, `${packId} ${allocatedWidth} RTL 200% ${density}`);
              const enlargedFont = await preview.getByRole('textbox', { name: /Sample view name/ })
                .evaluate(element => parseFloat(getComputedStyle(element).fontSize));
              expect(enlargedFont).toBeGreaterThanOrEqual(normalFont * 1.9);
              const enlarged = {
                composition: await compositionGeometry(preview), nested: await inspectNestedDialog(page, preview),
              };
              geometryEvidence[`${packId}:${allocatedWidth}:rtl-200-${density}`] = enlarged;
              observe(packId, 'responsive-accessibility', {
                ...enlarged, normalFont, enlargedFont,
              }, `rtl-200-${density}`);
              observe(packId, 'dialogs-popovers', enlarged, `rtl-200-${density}`);
              await expect(preview.getByRole('textbox', { name: /Sample view name/ })).toHaveCSS('direction', 'rtl');
              if (allocatedWidth === width && density === 'spacious') {
                await preview.locator('[data-preview-section="form"]').screenshot({
                  path: testInfo.outputPath(`${packId}-rtl-200-spacious.png`), animations: 'disabled',
                });
              }
            }
            await page.locator('html').evaluate((element, savedContext) => {
              if (savedContext.scale) element.style.setProperty('--font-scale', savedContext.scale);
              else element.style.removeProperty('--font-scale');
              if (savedContext.dir == null) element.removeAttribute('dir');
              else element.setAttribute('dir', savedContext.dir);
            }, savedTextContext);
            await page.locator('body').evaluate((element, density) => {
              if (density == null) element.removeAttribute('data-density');
              else element.setAttribute('data-density', density);
            }, beforePreview.density);
            await preview.evaluate((element, old) => {
              element.removeAttribute('dir');
              [...element.querySelectorAll<HTMLElement>('[data-app-part~="nav-item"], [data-app-part~="page-title"]')]
                .forEach((label, index) => {
                  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
                  let node: Node | null;
                  while ((node = walker.nextNode())) {
                    if (node.nodeValue?.trim() && old[index] != null) {
                      node.nodeValue = old[index];
                      break;
                    }
                  }
                });
            }, original);
          }
          await page.setViewportSize({ width, height: 1000 });
          if (phase.kind === 'accessibility') {
            for (const section of ['overview', 'chart', 'map', 'table', 'form', 'feedback', 'widgets']) {
              await preview.locator(`[data-preview-section="${section}"]`).screenshot({
                path: testInfo.outputPath(`${packId}-${section}.png`), animations: 'disabled',
              });
            }
            await page.emulateMedia({ forcedColors: 'active' });
            const forcedColorsActive = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
            expect(forcedColorsActive,
              'forced-colors evidence requires actual media emulation, not an ignored request').toBe(true);
            await assertContained(preview, `${packId} forced colors`);
            const forcedNested = await inspectNestedDialog(page, preview);
            const forcedTable = preview.locator('[data-preview-section="chart"]')
              .getByRole('table', { name: 'Sample battery trace — data table' });
            await expect(forcedTable).toBeVisible();
            const forcedColors = {
              active: forcedColorsActive, composition: await compositionGeometry(preview),
              nested: forcedNested, dataFallback: await compositionGeometry(forcedTable),
            };
            await page.emulateMedia({ forcedColors: 'none' });
            const measured = await compositionGeometry(preview);
            const measurements = {
              'shell-navigation': await compositionGeometry(preview.locator('[data-app-part~="shell"]')),
              'page-composition': measured,
              'controls-forms': await compositionGeometry(preview.locator('[data-preview-section="form"]')),
              'tables-lists': {
                ledger: await compositionGeometry(preview.locator('[data-preview-section="table"]')),
                definitions: await compositionGeometry(preview.locator('[data-preview-section="overview"] dl')),
              },
              'metrics-timelines': await compositionGeometry(preview.locator('[data-preview-section="overview"]')),
              'charts-gauges': await compositionGeometry(preview.locator('[data-preview-section="chart"]')),
              'maps-geofences': await compositionGeometry(preview.locator('[data-preview-section="map"]')),
              'feedback-all-states': await compositionGeometry(preview.locator('[data-preview-section="feedback"]')),
            };
            for (const [family, evidence] of Object.entries(measurements)) {
              observe(packId, family as keyof typeof measurements, evidence, 'selected-native-prepared');
            }
            observe(packId, 'responsive-accessibility', {
              composition: measured, axe: `${packId}-axe-preview.json`, forcedColors,
            }, 'axe-forced-colors');
            observe(packId, 'dialogs-popovers', forcedNested, 'forced-colors');
          }
          // Leave real shared legend state active so closing must clean up its temporary URL key.
          const closingChart = preview.locator('[data-preview-section="chart"]');
          const closingReference = closingChart.getByRole('button', { name: 'Sample reference (%)', exact: true });
          await expect(closingReference).toHaveAttribute('aria-pressed', 'false');
          await closingReference.click();
          await expect(closingReference).toHaveAttribute('aria-pressed', 'true');
          await expect(closingChart.locator('.recharts-line-curve')).toHaveCount(1);
          const hiddenParameter = `hidden_${await closingChart.locator('[data-chart-key]').getAttribute('data-chart-key')}`;
          await expect.poll(() => new URL(page.url()).searchParams.get(hiddenParameter)).toBe('reference');
          expect(new URL(page.url()).pathname).toBe(new URL(beforePreviewUrl).pathname);
          expect(new URL(page.url()).hash).toBe(new URL(beforePreviewUrl).hash);
          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();
          await expect.poll(() => page.url()).toBe(beforePreviewUrl);
          await expect(opener).toBeFocused();
          await expectNeutral(page, true);
          expect(mocks.requests.slice(requestsBefore).filter(request => /\/(map|locations|annotations|commands?)(?:\/|$)/.test(request.path))).toEqual([]);
          expect(await preservedPreferences(page)).toEqual(beforePreview);
          expect(saved).toEqual(savedBeforePreview);
        });
      }
      if (phase.kind === 'route') {
        await testInfo.attach('real-page-compositions.json', {
          body: JSON.stringify({ scope, route: phase.path, observations: routeEvidence }, null, 2), contentType: 'application/json',
        });
      }
      if (phase.kind === 'responsive') {
        await testInfo.attach('preview-compositions.json', {
          body: JSON.stringify({ scope, observations: geometryEvidence }, null, 2), contentType: 'application/json',
        });
        await testInfo.attach('preview-identity-collisions.json', {
          body: JSON.stringify(Object.fromEntries([...signatures].map(([value, clusters]) => [
            value, [...clusters.values()].filter(group => group.length > 1),
          ])), null, 2), contentType: 'application/json',
        });
        for (const [allocatedWidth, distinct] of signatures) {
          expect.soft(distinct.size, `EXACTLY 27 rendered layout signatures at ${allocatedWidth}px/${theme}`).toBe(27);
        }
      }
      expect(mocks.requests.slice(requestStart).filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method))).toEqual([]);
      expect(mocks.requests.filter(request => /\/commands?(?:\/|$)/.test(request.path) && request.method !== 'GET')).toEqual([]);
      await picker.getByRole('combobox', { name: 'Apply design to', exact: true }).selectOption('app');
      await expectProfile(page, saved.pack_id);
      const after = await preservedPreferences(page);
      expect(after.variables).toEqual(preferences.variables);
      expect(after.density).toEqual(preferences.density);
      if (phase.kind === 'isolation') {
        const isolated: Record<string, unknown> = {};
        const incomplete: Record<string, unknown> = {};
        const outer: Record<string, unknown> = {};
        const allocations: Record<string, { availableWidth: number; comparedWidth: number }> = {};
        const isolationWidth = width < 1280 ? 320 : 768;
        for (const outerPack of ['memphis', 'blueprint'] as const) {
          await selectReviewPack(page, outerPack);
          await expectProfile(page, outerPack);
          await expect(workspaceHeader).toBeVisible();
          outer[outerPack] = await isolationAppearance(workspaceHeader);
          const outerBefore = await preservedPreferences(page);
          await picker.getByRole('button', { name: 'Preview Quiet Form', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Preview Quiet Form', exact: true });
          const preview = dialog.locator('[data-preview-synthetic="true"]');
          await expect(preview).toBeVisible();
          const availableWidth = await preview.evaluate(element => element.getBoundingClientRect().width);
          expect(availableWidth).toBeGreaterThanOrEqual(isolationWidth);
          // Outer dialog borders allocate different space; compare inner designs at the same measured width.
          await preview.evaluate((element, allocatedWidth) => {
            element.style.width = `${allocatedWidth}px`;
          }, isolationWidth);
          await expect.poll(() => preview.evaluate(element => element.getBoundingClientRect().width)).toBe(isolationWidth);
          allocations[outerPack] = { availableWidth, comparedWidth: isolationWidth };
          await assertPlotAndMap(preview);
          await assertOwnerGuardActivation(preview);
          await expectProfile(page, outerPack);
          const inline = await isolationAppearance(preview);
          const portaled = await inspectPortaledIsolation(page, preview);
          isolated[outerPack] = { inline, portaled };
          incomplete[outerPack] = await inspectIncompletePreview(page, preview);
          observe('quiet', 'page-composition', inline, 'mixed-pack-owned-inline', outerPack, isolationWidth);
          observe('quiet', 'dialogs-popovers', portaled, 'mixed-pack-owned-portals', outerPack, isolationWidth);
          observe('quiet', 'dialogs-popovers', incomplete[outerPack], 'mixed-pack-incomplete-neutral', outerPack, isolationWidth);
          observe(outerPack, 'shell-navigation', outer[outerPack], 'outer-profile-retained');
          await dialog.screenshot({ path: testInfo.outputPath(`quiet-inside-${outerPack}.png`), animations: 'disabled' });
          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();
          await expectProfile(page, outerPack);
          expect(await preservedPreferences(page)).toEqual(outerBefore);
        }
        await testInfo.attach('mixed-pack-isolation.json', {
          body: JSON.stringify({ scope, innerPack: 'quiet', allocations, isolated, incomplete, outer }, null, 2), contentType: 'application/json',
        });
        expect(isolated.memphis, 'Quiet inline and real open portals are independent of outer application pack')
          .toEqual(isolated.blueprint);
        expect(outer.memphis, 'outer shell keeps its own visibly different design').not.toEqual(outer.blueprint);
        expect(incomplete.memphis, 'an incomplete real preview and its body portals remain neutral under either outer pack')
          .toEqual(incomplete.blueprint);
      }
      await page.reload();
      await waitForHarnessReady(page, mocks);
      await expectProfile(page, saved.pack_id);
      const neutralAfter: Record<string, unknown> = {};
      for (const publicPath of publicPaths) {
        // Client navigation deliberately retains the already-loaded design CSS.
        await page.evaluate(path => {
          history.pushState(null, '', path);
          dispatchEvent(new PopStateEvent('popstate'));
        }, publicPath);
        await waitForHarnessReady(page, mocks);
        await expectNeutral(page, true);
        neutralAfter[publicPath] = await isolationAppearance(page.locator('body'));
        expect(neutralAfter[publicPath], `${publicPath} keeps its actual neutral rendering`)
          .toEqual(neutralBefore[publicPath]);
      }
      expect(mocks.requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        && !['/api/v1/settings/widget-design-pack', '/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path))).toEqual([]);
      expect(failures).toEqual([]);
      await assertMockApiComplete(page, mocks);
      await testInfo.attach('main-phase-invariants.json', {
        body: JSON.stringify({
          scope, publicRoutes: { before: neutralBefore, after: neutralAfter },
          appearance: { before: preferences, after }, dataSaver: beforePreview.storage['teslasync:low-bandwidth:v1'],
          persistedProfileAfterReload: { ...saved },
          forbiddenWrites: mocks.requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
            && !['/api/v1/settings/widget-design-pack', '/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path)),
          pageErrors: failures,
        }, null, 2), contentType: 'application/json',
      });
      await testInfo.attach('acceptance-family-observations.json', {
        body: JSON.stringify({
          claim: 'Only this registered phase was observed. Mocked UI measurements are not certification; final assertions and visual review remain authoritative.',
          scope, requiredPhases: mainPhases(width),
          join: {
            profile: ['project', 'profile', 'theme', 'profileWidth'],
            observation: ['allocatedWidth', 'pack', 'family', 'phase', 'route', 'state', 'outerPack'],
            rule: 'Join successful phase artifacts by profile, retaining every observation facet. Require every registered phase, all 27 packs in every real-route/core/allocated-width phase, and all 12 families for each pack across the union. Isolation covers its explicit inner/outer packs only. Phases are separate tests, not one completed 324-cell case.',
          },
          families: acceptanceFamilies, observedMeasurements: familyEvidence.length, observations: familyEvidence,
        }, null, 2), contentType: 'application/json',
      });
    });
  }
}
