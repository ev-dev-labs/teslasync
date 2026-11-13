import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator } from '@playwright/test';
import { getAppDesignAttributes } from '../src/components/ui/app-designs/designs';
import { PACK_IDS, type PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { routeBuiltApplication, test } from './app-design-test';
import { BODY_ROLE_SELECTOR, clearCaptureImages, findClippedBottomNavigationLabels, findClippedWorkspaceRangeLabels, findHorizontalScrollRegions, findOverlappingWorkspaceInputActions, findSmallBodyText, findSmallTouchTargets, findSplitBottomNavigationWords, findSplitOperationalMetricWords, selectCaptureRoutes, skipExistingCapture, writeCaptureImages } from './design-packs-capture';
import { assertMockApiComplete, closeMockApiFixtures, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';
import { cardLayoutContractPaths, resolveCardLayoutContractSource } from './cardLayoutContractSources';
import { createReviewPreference, installGeofenceReviewSources, installPackReview } from './widget-design-packs.mock';
import { energyReviewPath, installEnergyReviewSources } from './widget-design-packs.energy.mock';
import { chargingReviewPath } from './widget-design-packs.specialized.fixtures';
import { installSpecializedReviewSources } from './widget-design-packs.specialized.mock';
import { actionsFixtureState, installActionsFixtures, RULES } from './operationalbrief-contracts/actions.fixtures';
import { expectedVerifyBody, resaleCertificate } from './operationalbrief-contracts/specialized-resale.supported.fixtures';
import { catalogueOperationalSources } from './dashboardCatalogueOperationalSources';
import type { ChargingSession } from '../src/api/types';

const requestedPack = process.env.DESIGN_PACK ?? 'classic';
if (!PACK_IDS.some(id => id === requestedPack)) {
  throw new Error(`Unknown design pack: ${requestedPack}`);
}
const packId = requestedPack as PackId;
const routes = selectCaptureRoutes(process.env.DESIGN_PACK_PAGES);
const requestedScale = process.env.DESIGN_PACK_FONT_SCALE;
const fontScale = requestedScale === undefined ? 1 : Number(requestedScale);
if (!Number.isFinite(fontScale) || fontScale < 0.85 || fontScale > 1.35) {
  throw new Error('DESIGN_PACK_FONT_SCALE must be between 0.85 and 1.35');
}
const scaleSuffix = requestedScale === undefined ? '' : `-scale-${String(fontScale).replace('.', '-')}`;
const forcedColors = process.env.DESIGN_PACK_FORCED_COLORS === '1';
const forcedColorsSuffix = forcedColors ? '-forced-colors' : '';
const touchDevice = process.env.DESIGN_PACK_TOUCH_DEVICE === '1';
const touchSuffix = touchDevice ? '-touch' : '';
const captureStates = process.env.DESIGN_PACK_CAPTURE_STATES === '1';
const viewportOnly = process.env.DESIGN_PACK_VIEWPORT_ONLY === '1';
const checkOnly = process.env.DESIGN_PACK_CHECK_ONLY === '1';
if (checkOnly && captureStates) throw new Error('Check-only runs cannot capture interactive states');
const threeChargers = process.env.DESIGN_PACK_ENERGY_THREE_CHARGERS === '1';
const chargerSuffix = threeChargers ? '-three-chargers' : '';
const shotsRoot = resolve(process.env.DESIGN_PACK_SHOTS_ROOT ?? resolve(process.cwd(), '..', 'docs', 'design-packs', 'shots'));
const dashboardWidgets = [
  ['onboarding-checklist', 'Onboarding'], ['vehicle-hero', 'Vehicle card'],
  ['vehicle-twin', 'Digital Twin'], ['digital-twin-mini', 'Digital Twin Mini'],
  ['battery-gauge', 'Battery'], ['climate-status', 'Climate'],
  ['recent-drives', 'Recent drives'], ['charge-status', 'Charge status'],
  ['security-status', 'Security'], ['quick-nav', 'Quick navigation'],
  ['fleet-posture', 'Fleet posture'],
] as const;

async function assertMobileTable(table: Locator, columns: number, rowHeaders: number, firstValue: string) {
  await expect(table.getByRole('row')).toHaveCount(169);
  await expect(table.getByRole('columnheader')).toHaveCount(columns);
  await expect(table.getByRole('rowheader')).toHaveCount(rowHeaders);
  await expect(table.getByRole('cell')).toHaveCount(168 * columns - rowHeaders);
  await expect(table.getByRole('cell').first()).toHaveAccessibleName(firstValue);
  const firstRow = table.locator('tbody tr').first();
  expect(await firstRow.evaluate(element => getComputedStyle(element).display)).toBe('grid');
  const cells = await firstRow.locator('th, td').evaluateAll(elements => elements.map(element => ({
    width: element.getBoundingClientRect().width,
    overflow: element.scrollWidth - element.clientWidth,
  })));
  for (const cell of cells) {
    expect(cell.width).toBeGreaterThanOrEqual(100);
    expect(cell.overflow).toBeLessThanOrEqual(1);
  }
}

test.afterAll(async () => { await closeMockApiFixtures(); });

for (const route of routes) {
  test(`capture ${route.file} (${route.template})`, async ({ page }, testInfo) => {
    const mode = testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark';
    const width = testInfo.project.use.viewport?.width;
    const baseURL = testInfo.project.use.baseURL;
    if (!width || typeof baseURL !== 'string') throw new Error('Capture viewport or origin missing');
    const touchAudit = (width < 768 || touchDevice) && process.env.DESIGN_PACK_CHECK_TOUCH === '1';
    const textAudit = width < 768 && process.env.DESIGN_PACK_CHECK_TEXT_SIZE === '1';
    const selectionTouchTargets: Awaited<ReturnType<typeof findSmallTouchTargets>> = [];
    const directory = resolve(shotsRoot, packId, `${testInfo.project.name}${forcedColorsSuffix}${touchSuffix}${scaleSuffix}${chargerSuffix}`);
    const viewportPath = resolve(directory, `${route.file}.png`);
    const fullPath = resolve(directory, `${route.file}--full.png`);
    const tablePath = resolve(directory, `${route.file}--table.png`);
    const supportPath = resolve(directory, `${route.file}--support.png`);
    const alreadyCaptured = await skipExistingCapture(viewportPath, !checkOnly && process.env.DESIGN_PACK_SKIP_EXISTING === '1');
    test.skip(alreadyCaptured, 'Existing viewport evidence is preserved');
    let tableImage: Buffer | undefined;
    let supportImage: Buffer | undefined;
    if (!checkOnly) {
      await mkdir(directory, { recursive: true });
      await clearCaptureImages(viewportPath, fullPath, tablePath, captureStates, [supportPath]);
    }
    if (forcedColors) await page.emulateMedia({ forcedColors: 'active' });
    const saved = createReviewPreference();
    saved.pack_id = packId;
    saved.app_wide = true;
    const mocks = await installPackReview(
      page, mode, width < 768 ? 390 : width, false, dashboardWidgets, true, saved, baseURL,
      { font_scale: fontScale },
    );
    if (route.path.startsWith('/automations') || route.path === '/benchmarks/privacy') {
      await installActionsFixtures(page, mocks, actionsFixtureState());
      await page.route(url => url.pathname === '/api/v1/automations/701', request => {
        if (request.request().method() !== 'GET' || new URL(request.request().url()).search) return request.fallback();
        return fulfillApiFixture(request, mocks, { json: RULES[0] });
      });
    }

    if (route.path === '/resale-vault') {
      await page.route(url => url.pathname === '/api/v1/public/battery-certificate/verify', request => {
        if (request.request().method() !== 'POST'
          || !isDeepStrictEqual(request.request().postDataJSON(), expectedVerifyBody(resaleCertificate))) {
          return request.fallback();
        }
        return fulfillApiFixture(request, mocks, {
          json: { valid: true, certificate: resaleCertificate.certificate },
        });
      });
    }
    for (const pathname of cardLayoutContractPaths) {
      await page.route(url => url.pathname === `/api/v1${pathname}`, route => {
        if (route.request().method() !== 'GET') return route.fallback();
        const json = resolveCardLayoutContractSource(new URL(route.request().url()));
        if (json === undefined) return route.fallback();
        if (pathname === '/system/openapi' && typeof json === 'string') {
          return fulfillApiFixture(route, mocks, { body: json, contentType: 'application/yaml' });
        }
        return fulfillApiFixture(route, mocks, { json });
      });
    }
    if (route.path === '/geofences') await installGeofenceReviewSources(page, mocks);
    if (route.path === '/energy' && threeChargers) {
      const [session] = catalogueOperationalSources(new Date().toISOString())['/charging'] as ChargingSession[];
      const sessions = [
        session,
        { ...session, id: 702, charger_type: 'Tesla' },
        { ...session, id: 703, charger_type: 'CCS' },
      ];
      await page.route(url => url.pathname === '/api/v1/charging', request => {
        if (request.request().method() !== 'GET') return request.fallback();
        return fulfillApiFixture(request, mocks, { json: sessions });
      });
    }
    if (['/drives', '/drives/412', '/drives/412/replay', '/battery-cells',
      '/charging-heatmap', '/signal-mutual-information', '/live', '/chatbot', '/statistics'].includes(route.path)) {
      await installSpecializedReviewSources(page, mocks, mode);
    }
    let path = route.path;
    if (path === '/charging-heatmap') path = chargingReviewPath;
    if (path === '/energy-flow') {
      const energy = await installEnergyReviewSources(page, mocks);
      energy.setActive(true);
      path = energyReviewPath;
    }
    await routeBuiltApplication(page, new URL(baseURL).origin, [new URL(path, baseURL).pathname], process.env.DESIGN_PACK_DIST_DIR);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    try {
      await waitForHarnessReady(page, mocks);
    } catch (error) {
      const requests = mocks?.requests ?? [];
      const settings = requests.filter(request => request.path === '/api/v1/settings').length;
      const liveSignals = requests.filter(request => /^\/api\/v1\/signals\/[^/]+\/live$/.test(request.path)).length;
      await testInfo.attach('mock-activity-counts', {
        body: `settings=${settings} live-signals=${liveSignals} total=${requests.length}`,
        contentType: 'text/plain',
      });
      throw error;
    }
    for (const [attribute, value] of Object.entries(getAppDesignAttributes(packId))) {
      await expect(page.locator('html')).toHaveAttribute(attribute, value);
    }
    await expect(page.locator('html')).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${packId}(?:\\s|$)`));
    const activeScale = await page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--font-scale')));
    expect(activeScale).toBeCloseTo(fontScale, 2);
    await expect(page.getByText(/page failed to load/i)).toHaveCount(0);
    await page.mouse.move(0, 0);
    const viewportImage = viewportOnly && !checkOnly ? await page.screenshot({ animations: 'disabled' }) : undefined;
    if (viewportImage) await writeCaptureImages(viewportPath, fullPath, [viewportImage]);
    if (touchDevice) expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true);

    if (route.path === '/energy' && width < 768 && packId === 'classic') {
      const headerGeometry = await page.locator('[data-role="page-header"]').first().evaluate(header => {
        const title = header.querySelector<HTMLElement>('[data-app-part~="page-title"]')!;
        const actions = header.querySelector<HTMLElement>('[data-app-part~="page-actions"]')!;
        const heading = title.querySelector<HTMLElement>('[data-route-focus-target]')!;
        const range = document.createRange();
        range.selectNodeContents(heading);
        const titleBox = title.getBoundingClientRect();
        const actionBox = actions.getBoundingClientRect();
        return {
          title: { top: titleBox.top, right: titleBox.right },
          actions: { top: actionBox.top, left: actionBox.left },
          headingLines: Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0).length,
        };
      });
      expect(Math.abs(headerGeometry.actions.top - headerGeometry.title.top)).toBeLessThanOrEqual(1);
      expect(headerGeometry.actions.left + 1).toBeGreaterThanOrEqual(headerGeometry.title.right);
      if (width >= 430 && fontScale === 1.35) expect(headerGeometry.headingLines).toBe(1);
    }

    if (route.path === '/energy' && width < 768 && packId === 'classic'
      && process.env.DESIGN_PACK_CHECK_WORKSPACE === '1') {
      const vehicle = page.locator('[data-role="mobile-workspace-controls"] [data-role="vehicle-picker-control"] input');
      await expect(vehicle).toHaveValue('Aurora');
      const vehicleText = await vehicle.evaluate((input: HTMLInputElement) => {
        const style = getComputedStyle(input);
        const canvas = document.createElement('canvas').getContext('2d')!;
        canvas.font = style.font;
        const spacing = parseFloat(style.letterSpacing) || 0;
        return {
          available: input.getBoundingClientRect().width - parseFloat(style.borderLeftWidth)
            - parseFloat(style.borderRightWidth) - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          required: canvas.measureText(input.value).width + spacing * Math.max(0, input.value.length - 1),
        };
      });
      expect(vehicleText.available - 1, JSON.stringify(vehicleText)).toBeGreaterThanOrEqual(vehicleText.required);
      const trigger = page.locator('[data-role="mobile-workspace-controls"] [data-active-range]');
      await trigger.click();
      const settings = page.getByRole('dialog', { name: 'View settings' });
      await expect(settings).toBeVisible();
      if (touchAudit) selectionTouchTargets.push(...await findSmallTouchTargets(page));
      const compare = settings.getByRole('switch', { name: 'Compare to previous period' });
      await compare.click();
      await expect(trigger).toHaveAttribute('data-active-range', /Compare/);
      expect(await findClippedWorkspaceRangeLabels(page)).toEqual([]);
      await compare.click();
      await settings.getByRole('button', { name: 'Custom', exact: true }).click();
      await settings.getByRole('button', { name: 'Apply custom range' }).click();
      await expect(trigger).toHaveAttribute('data-active-range', 'Custom');
      expect(await findClippedWorkspaceRangeLabels(page)).toEqual([]);
      await trigger.click();
      await settings.getByRole('button', { name: '7 days', exact: true }).click();
      await settings.getByRole('button', { name: 'Close view settings' }).click();
      await expect(trigger).toHaveAttribute('data-active-range', 'Last 7 days');
      await waitForHarnessReady(page, mocks);
    }

    if (route.path === '/help' && width < 768 && packId === 'classic') {
      const code = page.getByTestId('support-bundle-json');
      const disclosure = code.locator('..').locator('summary');
      await disclosure.click();
      await expect(code).toBeVisible();
      expect(await code.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      const json = await code.textContent();
      expect(() => JSON.parse(json ?? '')).not.toThrow();
      if (captureStates) {
        await disclosure.scrollIntoViewIfNeeded();
        supportImage = await page.screenshot({ animations: 'disabled' });
      }
      await disclosure.click();
      await page.locator('main').evaluate(element => { element.scrollTop = 0; });
    }

    if (route.path === '/energy' && width < 640) {
      if (packId === 'classic' && !forcedColors) {
        const plot = page.locator('[data-battery-panel="energy-charger-breakdown"] [data-chart-viewport]');
        if (threeChargers) {
          for (const label of ['Home/AC', 'Supercharger', 'DC fast']) {
            await expect(plot.getByText(label, { exact: true })).toBeVisible();
          }
        }
        const geometry = await plot.evaluate(element => {
          const child = element.firstElementChild;
          if (!child) throw new Error('Charger breakdown plot has no content');
          const bounds = element.getBoundingClientRect();
          const content = child.getBoundingClientRect();
          return { unusedHeight: bounds.bottom - content.bottom, clippedHeight: content.bottom - bounds.bottom };
        });
        expect(geometry.unusedHeight).toBeLessThanOrEqual(100);
        expect(geometry.clippedHeight).toBeLessThanOrEqual(1);
      }
      const sessions = page.getByRole('group', { name: 'Recent charging sessions' });
      await expect(sessions).toBeVisible();
      await expect(sessions.getByRole('link', { name: /^Open session details:/ }).first())
        .toHaveAttribute('href', '/charging/701');
      const row = sessions.locator('[data-row-key="701"]');
      await expect(row).toContainText('30%');
      await expect(row).toContainText('72%');
      await sessions.getByRole('button', { name: 'Quick view' }).first().click();
      const details = page.getByRole('dialog', { name: 'Recent charging sessions' });
      for (const field of ['Date', 'Energy', 'Battery', 'Power', 'Type', 'Cost', '$/kWh']) {
        await expect(details.getByText(field, { exact: true })).toBeVisible();
      }
      await expect(details.locator('a[href="/charging/701"]')).toBeVisible();
      if (textAudit) {
        const labelSizes = await details.locator('dt').evaluateAll(elements =>
          elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
        expect(labelSizes).toHaveLength(7);
        for (const size of labelSizes) expect(size).toBeGreaterThanOrEqual(15.9);
        const detailSizes = await details.locator('[data-app-part~="table-cell"] > dd, [data-app-part~="table-cell"] > dd :is(span, a, strong, code)')
          .evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
        expect(detailSizes.length).toBeGreaterThanOrEqual(7);
        for (const size of detailSizes) expect(size).toBeGreaterThanOrEqual(15.9);
      }
      if (captureStates) tableImage = await page.screenshot({ animations: 'disabled' });
      await details.getByRole('button', { name: 'Close', exact: true }).last().click();
      await page.locator('main').evaluate(element => { element.scrollTop = 0; });
    }

    if (process.env.DESIGN_PACK_LAYOUT_REPORT === '1') {
      const geometry = await page.evaluate(() => {
        const header = document.querySelector('[data-app-part~="page-header"]');
        const describe = (element: Element | null) => {
          if (!element) return null;
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            x: box.x, y: box.y, width: box.width, height: box.height,
            gap: style.gap, flex: style.flex, wrap: style.flexWrap,
          };
        };
        const commands = header?.querySelector('[data-action-zone="commands"]') ?? null;
        return {
          header: describe(header),
          title: describe(header?.querySelector('[data-app-part~="page-title"]') ?? null),
          actions: describe(header?.querySelector('[data-app-part~="page-actions"]') ?? null),
          commands: describe(commands),
          groups: Array.from(commands?.children ?? []).map(describe),
        };
      });
      console.log(`Header geometry: ${JSON.stringify(geometry)}`);
    }

    if (packId === 'classic' && width < 768 && route.path === '/drives') {
      const header = page.locator('[data-app-part~="page-header"]').first();
      const title = await header.locator('[data-app-part~="page-title"]').boundingBox();
      const actions = await header.locator('[data-app-part~="page-actions"]').boundingBox();
      expect(title).not.toBeNull();
      expect(actions).not.toBeNull();
      expect(actions!.x >= title!.x + title!.width - 1 || actions!.y >= title!.y + title!.height - 1).toBe(true);
      if (width >= 390 && fontScale <= 1) {
        expect(actions!.y).toBeLessThan(title!.y + title!.height);
        expect(actions!.x).toBeGreaterThanOrEqual(title!.x + title!.width - 1);
      }
    }
    if (packId === 'classic' && width >= 430 && width < 768 && fontScale <= 1 && route.path === '/charging') {
      const header = page.locator('[data-app-part~="page-header"]').first();
      const title = await header.locator('[data-app-part~="page-title"]').boundingBox();
      const actions = await header.locator('[data-app-part~="page-actions"]').boundingBox();
      expect(title).not.toBeNull();
      expect(actions).not.toBeNull();
      expect(actions!.y).toBeLessThan(title!.y + title!.height);
      expect(actions!.x).toBeGreaterThanOrEqual(title!.x + title!.width - 1);
    }
    if (packId === 'classic' && width < 1024 && ['/action-center', '/drives'].includes(route.path)) {
      const list = page.locator('[data-operational-metric-list]').first();
      await expect(list.getByRole('listitem')).toHaveCount(6);
      const columns = await list.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      expect(columns).toBeGreaterThanOrEqual(1);
      expect(columns).toBeLessThanOrEqual(2);
      const bounds = await list.locator('[data-operational-metric]').evaluateAll(items =>
        items.map(item => {
          const rect = item.getBoundingClientRect();
          return {
            top: rect.top,
            width: rect.width,
            bankDisplay: getComputedStyle(item.parentElement!).display,
            bankOwner: item.parentElement?.getAttribute('data-app-design-owner'),
            listDisplay: getComputedStyle(item.closest('[data-operational-metric-list]')!).display,
          };
        }));
      expect(bounds).toHaveLength(6);
      for (let index = 0; index < bounds.length; index++) {
        expect(bounds[index].width, JSON.stringify(bounds)).toBeGreaterThanOrEqual(120);
        if (index % columns === 0 && index > 0) {
          expect(bounds[index].top, JSON.stringify(bounds)).toBeGreaterThan(bounds[index - 1].top);
        } else if (index % columns !== 0) {
          expect(Math.abs(bounds[index].top - bounds[index - 1].top), JSON.stringify(bounds)).toBeLessThan(1);
        }
      }
    }
    if (packId === 'classic' && ['/action-center', '/drives'].includes(route.path)) {
      const compactBrief = page.locator('[data-operational-brief-compact="true"]').first();
      const valueSize = await compactBrief.locator('[data-operational-value]').first()
        .evaluate(element => parseFloat(getComputedStyle(element).fontSize));
      expect(valueSize).toBeCloseTo(20 * fontScale, 1);
      const measurements = await page.locator('[data-operational-metric-list]').first()
        .locator('[data-operational-metric]').evaluateAll(items => items.map(item => {
          const label = item.querySelector('[data-app-part~="metric-label"]')!.getBoundingClientRect();
          const value = item.querySelector('[data-app-part~="metric-value"]')!.getBoundingClientRect();
          const box = item.getBoundingClientRect();
          const parent = item.parentElement!;
          const list = item.closest('[data-operational-metric-list]')!;
          return {
            key: item.getAttribute('data-operational-metric'),
            height: box.height,
            contentHeight: value.bottom - label.top,
            parentDisplay: getComputedStyle(parent).display,
            parentHeight: parent.getBoundingClientRect().height,
            parentFlex: getComputedStyle(parent).flex,
            parentGridRows: getComputedStyle(parent).gridTemplateRows,
            metricFlex: getComputedStyle(item).flex,
            metricMinHeight: getComputedStyle(item).minHeight,
            listDisplay: getComputedStyle(list).display,
            listHeight: list.getBoundingClientRect().height,
            listFlexWrap: getComputedStyle(list).flexWrap,
          };
        }));
      expect(measurements).toHaveLength(6);
      for (const metric of measurements) {
        expect(metric.height - metric.contentHeight, JSON.stringify(metric)).toBeLessThanOrEqual(64 * fontScale);
      }
    }
    if (packId === 'classic' && width < 768) {
      const bodySizes = await page.locator(BODY_ROLE_SELECTOR).evaluateAll(elements => elements
        .filter(element => element.matches('[data-app-design-owner~="pack-classic"]')
          && !element.closest('[data-widget-pack], [data-app-metric="headline"], [data-app-metric="comparison"], [data-app-metric="ring"], [data-app-metric-grid="native-gauge"]')
          && !element.matches('[data-app-part~="metric"], [data-app-part~="metric-label"], [data-app-part~="metric-value"]'))
        .map(element => parseFloat(getComputedStyle(element).fontSize)));
      for (const size of bodySizes) expect(size).toBeGreaterThanOrEqual(Math.max(16, 16 * fontScale) - 0.1);
    }
    if (packId === 'classic' && width < 768 && route.path === '/action-center') {
      const brief = page.locator('[data-operational-brief]').first();
      const heading = brief.locator('[data-operational-brief-heading]');
      const details = brief.getByRole('button', { name: 'Review details' });
      const titleBox = await heading.boundingBox();
      const detailsBox = await details.boundingBox();
      expect(titleBox).not.toBeNull();
      expect(detailsBox).not.toBeNull();
      expect(detailsBox!.y).toBeLessThan(titleBox!.y + titleBox!.height);
      expect(detailsBox!.x).toBeGreaterThanOrEqual(titleBox!.x + titleBox!.width - 1);
      const overflow = await heading.evaluate(element => ({
        width: element.clientWidth, scrollWidth: element.scrollWidth,
        height: element.clientHeight, scrollHeight: element.scrollHeight,
      }));
      expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width + 1);
      expect(overflow.scrollHeight, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.height + 1);
    }
    if (packId === 'classic' && width < 768 && route.path === '/drives') {
      const message = page.locator('[data-operational-brief] [data-app-part~="feedback-message"]').first();
      await expect(message).toBeVisible();
      expect(await message.evaluate(element => parseFloat(getComputedStyle(element).fontSize)))
        .toBeCloseTo(Math.max(16, 16 * fontScale), 1);
      const scoreContrast = await page.locator('[data-app-part~="list-row"] [data-app-metric="score"]')
        .evaluateAll(elements => elements.map(element => {
          const parseColor = (value: string) => {
            if (!/^rgba?\(/.test(value)) return null;
            const parts = value.match(/\d*\.?\d+/g)?.map(Number);
            return parts && parts.length >= 3
              ? { rgb: parts.slice(0, 3), alpha: parts[3] ?? 1 } : null;
          };
          const foreground = parseColor(getComputedStyle(element).color);
          let background: ReturnType<typeof parseColor> = null;
          for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (style.opacity !== '1' || style.backgroundImage !== 'none' || style.mixBlendMode !== 'normal'
              || style.filter !== 'none' || style.backdropFilter !== 'none') break;
            const color = parseColor(style.backgroundColor);
            if (!color || (color.alpha > 0 && color.alpha < 1)) break;
            if (color.alpha === 1) { background = color; break; }
          }
          if (!foreground || foreground.alpha !== 1 || !background) {
            return { text: element.textContent, ratio: null };
          }
          const luminance = (rgb: number[]) => {
            const linear = rgb.map(value => {
              const s = value / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
          };
          const values = [luminance(foreground.rgb), luminance(background.rgb)].sort((a, b) => b - a);
          return { text: element.textContent, ratio: (values[0] + 0.05) / (values[1] + 0.05) };
        }));
      expect(scoreContrast.length).toBeGreaterThan(0);
      for (const score of scoreContrast) {
        expect(score.ratio, JSON.stringify(score)).not.toBeNull();
        expect(score.ratio!, JSON.stringify(score)).toBeGreaterThanOrEqual(4.5);
      }
      const metricTabs = page.getByRole('tablist', { name: 'Drives over time metric' });
      const tabs = metricTabs.getByRole('tab');
      await expect(tabs).toHaveCount(5);
      await tabs.first().focus();
      await tabs.first().press('End');
      await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
      await tabs.last().press('Home');
      await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
      for (const control of [metricTabs, page.getByTestId('drives-filters')]) {
        const layout = await control.evaluate(element => {
          const container = element.getBoundingClientRect();
          return Array.from(element.querySelectorAll<HTMLElement>('[data-app-part~="tab"]')).map(tab => {
            const box = tab.getBoundingClientRect();
            return { left: box.left - container.left, right: box.right - container.right, height: box.height };
          });
        });
        expect(layout.length).toBeGreaterThan(0);
        for (const tab of layout) {
          expect(tab.left).toBeGreaterThanOrEqual(-1);
          expect(tab.right).toBeLessThanOrEqual(1);
          expect(tab.height).toBeGreaterThanOrEqual(44);
        }
      }
      const details = page.locator('[data-operational-brief]').first()
        .getByRole('button', { name: 'Review details' });
      await details.focus();
      const describedBy = (await details.getAttribute('aria-describedby'))?.split(/\s+/).at(-1);
      expect(describedBy).toBeTruthy();
      const tooltip = page.locator(`[id="${describedBy}"]`);
      await expect(tooltip).toHaveCSS('opacity', '1');
      await expect(tooltip).toHaveCSS('position', 'absolute');
      expect(await tooltip.evaluate(element => getComputedStyle(element.parentElement!).overflowX))
        .toBe('visible');
      const tooltipBounds = await tooltip.boundingBox();
      expect(tooltipBounds).not.toBeNull();
      expect(tooltipBounds!.x).toBeGreaterThanOrEqual(0);
      expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(width + 1);
      await page.keyboard.press('Escape');
      await expect(tooltip).toHaveCSS('opacity', '0');
      await expect(tooltip).toHaveCSS('position', 'fixed');
      await details.blur();
      await details.hover();
      await expect(tooltip).toHaveCSS('opacity', '1');
      expect(await tooltip.evaluate(element => getComputedStyle(element.parentElement!).overflowX))
        .toBe('visible');
      await page.mouse.move(0, 0);
      const checkbox = page.getByRole('checkbox', { name: /^Select drive on / }).first();
      const choice = checkbox.locator('xpath=..');
      await choice.scrollIntoViewIfNeeded();
      const choiceBounds = await choice.boundingBox();
      expect(choiceBounds).not.toBeNull();
      expect(choiceBounds!.width).toBeGreaterThanOrEqual(44);
      expect(choiceBounds!.height).toBeGreaterThanOrEqual(44);
      if (touchAudit) selectionTouchTargets.push(...await findSmallTouchTargets(page));
      const selected = await checkbox.isChecked();
      await page.mouse.click(choiceBounds!.x + 2, choiceBounds!.y + choiceBounds!.height / 2);
      await expect(checkbox).toBeChecked({ checked: !selected });
      const restoredBounds = await choice.boundingBox();
      expect(restoredBounds).not.toBeNull();
      await page.mouse.click(restoredBounds!.x + 2, restoredBounds!.y + restoredBounds!.height / 2);
      await expect(checkbox).toBeChecked({ checked: selected });
      await page.locator('main').evaluate(element => { element.scrollTop = 0; });
      await waitForHarnessReady(page, mocks);
    }
    if (packId === 'classic' && width < 768 && route.path === '/charging' && !forcedColors) {
      const trend = page.locator('[aria-label="Charging over time chart with metric switcher"] .recharts-wrapper');
      await trend.scrollIntoViewIfNeeded();
      await trend.hover();
      const tooltip = page.locator('[data-app-part~="chart-tooltip"]').filter({ has: page.locator('[data-chart-tooltip-label]') });
      await expect(tooltip).toBeVisible();
      const cursor = trend.locator('.recharts-rectangle.recharts-tooltip-cursor');
      await expect(cursor).toBeVisible();
      expect(await cursor.evaluate(element => getComputedStyle(element).fill)).not.toBe('rgb(204, 204, 204)');
      const tooltipText = await tooltip.locator('[data-chart-tooltip-label], [data-chart-tooltip-name], [data-chart-tooltip-value], [data-chart-tooltip-value] *')
        .evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
      expect(tooltipText.length).toBeGreaterThan(0);
      for (const size of tooltipText) expect(size).toBeGreaterThanOrEqual(Math.max(16, 16 * fontScale) - 0.1);
      for (const copy of ['Prior-period comparison unavailable', 'Search, collections, and exports cover']) {
        const note = page.getByText(copy).first();
        await expect(note).toBeAttached();
        expect(await note.evaluate(element => parseFloat(getComputedStyle(element).fontSize)))
          .toBeGreaterThanOrEqual(Math.max(16, 16 * fontScale) - 0.1);
      }
      await page.mouse.move(0, 0);
      const heatmap = page.locator('[data-cost-heatmap-grid]');
      await expect(heatmap.locator('[data-cost-heatmap-day]')).toHaveCount(7);
      const rows = await heatmap.locator('[data-cost-heatmap-day]').evaluateAll(days => days.map(day => {
        const container = day.getBoundingClientRect();
        const cells = Array.from(day.querySelectorAll<HTMLElement>('[title]')).map(cell => {
          const box = cell.getBoundingClientRect();
          return { x: box.x, y: box.y, right: box.right, width: box.width };
        });
        return { right: container.right, cells };
      }));
      for (const row of rows) {
        expect(row.cells).toHaveLength(24);
        expect(row.cells[0].width).toBeGreaterThanOrEqual(14);
        expect(Math.abs(row.cells[0].x - row.cells[12].x)).toBeLessThan(1);
        expect(row.cells[12].y).toBeGreaterThan(row.cells[0].y);
        expect(row.cells[11].right).toBeLessThanOrEqual(row.right + 1);
        expect(row.cells[23].right).toBeLessThanOrEqual(row.right + 1);
      }
      const tableToggle = page.getByRole('button', { name: 'Charging Cost Heatmap — data table' });
      await tableToggle.click();
      await expect(tableToggle).toHaveAttribute('aria-expanded', 'true');
      const table = page.getByRole('table', {
        name: 'Average charging cost per kWh by weekday and hour of day',
      });
      if (width < 640) await assertMobileTable(table, 4, 168, '0:00');
      else await expect(table.getByRole('row')).toHaveCount(169);
      expect(await findHorizontalScrollRegions(page), 'open heatmap table has horizontal scrolling').toEqual([]);
      if (captureStates) {
        await page.getByRole('region', { name: 'Charging Cost Heatmap — data table' }).last().scrollIntoViewIfNeeded();
        tableImage = await page.screenshot({ animations: 'disabled' });
      }
      await tableToggle.click();
      await page.locator('main').evaluate(element => { element.scrollTop = 0; });
      await waitForHarnessReady(page, mocks);
    }
    if (packId === 'classic' && width < 640 && route.path === '/charging-heatmap' && !forcedColors) {
      const grid = page.locator('[data-heatmap-grid]');
      const slots = grid.locator('button[data-heatmap-slot]');
      await expect(slots).toHaveCount(168);
      await expect(grid.locator('button[data-heatmap-slot][tabindex="0"]')).toHaveCount(1);
      const geometry = await slots.evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }));
      const viewport = page.locator('[data-chart-key="charging-weekly-heatmap"] [data-chart-viewport]');
      const viewportBox = await viewport.boundingBox();
      expect(viewportBox).not.toBeNull();
      if (process.env.DESIGN_PACK_LAYOUT_CONTEXT === '1') {
        console.log(`Heatmap layout: ${JSON.stringify(await grid.evaluate(element => {
          const chain = [];
          for (let ancestor: Element | null = element; ancestor && chain.length < 10; ancestor = ancestor.parentElement) {
            const box = ancestor.getBoundingClientRect();
            const style = getComputedStyle(ancestor);
            chain.push({
              tag: ancestor.tagName.toLowerCase(), part: ancestor.getAttribute('data-app-part'),
              slot: ancestor.getAttribute('data-card-slot'), top: box.top, height: box.height,
              display: style.display, rows: style.gridTemplateRows,
              marginTop: style.marginTop, paddingTop: style.paddingTop,
            });
          }
          return chain;
        }))}`);
      }
      expect(geometry[167].y + geometry[167].height).toBeLessThanOrEqual(viewportBox!.y + viewportBox!.height + 1);
      for (const cell of geometry) {
        expect(cell.width).toBeGreaterThanOrEqual(44);
        expect(cell.height).toBeGreaterThanOrEqual(44);
      }
      const hourSizes = await slots.locator('[data-heatmap-hour-label]')
        .evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
      expect(hourSizes).toHaveLength(168);
      for (const size of hourSizes) expect(size).toBeGreaterThanOrEqual(Math.max(16, 16 * fontScale) - 0.1);
      for (let day = 0; day < 7; day += 1) {
        const start = day * 24;
        expect(geometry[start + 5].y).toBeCloseTo(geometry[start].y, 0);
        expect(geometry[start + 6].y).toBeGreaterThan(geometry[start].y);
      }
      const firstSlot = slots.nth(0);
      await firstSlot.focus();
      await firstSlot.press('ArrowRight');
      await expect(slots.nth(1)).toBeFocused();
      const activeSlot = grid.locator('button[data-heatmap-state="active"]').first();
      await activeSlot.click();
      const detail = page.getByRole('dialog');
      await expect(detail).toBeVisible();
      const detailSizes = await detail.locator('[data-chart-tooltip-label], [data-chart-tooltip-copy]')
        .evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
      expect(detailSizes.length).toBeGreaterThanOrEqual(2);
      for (const size of detailSizes) expect(size).toBeGreaterThanOrEqual(Math.max(16, 16 * fontScale) - 0.1);
      await detail.getByRole('button', { name: 'Close' }).click();
      await expect(detail).toHaveCount(0);
      await expect(activeSlot).toBeFocused();
      const tableToggle = page.getByRole('button', { name: /Weekly charging heatmap — data table/i });
      await tableToggle.click();
      await expect(tableToggle).toHaveAttribute('aria-expanded', 'true');
      const tableRegion = page.getByRole('region', { name: 'Charging sessions by weekday and hour of day' });
      const table = tableRegion.getByRole('table');
      await assertMobileTable(table, 5, 168, '12:00 AM');
      expect(await findHorizontalScrollRegions(page), 'open Charging Patterns table has horizontal scrolling').toEqual([]);
      if (captureStates) {
        await tableRegion.scrollIntoViewIfNeeded();
        tableImage = await page.screenshot({ animations: 'disabled' });
      }
      await tableToggle.click();
      await page.locator('main').evaluate(element => { element.scrollTop = 0; });
      await waitForHarnessReady(page, mocks);
    }
    if (packId === 'classic' && width >= 640 && route.path === '/charging-heatmap' && !forcedColors && !touchDevice) {
      const grid = page.locator('[data-heatmap-grid]');
      const slots = grid.locator('button[data-heatmap-slot]');
      await expect(slots).toHaveCount(168);
      const geometry = await slots.evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        return { y: box.y, width: box.width, height: box.height };
      }));
      for (let day = 0; day < 7; day += 1) {
        const start = day * 24;
        expect(geometry[start + 23].y).toBeCloseTo(geometry[start].y, 0);
        expect(geometry[start].width).toBeGreaterThan(0);
      }
      const viewport = page.locator('[data-chart-key="charging-weekly-heatmap"] [data-chart-viewport]');
      const viewportBox = await viewport.boundingBox();
      expect(viewportBox).not.toBeNull();
      expect(geometry[167].y + geometry[167].height).toBeLessThanOrEqual(viewportBox!.y + viewportBox!.height + 1);
      expect(await viewport.evaluate(element => getComputedStyle(element).contain)).toContain('size');
      expect(await grid.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      const labels = await grid.locator('[data-heatmap-axis-hour]').evaluateAll(elements => elements.map(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const box = range.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { text: element.textContent, left: box.left, right: box.right, size: parseFloat(style.fontSize), visible: style.visibility === 'visible' };
      }));
      const shown = labels.filter(label => label.visible);
      expect(labels).toHaveLength(24);
      expect(shown.map(label => label.text)).toEqual(Array.from({ length: 12 }, (_, index) => String(index * 2)));
      for (let index = 0; index < shown.length; index += 1) {
        expect(shown[index].size).toBeGreaterThanOrEqual(Math.max(16, 16 * fontScale) - 0.1);
        if (index > 0) expect(shown[index].left).toBeGreaterThanOrEqual(shown[index - 1].right);
      }
    }
    if (packId === 'classic' && width >= 640 && route.path === '/charging-heatmap' && !forcedColors && touchDevice) {
      if (width >= 768) {
        const vehicle = page.getByRole('combobox').first();
        const toggle = vehicle.locator('..').getByRole('button', { name: 'Show options' });
        const geometry = await vehicle.evaluate(element => {
          const button = element.parentElement?.querySelector('button[aria-label="Show options"]');
          if (!button) throw new Error('Vehicle options button not found');
          return {
            reserved: element.getBoundingClientRect().right - button.getBoundingClientRect().left,
            padding: parseFloat(getComputedStyle(element).paddingInlineEnd),
          };
        });
        expect(geometry.padding).toBeGreaterThanOrEqual(geometry.reserved - 1);
        await toggle.tap();
        await expect(vehicle).toHaveAttribute('aria-expanded', 'true');
        await vehicle.locator('..').getByRole('button', { name: 'Hide options' }).tap();
        await expect(vehicle).toHaveAttribute('aria-expanded', 'false');
      }
      const grid = page.locator('[data-heatmap-grid]');
      const slots = grid.locator('button[data-heatmap-slot]');
      await expect(slots).toHaveCount(168);
      await expect(grid.locator('button[data-heatmap-slot][tabindex="0"]')).toHaveCount(1);
      const geometry = await slots.evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        const label = element.querySelector('[data-heatmap-hour-label]')!;
        return { y: box.y, width: box.width, height: box.height,
          labelSize: parseFloat(getComputedStyle(label).fontSize), labelDisplay: getComputedStyle(label).display };
      }));
      const viewport = page.locator('[data-chart-key="charging-weekly-heatmap"] [data-chart-viewport]');
      const viewportBox = await viewport.boundingBox();
      expect(viewportBox).not.toBeNull();
      expect(geometry[167].y + geometry[167].height).toBeLessThanOrEqual(viewportBox!.y + viewportBox!.height + 1);
      expect(await viewport.evaluate(element => getComputedStyle(element).contain)).not.toContain('size');
      expect(await grid.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      const columns = await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      expect([6, 8, 12, 24]).toContain(columns);
      for (const cell of geometry) {
        expect(cell.width).toBeGreaterThanOrEqual(44);
        expect(cell.height).toBeGreaterThanOrEqual(44);
        expect(cell.labelDisplay).not.toBe('none');
        expect(cell.labelSize).toBeGreaterThanOrEqual(Math.max(16, 16 * fontScale) - 0.1);
      }
      for (let day = 0; day < 7; day += 1) {
        const start = day * 24;
        for (let hour = 0; hour < 24; hour += columns) {
          expect(geometry[start + hour + columns - 1].y).toBeCloseTo(geometry[start + hour].y, 0);
          if (hour > 0) expect(geometry[start + hour].y).toBeGreaterThan(geometry[start + hour - 1].y);
        }
      }
      await slots.first().focus();
      await slots.first().press('ArrowRight');
      await expect(slots.nth(1)).toBeFocused();
      const activeSlot = grid.locator('button[data-heatmap-state="active"]').first();
      await activeSlot.tap();
      const detail = page.getByRole('dialog');
      await expect(detail).toBeVisible();
      const detailBox = await detail.boundingBox();
      expect(detailBox).not.toBeNull();
      expect(detailBox!.x).toBeGreaterThanOrEqual(0);
      expect(detailBox!.x + detailBox!.width).toBeLessThanOrEqual(width + 1);
      const detailSizes = await detail.locator('[data-chart-tooltip-label], [data-chart-tooltip-copy]')
        .evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
      expect(detailSizes.length).toBeGreaterThanOrEqual(2);
      for (const size of detailSizes) expect(size).toBeGreaterThanOrEqual(Math.max(16, 16 * fontScale) - 0.1);
      await detail.getByRole('button', { name: 'Close' }).tap();
      await expect(detail).toHaveCount(0);
      await expect(activeSlot).toBeFocused();
      const tableToggle = page.getByRole('button', { name: /Weekly charging heatmap — data table/i });
      await tableToggle.tap();
      await expect(tableToggle).toHaveAttribute('aria-expanded', 'true');
      const tableRegion = page.getByRole('region', { name: 'Charging sessions by weekday and hour of day' });
      const table = tableRegion.getByRole('table');
      await assertMobileTable(table, 5, 168, '12:00 AM');
      expect(await findHorizontalScrollRegions(page), 'touch heatmap has horizontal scrolling').toEqual([]);
      if (captureStates) {
        await tableRegion.scrollIntoViewIfNeeded();
        tableImage = await page.screenshot({ animations: 'disabled' });
      }
      await tableToggle.tap();
      await page.locator('main').evaluate(element => { element.scrollTop = 0; });
      await waitForHarnessReady(page, mocks);
    }
    if (packId === 'classic' && route.path === '/charging-heatmap' && forcedColors) {
      const chart = page.locator('[data-chart-key="charging-weekly-heatmap"]');
      await expect(chart.locator('[data-chart-viewport]')).toBeHidden();
      const fallback = chart.locator('[data-chart-alternative]');
      await expect(fallback).toBeVisible();
      const fallbackTable = fallback.getByRole('table');
      if (width < 640 || touchDevice) {
        await assertMobileTable(fallbackTable, 5, 0, 'Sun');
        const headers = await fallbackTable.locator('thead th').allTextContents();
        const labels = await fallbackTable.locator('tbody tr').first().locator('td')
          .evaluateAll(cells => cells.map(cell => getComputedStyle(cell, '::before').content));
        expect(labels).toEqual(headers.map(header => `${JSON.stringify(header.trim())} / ""`));
      } else {
        await expect(fallbackTable.getByRole('row')).toHaveCount(169);
        await expect(fallbackTable.getByRole('columnheader')).toHaveCount(5);
        await expect(fallbackTable.getByRole('cell')).toHaveCount(168 * 5);
      }
      if (width < 768 || touchDevice) {
        const cells = await fallback.locator('caption, th, td').evaluateAll(elements => elements.map(element => ({
          text: element.textContent?.trim().slice(0, 60),
          size: parseFloat(getComputedStyle(element).fontSize),
          overflow: element.scrollWidth - element.clientWidth,
        })));
        const smallCells = cells.filter(cell => cell.size < Math.max(16, 16 * fontScale) - 0.1);
        const clippedCells = cells.filter(cell => cell.overflow > 1);
        expect(smallCells.slice(0, 10), `${smallCells.length} forced-colors table cells have small text`).toEqual([]);
        expect(clippedCells.slice(0, 10), `${clippedCells.length} forced-colors table cells clip horizontally`).toEqual([]);
      }
      if (width < 640 || touchDevice) {
        const caption = await fallbackTable.locator('caption').evaluate(element => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height, fontSize: parseFloat(getComputedStyle(element).fontSize) };
        });
        expect(caption.width).toBeGreaterThanOrEqual(200);
        expect(caption.height).toBeLessThanOrEqual(caption.fontSize * 5);
        if (captureStates) {
          await fallback.scrollIntoViewIfNeeded();
          tableImage = await page.screenshot({ animations: 'disabled' });
          await page.locator('main').evaluate(element => { element.scrollTop = 0; });
        }
      }
    }

    await page.mouse.move(0, 0);
    const frames = checkOnly ? [] : [viewportImage ?? await page.screenshot({ animations: 'disabled' })];
    const horizontalScrollRegions = width < 768 ? await findHorizontalScrollRegions(page) : [];
    const smallTouchTargets = touchAudit
      ? [...selectionTouchTargets, ...await findSmallTouchTargets(page)]
      : [];
    const smallBodyText = textAudit ? await findSmallBodyText(page) : [];
    const splitMetricWords = width < 768 ? await findSplitOperationalMetricWords(page) : [];
    const main = page.locator('main');
    for (;;) {
      const position = await main.evaluate(element => ({
        top: element.scrollTop,
        end: element.scrollHeight - element.clientHeight,
        step: Math.max(1, element.clientHeight - 32),
      }));
      if (position.top >= position.end - 1) break;
      await main.evaluate((element, next) => { element.scrollTop = next; },
        Math.min(position.end, position.top + position.step));
      await waitForHarnessReady(page, mocks);
      const next = await main.evaluate(element => element.scrollTop);
      if (next <= position.top) throw new Error('Main content could not be scrolled for capture');
      if (!viewportOnly && !checkOnly) frames.push(await page.screenshot({ animations: 'disabled' }));
      if (width < 768) horizontalScrollRegions.push(...await findHorizontalScrollRegions(page));
      if (touchAudit) smallTouchTargets.push(...await findSmallTouchTargets(page));
      if (textAudit) smallBodyText.push(...await findSmallBodyText(page));
      if (width < 768) splitMetricWords.push(...await findSplitOperationalMetricWords(page));
    }
    await expectNoHorizontalOverflow(page);
    const uniqueScrollRegions = Array.from(new Map(horizontalScrollRegions.map(region =>
      [JSON.stringify(region), region])).values());
    const mainWidth = await main.evaluate(element => ({
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
    }));
    const overflowDetails = mainWidth.scrollWidth > mainWidth.clientWidth + 1
      ? await main.evaluate(element => {
        const right = element.getBoundingClientRect().left + element.clientWidth;
        return Array.from(element.querySelectorAll<HTMLElement>('*'))
          .filter(child => {
            const box = child.getBoundingClientRect();
            const style = getComputedStyle(child);
            return box.width > 0 && box.height > 0 && box.right > right + 1
              && style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map(child => ({
            tag: child.tagName.toLowerCase(), id: child.id,
            part: child.getAttribute('data-app-part'), className: child.getAttribute('class'),
            right: Math.round(child.getBoundingClientRect().right - right),
            width: Math.round(child.getBoundingClientRect().width),
            leftStyle: child.style.left,
            parentLeft: Math.round(child.parentElement?.getBoundingClientRect().left ?? 0),
            text: child.getAttribute('role') === 'tooltip' ? child.textContent : null,
          }))
          .sort((a, b) => b.right - a.right).slice(0, 20);
      }) : [];
    expect(mainWidth.scrollWidth, JSON.stringify({ ...mainWidth, overflowDetails }))
      .toBeLessThanOrEqual(mainWidth.clientWidth + 1);
    expect(uniqueScrollRegions, 'mobile content has horizontal scrolling regions').toEqual([]);
    expect(pageErrors, 'uncaught browser errors').toEqual([]);
    await assertMockApiComplete(page, mocks);
    if (!checkOnly) {
      await writeCaptureImages(viewportPath, fullPath, frames);
      if (tableImage) await writeFile(tablePath, tableImage);
      if (supportImage) await writeFile(supportPath, supportImage);
    }
    if (width < 768) {
      expect.soft(await findClippedBottomNavigationLabels(page), 'bottom navigation text must remain visible').toEqual([]);
      expect.soft(await findSplitBottomNavigationWords(page), 'bottom navigation words must remain readable').toEqual([]);
      expect.soft(await findClippedWorkspaceRangeLabels(page), 'workspace range text must remain visible').toEqual([]);
      expect.soft(await findOverlappingWorkspaceInputActions(page), 'workspace actions must not overlap input text').toEqual([]);
      const uniqueSplitWords = Array.from(new Map(splitMetricWords.map(word =>
        [JSON.stringify(word), word])).values());
      expect.soft(uniqueSplitWords, 'operational metric words must remain readable').toEqual([]);
    }
    if (touchAudit) {
      const uniqueTargets = Array.from(new Map(smallTouchTargets.map(target =>
        [JSON.stringify(target), target])).values());
      expect.soft(uniqueTargets, 'visible touch targets must be at least 44 by 44 CSS pixels').toEqual([]);
    }
    if (textAudit) {
      const uniqueText = Array.from(new Map(smallBodyText.map(text =>
        [JSON.stringify(text), text])).values());
      expect.soft(uniqueText, 'visible body text must be at least 16 CSS pixels').toEqual([]);
    }
    if (process.env.DESIGN_PACK_CHECK_CONTRAST === '1') {
      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      await testInfo.attach('contrast-audit.json', {
        body: JSON.stringify(results, null, 2), contentType: 'application/json',
      });
      console.log(`Contrast: ${results.violations.length} violated rules, `
        + `${results.incomplete.reduce((count, rule) => count + rule.nodes.length, 0)} nodes require manual review`);
      for (const rule of results.incomplete) {
        for (const node of rule.nodes) {
          console.log(`  Manual contrast review: ${node.target.join(' > ')} — ${node.failureSummary ?? 'unknown'}`);
          if (process.env.DESIGN_PACK_CONTRAST_CONTEXT === '1') {
            const target = page.locator(node.target.join(' ')).first();
            await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
            const context = await target.evaluate(element => {
              const rect = element.getBoundingClientRect();
              const chain: Array<Record<string, string>> = [];
              for (let ancestor: Element | null = element; ancestor && chain.length < 12; ancestor = ancestor.parentElement) {
                const style = getComputedStyle(ancestor);
                chain.push({
                  tag: ancestor.tagName.toLowerCase(), color: style.color,
                  background: style.backgroundColor, image: style.backgroundImage,
                  fill: style.fill, fontSize: style.fontSize,
                  opacity: style.opacity, filter: style.filter, backdrop: style.backdropFilter,
                });
              }
              const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
              return {
                html: element.outerHTML.slice(0, 300),
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                hit: hit?.tagName.toLowerCase() ?? null, hitContainsText: !!hit && (hit === element || element.contains(hit)),
                chain,
              };
            }).catch(error => ({ error: String(error) }));
            console.log(`  Contrast context: ${JSON.stringify(context)}`);
          }
        }
      }
      expect(results.violations.map(rule => ({
        id: rule.id,
        nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
      })), 'WCAG color contrast violations').toEqual([]);
    }
  });
}

if (routes.some(route => route.path === '/')) {
  test('preserve the two Digital Twin widgets with the application design enabled', async ({ page }, testInfo) => {
    const mode = testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark';
    const width = testInfo.project.use.viewport?.width;
    const baseURL = testInfo.project.use.baseURL;
    if (!width || typeof baseURL !== 'string') throw new Error('Capture viewport or origin missing');
    const saved = createReviewPreference();
    saved.pack_id = packId;
    const selection = dashboardWidgets.filter(([id]) => id === 'vehicle-twin' || id === 'digital-twin-mini');
    if (forcedColors) await page.emulateMedia({ forcedColors: 'active' });
    const mocks = await installPackReview(
      page, mode, width < 768 ? 390 : width, false, selection, true, saved, baseURL,
      { font_scale: fontScale },
    );
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const directory = resolve(process.cwd(), '..', 'docs', 'design-packs', 'shots', packId,
      `${testInfo.project.name}${forcedColorsSuffix}${touchSuffix}${scaleSuffix}`);
    const paths = selection.flatMap(([id]) => ['widget-only', 'app-wide'].map(state =>
      resolve(directory, `dashboard--${id}--${state}.png`)));
    await mkdir(directory, { recursive: true });
    await Promise.all(paths.map(path => rm(path, { force: true })));
    const images: Buffer[] = [];
    const widgetWidths = new Map<string, number>();
    const measurements: Array<Array<{ label: string; x: number; y: number; width: number; height: number; radius: string }>> = [];

    for (const appWide of [false, true]) {
      saved.app_wide = appWide;
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForHarnessReady(page, mocks);
      if (appWide) await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', packId);
      else await expect(page.locator('html')).not.toHaveAttribute('data-app-design-pack');
      const current: Array<{ label: string; x: number; y: number; width: number; height: number; radius: string }> = [];
      for (const [id] of selection) {
        const widget = page.locator(`[data-widget-id="pack-review-${id}"]`);
        await expect(widget).toHaveAttribute('data-app-design-preserve', '');
        await expect(widget).not.toHaveAttribute('data-app-design-owner');
        await expect(widget.locator('[data-app-design-owner]')).toHaveCount(0);
        const studio = widget.locator('[data-vehicle-studio]');
        const twin = studio.locator('[data-vehicle-twin]');
        const photo = twin.locator('img').first();
        await expect(studio).toBeVisible();
        await expect(twin).toBeVisible();
        await expect.poll(() => photo.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const photoSource = await photo.getAttribute('src');
        expect(photoSource).not.toBeNull();
        expect(new URL(photoSource!).hostname).toBe('static-assets.tesla.com');
        const naturalBounds = await widget.boundingBox();
        if (!naturalBounds) throw new Error(`${id}: widget has no bounds`);
        images.push(await widget.screenshot({ animations: 'disabled' }));
        const originalWidth = await widget.evaluate(element => ({
          value: (element as HTMLElement).style.getPropertyValue('width'),
          priority: (element as HTMLElement).style.getPropertyPriority('width'),
        }));
        if (!appWide) widgetWidths.set(id, naturalBounds.width);
        else {
          const referenceWidth = widgetWidths.get(id);
          if (referenceWidth === undefined) throw new Error(`${id}: reference width missing`);
          if (Math.abs(naturalBounds.width - referenceWidth) > 1) {
            await widget.evaluate((element, width) => {
              (element as HTMLElement).style.setProperty('width', `${width}px`, 'important');
            }, referenceWidth);
            await page.evaluate(() => new Promise<void>(resolveFrame =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
          }
        }
        current.push(...await widget.evaluate((element, widgetId) => {
          const container = element.getBoundingClientRect();
          const selectors = [
            '[data-role="widget-shell-header"]', '[data-testid="widget-body"]',
            '[data-vehicle-studio]', '[data-vehicle-twin]', '[data-vehicle-twin] > img',
          ];
          const nodes: Array<[string, Element]> = [['widget', element]];
          for (const selector of selectors) {
            const node = element.querySelector(selector);
            if (!node) throw new Error(`${widgetId}: missing ${selector}`);
            nodes.push([selector, node]);
          }
          element.querySelectorAll('[data-app-part~="badge"]').forEach((node, index) => {
            nodes.push([`badge ${index}`, node]);
          });
          return nodes.map(([label, node]) => {
            const box = node.getBoundingClientRect();
            return {
              label: `${widgetId} ${label}`,
              x: box.x - container.x, y: box.y - container.y,
              width: box.width, height: box.height,
              radius: getComputedStyle(node).borderRadius,
            };
          });
        }, id));
        if (appWide) {
          await widget.evaluate((element, original) => {
            const style = (element as HTMLElement).style;
            if (original.value) style.setProperty('width', original.value, original.priority);
            else style.removeProperty('width');
          }, originalWidth);
        }
      }
      measurements.push(current);
      await assertMockApiComplete(page, mocks);
    }

    expect(errors).toEqual([]);
    expect(measurements[0].length).toBeGreaterThanOrEqual(12);
    expect(measurements[1]).toHaveLength(measurements[0].length);
    for (let index = 0; index < selection.length; index += 1) {
      await testInfo.attach(`${selection[index][0]}-widget-only.png`, {
        body: images[index], contentType: 'image/png',
      });
      await testInfo.attach(`${selection[index][0]}-app-wide.png`, {
        body: images[selection.length + index], contentType: 'image/png',
      });
    }
    for (let index = 0; index < measurements[0].length; index += 1) {
      const before = measurements[0][index];
      const after = measurements[1][index];
      expect(after.label).toBe(before.label);
      for (const dimension of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(after[dimension] - before[dimension]), `${before.label} ${dimension}`)
          .toBeLessThanOrEqual(1);
      }
      expect(after.radius, `${before.label} corner treatment`).toBe(before.radius);
    }
    for (let index = 0; index < selection.length; index += 1) {
      await writeFile(paths[index * 2], images[index]);
      await writeFile(paths[index * 2 + 1], images[selection.length + index]);
    }
  });
}
