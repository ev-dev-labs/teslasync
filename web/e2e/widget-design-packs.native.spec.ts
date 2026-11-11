import { expect, test } from '@playwright/test';
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { assertContained, compositionGeometry } from './widget-design-packs.acceptance';
import { createReviewPreference, installPackReview, packNames, selectReviewPack } from './widget-design-packs.mock';
import { nativeWidgets } from './widget-design-packs.native.fixtures';
import { installNativeReviewSources } from './widget-design-packs.native.mock';
import {
  inspectCompactSignalCoverage, inspectNativeAchievements, inspectNativeDashboard, inspectNativeFleet, inspectNativeGap,
  inspectNativeMaintenance, inspectNativeMilestones, inspectNativeReadiness, inspectNativeSignals,
} from './widget-design-packs.native';
import { inspectNativeProgressStates, inspectNativeRecordStates } from './widget-design-packs.native-states';

// Same existing 27-pack acceptance budget; no workflow, performance cap or
// ratchet changes. Split substantive families instead of dropping slow states.
test.setTimeout(1_800_000);
test.afterAll(async () => { await closeMockApiFixtures(); });
const families = ['records', 'progress', 'record-states', 'progress-states'] as const;
for (const family of families) {
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [1440, 390]) {
      test(`Native ${family} real routes at ${width}px in ${theme}`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
        const failures: string[] = [];
        page.on('pageerror', error => failures.push(error.message));
        const saved = createReviewPreference();
        saved.app_wide = true;
        const mocks = await installPackReview(page, theme, width, false, nativeWidgets, false, saved,
          info.project.use.baseURL);
        const sources = await installNativeReviewSources(page, mocks, width);
        await page.goto('/');
        await waitForHarnessReady(page, mocks);
        const signatures = new Map<string, Set<string>>();
        const evidence: Record<string, unknown> = {};
        const required = family === 'records'
          ? ['/signal-gaps', '/signals', '/energy-orchestrator', '/milestones', '/lifetime-stats']
          : family === 'progress'
            ? ['/', '/vehicle-comparison?leftId=7&rightId=8', '/maintenance']
          : family === 'record-states'
            ? ['gap-fresh', 'gap-missing-timestamp', 'gap-empty', 'gap-stale',
              'gap-retained-error', 'gap-initial-loading', 'gap-initial-error', 'gap-recovered',
              'trend-initial-loading', 'trend-retained-error', 'trend-0-samples',
              'trend-1-samples', 'trend-initial-error', 'trend-recovered']
            : ['fleet-battery-0', 'fleet-battery-20', 'fleet-battery-21', 'fleet-battery-50',
              'fleet-battery-51', 'fleet-battery--5', 'fleet-battery-125', 'fleet-battery-unknown',
              'mileage-exact-milestone', 'coverage-empty', 'coverage-zero', 'coverage-fresh'];
        try {
          for (const packId of Object.keys(packNames) as PackId[]) {
            await test.step(`${packId} actual native ${family}`, async () => {
              await selectReviewPack(page, packId);
              await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', packId);
              let measured: Record<string, unknown> = {};
              if (family === 'record-states') measured = await inspectNativeRecordStates(page, sources, mocks, packId);
              else if (family === 'progress-states') measured = await inspectNativeProgressStates(page, sources, mocks, width, packId);
              else for (const path of required) {
                sources.setLive('stale');
                sources.setHistory(4);
                await page.goto(path);
                await waitForHarnessReady(page, mocks);
                let surface: unknown;
                if (path === '/') surface = await inspectNativeDashboard(page, packId, info, width);
                else if (path === '/signal-gaps') surface = await inspectNativeGap(page);
                else if (path === '/signals') surface = await inspectNativeSignals(page, sources);
                else if (path === '/energy-orchestrator') surface = await inspectNativeReadiness(page);
                else if (path === '/milestones') surface = await inspectNativeMilestones(page, packId, info);
                else if (path === '/lifetime-stats') surface = await inspectNativeAchievements(page);
                else if (path.startsWith('/vehicle-comparison')) surface = await inspectNativeFleet(page);
                else surface = await inspectNativeMaintenance(page);
                await assertContained(page.locator('main'), `${path} native page has no document overflow`);
                measured[path] = { page: await compositionGeometry(page.locator('body')), surface };
                await page.screenshot({
                  path: info.outputPath(`${packId}-native-${path.replace(/[^a-z0-9]/gi, '-') || 'dashboard'}.png`),
                  fullPage: true, animations: 'disabled',
                });
              }

              evidence[packId] = measured;
              for (const state of required) {
                expect(Object.hasOwn(measured, state), `required native surface ${state}`).toBe(true);
                const values = signatures.get(state) ?? new Set<string>();
                values.add(JSON.stringify(measured[state]));
                signatures.set(state, values);
              }
            });
          }
        } finally { sources.release(); }
        await info.attach(`native-${family}-rendered-geometry.json`, {
          body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
        });
        for (const state of required) {
          expect.soft(signatures.get(state)?.size ?? 0,
            `EXACTLY 27 rendered ${state} compositions at ${width}px/${theme}`).toBe(27);
        }
        expect(failures).toEqual([]);
        // The ONLY added write permission is explicitly intercepted local
        // dashboard preference storage. Vehicle/domain writes remain forbidden.
        expect(mocks.requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
          && !['/api/v1/settings/widget-design-pack', '/api/v1/settings/dashboard-layouts',
            '/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path))).toEqual([]);
        await assertMockApiComplete(page, mocks);
      });
    }
  }
}

test('Native compact signal coverage preserves measured, missing, zero and full readings across designs', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const saved = createReviewPreference();
  saved.app_wide = true;
  const mocks = await installPackReview(page, 'dark', 390, false, nativeWidgets, false, saved,
    info.project.use.baseURL);
  const sources = await installNativeReviewSources(page, mocks, 390);
  const evidence: Record<string, unknown> = {};
  await page.goto('/');
  await waitForHarnessReady(page, mocks);
  try {
    for (const packId of Object.keys(packNames) as PackId[]) {
      await test.step(`${packId} compact coverage quantitative states`, async () => {
        await selectReviewPack(page, packId);
        const states: Record<string, unknown> = {};
        for (const [mode, percentage] of [['stale', 14], ['empty', null], ['zero', 0], ['fresh', 100]] as const) {
          sources.setLive(mode);
          await page.goto('/');
          await waitForHarnessReady(page, mocks);
          await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', packId);
          const health = page.locator('[data-widget-id="pack-review-signal-health"]');
          states[mode] = await inspectCompactSignalCoverage(health, packId, percentage);
          await assertContained(health, `${packId}/${mode} compact coverage stays inside its widget and viewport`);
        }
        evidence[packId] = states;
      });
    }
  } finally { sources.release(); }
  await info.attach('compact-coverage-quantitative-states.json', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  expect(Object.keys(evidence)).toHaveLength(27);
  expect(failures).toEqual([]);
  expect(mocks.requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    && !['/api/v1/settings/widget-design-pack', '/api/v1/settings/dashboard-layouts',
      '/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path))).toEqual([]);
  await assertMockApiComplete(page, mocks);
});
