import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { createReviewPreference, installGeofenceReviewSources, installPackReview, packNames, selectReviewPack } from './widget-design-packs.mock';
import { assertContained, assertOwnerGuardActivation, assertPlotAndMap, assertTableNoMatchContained, compositionGeometry, inspectNestedDialog, inspectPortaledIsolation, inspectPreviewInteractions, isolationAppearance, profileAttributes } from './widget-design-packs.acceptance';
import { getAppDesignAttributes } from '../src/components/ui/app-designs/designs';
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types';
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
    const bounds = element.getBoundingClientRect();
    const length = element.getTotalLength();
    return {
      width: bounds.width, height: bounds.height,
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
  await preview.evaluate(element => element.removeAttribute('data-app-data'));
  await expect(preview).not.toHaveAttribute('data-app-design-owner');
  await expect(preview.locator('[data-app-design-owner]')).toHaveCount(0);
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
      await expect(page.locator(`[${attribute}]`), `neutral document retains no ${attribute} on stale local/portal targets`).toHaveCount(0);
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

// Keep the original four desktop/mobile + light/dark cases, plus saved custom
// appearance/font/unit preferences. Pack switching is
// in-place; real pages load once per route, width sweeps reuse each open preview.
for (const theme of ['dark', 'light', 'custom'] as const) {
  for (const width of [1440, 390]) {
    test(`Application design languages at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
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
      for (const publicPath of publicPaths) {
        await page.goto(publicPath);
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
      const routeEvidence: Record<string, unknown> = {};
      const routeCollisions: Record<string, PackId[][]> = {};
      for (const path of ['/', '/drives', ...specializedReviewRoutes, '/geofences', '/settings']) {
        energySources.setActive(path === energyReviewPath);
        const routeSignatures = new Map<string, PackId[]>();
        await page.goto(path);
        await waitForHarnessReady(page, mocks);
        for (const packId of packIds) {
          await test.step(`${packId} real ${path}`, async () => {
            await selectReviewPack(page, packId);
            await expectProfile(page, packId);
            await expect(page.locator('[data-app-part~="workspace-header"]')).toBeVisible();
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
      const widths = width === 390 ? [320, 375, 390, 430] : [768, 1024, 1280, 1440, 1920, 2560];
      const signatures = new Map<number, Map<string, PackId[]>>(widths.map(value => [value, new Map()]));
      const geometryEvidence: Record<string, unknown> = {};
      const familyEvidence: Record<string, unknown> = {};
      for (const packId of packIds) {
        await test.step(`${packId} full synthetic preview`, async () => {
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
          await inspectPreviewInteractions(page, preview, testInfo, packId);
          const nativeAndRetained = await inspectRetainedAndNativeControls(preview);
          await auditPreview(page, testInfo, `${packId}-axe-preview.json`);
          for (const allocatedWidth of widths) {
            await page.setViewportSize({ width: allocatedWidth, height: 1000 });
            await preview.locator('[data-preview-section="map"]').scrollIntoViewIfNeeded();
            await expect.poll(() => preview.locator('.leaflet-container').evaluate(element => element.clientWidth)).toBeGreaterThan(80);
            await assertContained(dialog, `${packId} ${allocatedWidth} dialog`);
            await assertContained(preview, `${packId} ${allocatedWidth} preview`);
            await assertPlotAndMap(preview);
            const composition = await compositionGeometry(preview);
            const nested = await inspectNestedDialog(page, preview, allocatedWidth === width
              ? { testInfo, file: `${packId}-nested-dialog.png` } : undefined);
            const signature = JSON.stringify({ composition, nested });
            const cluster = signatures.get(allocatedWidth)!;
            cluster.set(signature, [...(cluster.get(signature) ?? []), packId]);
            geometryEvidence[`${packId}:${allocatedWidth}:default`] = { composition, nested };
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
              const enlargedFont = await preview.getByRole('textbox', { name: /Sample view name/ })
                .evaluate(element => parseFloat(getComputedStyle(element).fontSize));
              expect(enlargedFont).toBeGreaterThanOrEqual(normalFont * 1.9);
              geometryEvidence[`${packId}:${allocatedWidth}:rtl-200-${density}`] = {
                composition: await compositionGeometry(preview), nested: await inspectNestedDialog(page, preview),
              };
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
          for (const section of ['overview', 'chart', 'map', 'table', 'form', 'feedback', 'widgets']) {
            await preview.locator(`[data-preview-section="${section}"]`).screenshot({
              path: testInfo.outputPath(`${packId}-${section}.png`), animations: 'disabled',
            });
          }
          await page.emulateMedia({ forcedColors: 'active' });
          expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
            'forced-colors evidence requires actual media emulation, not an ignored request').toBe(true);
          await assertContained(preview, `${packId} forced colors`);
          await inspectNestedDialog(page, preview);
          const forcedTable = preview.locator('[data-preview-section="chart"]')
            .getByRole('table', { name: 'Sample battery trace — data table' });
          await expect(forcedTable).toBeVisible();
          await page.emulateMedia({ forcedColors: 'none' });
          const measured = await compositionGeometry(preview);
          const measurements: Record<typeof acceptanceFamilies[number], unknown> = {
            'shell-navigation': await compositionGeometry(preview.locator('[data-app-part~="shell"]')),
            'page-composition': measured,
            'controls-forms': await compositionGeometry(preview.locator('[data-preview-section="form"]')),
            'tables-lists': {
              ledger: await compositionGeometry(preview.locator('[data-preview-section="table"]')),
              definitions: await compositionGeometry(preview.locator('[data-preview-section="overview"] dl')),
            },
            'dialogs-popovers': Object.fromEntries(widths.map(value => [
              value, geometryEvidence[`${packId}:${value}:default`],
            ])),
            'metrics-timelines': await compositionGeometry(preview.locator('[data-preview-section="overview"]')),
            'charts-gauges': {
              composition: await compositionGeometry(preview.locator('[data-preview-section="chart"]')),
              quantitative: nativeAndRetained.quantitative,
            },
            'maps-geofences': {
              composition: await compositionGeometry(preview.locator('[data-preview-section="map"]')),
              geofenceDraft: routeEvidence[`/geofences:${packId}`],
            },
            'feedback-all-states': {
              composition: await compositionGeometry(preview.locator('[data-preview-section="feedback"]')),
              retained: nativeAndRetained,
            },
            'responsive-accessibility': {
              widths: Object.fromEntries(Object.entries(geometryEvidence).filter(([key]) => key.startsWith(`${packId}:`))),
              axe: `${packId}-axe-preview.json`, forcedColors: true,
            },
            'real-page-adoption': Object.fromEntries(Object.entries(routeEvidence).filter(([key]) => key.endsWith(`:${packId}`))),
            'distinct-rendered-identity': Object.fromEntries(widths.map(value => [
              value, geometryEvidence[`${packId}:${value}:default`],
            ])),
          };
          familyEvidence[packId] = {
            families: Object.fromEntries(acceptanceFamilies.map(family => [family, {
              status: 'observed-not-certified',
              evidence: measurements[family],
            }])),
          };
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
      await testInfo.attach('real-page-compositions.json', { body: JSON.stringify(routeEvidence, null, 2), contentType: 'application/json' });
      await testInfo.attach('preview-compositions.json', { body: JSON.stringify(geometryEvidence, null, 2), contentType: 'application/json' });
      await testInfo.attach('preview-identity-collisions.json', {
        body: JSON.stringify(Object.fromEntries([...signatures].map(([value, clusters]) => [
          value, [...clusters.values()].filter(group => group.length > 1),
        ])), null, 2), contentType: 'application/json',
      });
      await testInfo.attach('acceptance-family-observations.json', {
        body: JSON.stringify({ claim: 'Measured mocked UI evidence only. Final runner assertions and visual review remain authoritative.',
          expectedCells: packIds.length * acceptanceFamilies.length, observations: familyEvidence }, null, 2),
        contentType: 'application/json',
      });
      for (const [allocatedWidth, distinct] of signatures) {
        expect.soft(distinct.size, `EXACTLY 27 rendered layout signatures at ${allocatedWidth}px/${theme}`).toBe(27);
      }
      expect(mocks.requests.slice(requestStart).filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method))).toEqual([]);
      expect(mocks.requests.filter(request => /\/commands?(?:\/|$)/.test(request.path) && request.method !== 'GET')).toEqual([]);
      await picker.getByRole('combobox', { name: 'Apply design to', exact: true }).selectOption('app');
      await expectProfile(page, saved.pack_id);
      const after = await preservedPreferences(page);
      expect(after.variables).toEqual(preferences.variables);
      expect(after.density).toEqual(preferences.density);
      const isolated: Record<string, unknown> = {};
      const incomplete: Record<string, unknown> = {};
      const outer: Record<string, unknown> = {};
      for (const outerPack of ['memphis', 'blueprint'] as const) {
        await selectReviewPack(page, outerPack);
        await expectProfile(page, outerPack);
        outer[outerPack] = await isolationAppearance(page.locator('[data-app-part~="workspace-header"]'));
        const outerBefore = await preservedPreferences(page);
        await picker.getByRole('button', { name: 'Preview Quiet Form', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Preview Quiet Form', exact: true });
        const preview = dialog.locator('[data-preview-synthetic="true"]');
        await expect(preview).toBeVisible();
        await assertPlotAndMap(preview);
        await assertOwnerGuardActivation(preview);
        await expectProfile(page, outerPack);
        const inline = await isolationAppearance(preview);
        const portaled = await inspectPortaledIsolation(page, preview);
        isolated[outerPack] = { inline, portaled };
        incomplete[outerPack] = await inspectIncompletePreview(page, preview);
        await dialog.screenshot({ path: testInfo.outputPath(`quiet-inside-${outerPack}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expectProfile(page, outerPack);
        expect(await preservedPreferences(page)).toEqual(outerBefore);
      }
      await testInfo.attach('mixed-pack-isolation.json', { body: JSON.stringify({ isolated, incomplete, outer }, null, 2), contentType: 'application/json' });
      expect(isolated.memphis, 'Quiet inline and real open portals are independent of outer application pack')
        .toEqual(isolated.blueprint);
      expect(outer.memphis, 'outer shell keeps its own visibly different design').not.toEqual(outer.blueprint);
      expect(incomplete.memphis, 'an incomplete real preview and its body portals remain neutral under either outer pack')
        .toEqual(incomplete.blueprint);
      await page.reload();
      await waitForHarnessReady(page, mocks);
      await expectProfile(page, saved.pack_id);
      for (const publicPath of publicPaths) {
        // Client navigation deliberately retains the already-loaded design CSS.
        await page.evaluate(path => {
          history.pushState(null, '', path);
          dispatchEvent(new PopStateEvent('popstate'));
        }, publicPath);
        await waitForHarnessReady(page, mocks);
        await expectNeutral(page, true);
        expect(await isolationAppearance(page.locator('body')), `${publicPath} keeps its actual neutral rendering`)
          .toEqual(neutralBefore[publicPath]);
      }
      expect(mocks.requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        && !['/api/v1/settings/widget-design-pack', '/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path))).toEqual([]);
      expect(failures).toEqual([]);
      await assertMockApiComplete(page, mocks);
    });
  }
}
