import { expect, test, type Locator, type Page } from '@playwright/test';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import {
  assertMockApiComplete, expectThemeApplied, installApiMocks, seedBrowserState, waitForHarnessReady,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow, monitorPage,
} from '../qualityAssertions';
import { installExistingBatterySources } from './battery.fixtures';
import {
  assertSleepRetentionLedger, installSleepRetentionSource, sleepRetentionEndpoint,
  sleepRetentionParams, sleepRetentionPath,
} from './battery-sleep-retention.supported.fixtures';

test.describe.configure({ timeout: 90_000 });

const metric = (brief: Locator, key: string) => brief.locator(`[data-operational-metric="${key}"]`);
const noNewObservation = /new observation|newly observed|just observed|observed at|measured at/i;

async function reading(brief: Locator, key: string, value: string, state = 'value') {
  const item = metric(brief, key);
  await expect(item).toHaveAttribute('data-value-state', state);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function transitionOnlyReadings(brief: Locator) {
  await reading(brief, 'sleep-destinations', '10');
  await reading(brief, 'sleep-asleep-count-share', '80.00%');
  await reading(brief, 'sleep-duration-efficiency', '—', 'missing');
  await reading(brief, 'sleep-average-time-to-sleep', '—', 'missing');
  await expect(metric(brief, 'sleep-asleep-count-share')).toContainText('Count-based; not a time share');
  await expect(metric(brief, 'sleep-duration-efficiency')).toContainText('Unavailable pending dwell reconstruction');
  await expect(metric(brief, 'sleep-average-time-to-sleep')).toContainText('Placeholder zero withheld');
}

async function publication(brief: Locator) {
  return brief.locator('[data-operational-metric]').evaluateAll(nodes => nodes.map(node => ({
    key: node.getAttribute('data-operational-metric'),
    state: node.getAttribute('data-value-state'),
    text: node.textContent,
    value: node.querySelector('[data-operational-value]')?.textContent?.trim() ?? '',
    detail: node.lastElementChild?.textContent?.trim() ?? '',
  })));
}

async function reviewRetained(page: Page, brief: Locator) {
  const before = await publication(brief);
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Retained source evidence');
  await expect(drawer).toContainText(/unavailable evidence is never rendered as a measured zero/i);
  await expect(drawer).not.toContainText(noNewObservation);
  for (const row of before) {
    if (row.value) await expect(drawer).toContainText(row.value);
    if (row.detail) await expect(drawer).toContainText(row.detail);
  }
  await expect(drawer).toContainText('80.00%');
  await expect(drawer).toContainText('Unavailable pending dwell reconstruction');
  await expect(drawer).not.toContainText('40.00%');
  await expect(drawer).not.toContainText('75.00%');
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate(node => node.contains(document.activeElement)), 'drawer traps focus').toBe(true);
  }
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await publication(brief), 'review does not republish or replace the retained source').toEqual(before);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`sleep failed global refresh retains count evidence through review then recovers ${width} ${theme}`, async ({ page }) => {
      expect(ROUTE_REGISTRY.some(route => route.path === '/sleep-efficiency'), 'real generated route').toBe(true);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await seedBrowserState(page, theme, sleepRetentionPath);
      const mocks = await installApiMocks(page, 'populated', theme);
      if (!mocks) throw new Error('Sleep retention requires the strict mocked API harness');
      await installExistingBatterySources(page, mocks);
      const source = await installSleepRetentionSource(page, mocks);
      const diagnostics = monitorPage(page);
      await page.goto(sleepRetentionPath);
      await waitForHarnessReady(page, mocks);
      await expectThemeApplied(page, theme);
      await expect(page.getByText(/page failed to load/i)).toHaveCount(0);
      const brief = page.locator('[data-operational-brief][data-testid="sleep-efficiency-evidence"]');
      const refresh = page.locator('[data-role="page-container"] > header')
        .getByRole('button', { name: /^Refresh data/ });
      await expect(refresh).toHaveCount(1);
      await transitionOnlyReadings(brief);
      await expect(brief).toContainText('Available source readings');
      await expect(page.getByTestId('sleep-refresh-error')).toHaveCount(0);
      const initialPublication = await publication(brief);
      const initialScope = await brief.locator('[data-battery-period]').textContent();
      const lastSuccessfulUpdate = await refresh.getAttribute('title');
      expect(lastSuccessfulUpdate).toMatch(/^Last updated:/);
      expect(source.reads.map(read => read.status)).toEqual([200]);
      assertSleepRetentionLedger(mocks, source.reads);

      source.failRefresh();
      const firstFailure = page.waitForResponse(response =>
        new URL(response.url()).pathname === sleepRetentionEndpoint && response.status() === 503);
      await refresh.focus();
      await refresh.press('Enter');
      await firstFailure;
      await transitionOnlyReadings(brief);
      // Keep 503 active until the actual query retry lifecycle reaches retained error.
      const notice = page.getByTestId('sleep-refresh-error');
      await expect(notice).toBeVisible({ timeout: 30_000 });
      await expect(notice).toContainText(
        'Sleep evidence could not refresh. Showing the most recently loaded response and its existing evidence gates.',
      );
      await expect(notice).not.toContainText(noNewObservation);
      await expect(notice.locator('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
      await expect(refresh).toHaveAccessibleName(/^Refresh data.*Error/);
      await expect(refresh).toHaveAttribute('title', lastSuccessfulUpdate!);
      await expect(brief).toContainText('Retained source evidence');
      await expect(brief).not.toContainText('Available source readings');
      await expect(brief).not.toContainText(noNewObservation);
      await expect(page.getByTestId('sleep-query-initial-error')).toHaveCount(0);
      await transitionOnlyReadings(brief);
      expect(await publication(brief), 'failed refresh preserves every published value and evidence gate')
        .toEqual(initialPublication);
      expect(await brief.locator('[data-battery-period]').textContent(), 'request failure is not a new observation')
        .toBe(initialScope);
      await waitForHarnessReady(page, mocks);
      // Each query attempt makes direct + resilient fallback HTTP reads; QueryClient retries once.
      expect(source.reads.map(read => read.status)).toEqual([200, 503, 503, 503, 503]);
      expect(source.reads.slice(1).map(read => read.phase))
        .toEqual(Array(4).fill('failed-refresh'));
      assertSleepRetentionLedger(mocks, source.reads);
      await reviewRetained(page, brief);
      await transitionOnlyReadings(brief);
      await expect(notice).toBeVisible();
      expect(await publication(brief)).toEqual(initialPublication);
      expect(source.reads.map(read => read.status), 'Review details does not retry the source')
        .toEqual([200, 503, 503, 503, 503]);

      source.restore();
      await refresh.focus();
      await refresh.press('Enter');
      await reading(brief, 'sleep-asleep-count-share', '40.00%');
      await reading(brief, 'sleep-duration-efficiency', '75.00%');
      await reading(brief, 'sleep-average-time-to-sleep', '12.00 min');
      await reading(brief, 'sleep-destinations', '10');
      await expect(metric(brief, 'sleep-duration-efficiency')).toContainText('Derived from positive dwell minutes');
      await expect(brief).toContainText('Available source readings');
      await expect(brief).not.toContainText('Retained source evidence');
      await expect(notice).toHaveCount(0);
      await expect(refresh).not.toHaveAccessibleName(/Error/);
      await waitForHarnessReady(page, mocks);
      expect(source.reads.map(read => read.status)).toEqual([200, 503, 503, 503, 503, 200]);
      expect(source.reads[source.reads.length - 1]?.phase).toBe('recovered');
      assertSleepRetentionLedger(mocks, source.reads);
      await expectNoHorizontalOverflow(page);
      expect(diagnostics.pageErrors, 'uncaught page errors').toEqual([]);
      expect(diagnostics.brokenResources, 'broken static resources').toEqual([]);
      expect(diagnostics.failedDataRequests.length, 'the injected failure was observed').toBeGreaterThan(0);
      for (const failure of diagnostics.failedDataRequests) {
        expect(failure).toMatch(/^503 (?:fetch|xhr) /);
        const url = new URL(failure.replace(/^503 (?:fetch|xhr) /, ''));
        expect(url.pathname, 'no unrelated failing data sources').toBe(sleepRetentionEndpoint);
        expect(Object.fromEntries(url.searchParams)).toEqual(sleepRetentionParams);
      }
      for (const error of diagnostics.consoleErrors) {
        expect(error, 'only the intentional HTTP 503 resource diagnostic is allowed')
          .toMatch(/^Failed to load resource: the server responded with a status of 503 \([^)]+\)$/);
      }
      await assertMockApiComplete(page, mocks);
    });
  }
}
