import { expect, test, type Locator, type Page } from '@playwright/test';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import {
  assertMockApiComplete, expectThemeApplied, installApiMocks,
  seedBrowserState, waitForHarnessReady, type MockApiController,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow, expectNoRuntimeFailures,
  monitorPage,
} from '../qualityAssertions';
import {
  ADVISOR_NOW, ADVISOR_PATH, absentAdvisorLive, advisorMeanEndSoc,
  advisorReserveExpectations, freshAdvisorLive, installSupportedAdvisorSources,
} from './battery-charge-advisor.supported.fixtures';

test.describe.configure({ timeout: 90_000 });

type Theme = 'light' | 'dark';

function kpis(page: Page) {
  return page.getByTestId('charge-advisor-kpis').locator('[data-operational-brief]');
}

async function reading(brief: Locator, key: string, value: string) {
  const metric = brief.locator(`[data-operational-metric="${key}"]`);
  await expect(metric).toHaveAttribute('data-value-state', 'value');
  await expect(metric.locator('[data-operational-value]')).toHaveText(value);
}

async function review(page: Page, brief: Locator, scope: RegExp) {
  const before = await brief.locator('[data-operational-metric]').allTextContents();
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(scope);
  for (const value of await brief.locator('[data-operational-value]').allTextContents()) {
    if (value.trim()) await expect(drawer).toContainText(value.trim());
  }
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await expectDialogsInsideViewport(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await brief.locator('[data-operational-metric]').allTextContents()).toEqual(before);
}

async function setup(page: Page, theme: Theme, width: number, batteryPct: number) {
  expect(ROUTE_REGISTRY.some(route => route.path === '/charge-advisor')).toBe(true);
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  // Freeze Date only; keep request settlement, animations and the real SSE harness running.
  await page.clock.setFixedTime(new Date(ADVISOR_NOW));
  await seedBrowserState(page, theme, ADVISOR_PATH);
  const mocks = await installApiMocks(page, 'populated', theme);
  if (!mocks) throw new Error('Supported advisor contracts require the strict mocked API harness');
  let live = freshAdvisorLive(batteryPct);
  await installSupportedAdvisorSources(page, mocks, theme, () => live);
  return { mocks, omitLive: () => { live = absentAdvisorLive; } };
}

async function ready(page: Page, mocks: MockApiController, theme: Theme) {
  await page.goto(ADVISOR_PATH);
  await waitForHarnessReady(page, mocks);
  await expectThemeApplied(page, theme);
  await expect(page.getByText(/page failed to load/i)).toHaveCount(0);
}

async function historicalEvidence(page: Page) {
  const summary = kpis(page);
  await reading(summary, 'advisor-drive-evidence', '8');
  await reading(summary, 'advisor-daily-drop', '5.00%');
  await reading(summary, 'advisor-charging-evidence', '0');
  await expect(summary).toContainText('Evidence gate passed');
  await expect(summary).toContainText('8 active local days · 5 active weeks');
  const support = page.getByTestId('charge-advisor-support');
  await expect(support.getByText('29 days', { exact: true })).toBeVisible();
  await expect(support.getByText('50.00%', { exact: true })).toBeVisible();
  await expect(support.getByText('moderate', { exact: true })).toBeVisible();
  await expect(support.getByText('Met', { exact: true })).toBeVisible();
  const distribution = page.getByTestId('charge-advisor-distribution');
  await expect(distribution.getByText('5.00%', { exact: true })).toHaveCount(6);
  await expect(distribution).toContainText('8 active local days in the distribution');
  const accounting = page.getByTestId('charge-advisor-accounting');
  for (const [source, title, count] of [
    ['drive', 'Drive-row evidence summary', '8'],
    ['charging', 'Charging-row evidence summary', '0'],
  ] as const) {
    const brief = accounting.locator('[data-operational-brief]').filter({
      has: page.getByRole('heading', { name: title, exact: true }),
    });
    for (let index = 0; index < 3; index++) {
      await reading(brief, `advisor-${source}-accounting-${index}`, count);
    }
  }
  await expect(accounting).toContainText('2025-12-05');
  await expect(accounting).toContainText('2026-06-02');
  await expect(accounting).toContainText('UTC');
  const categories = accounting.locator('.space-y-1');
  await expect(categories).toHaveCount(2);
  for (const [index, expected] of [
    [0, ['8', '0', '0', '0', '0', '0', '0', '0', '0', '0']],
    [1, ['0', '0', '0', '0', '0', '0', '0', '0']],
  ] as const) {
    expect(await categories.nth(index).locator(':scope > div > span:last-child').allTextContents()).toEqual(expected);
  }
}

async function sensitivity(page: Page) {
  const panel = page.getByTestId('charge-advisor-sensitivity');
  await expect(panel.locator('article')).toHaveCount(3);
  for (const expected of advisorReserveExpectations) {
    const card = panel.locator('article').filter({
      has: page.getByText(`${expected.floor}.00%`, { exact: true }),
    });
    await expect(card).toHaveCount(1);
    for (const [label, days] of [
      ['Mean path', expected.meanDays], ['Calendar-day p75', expected.p75Days],
    ] as const) {
      const cell = card.getByText(label, { exact: true }).locator('..');
      await expect(cell).toContainText(days == null ? '—' : `${days} days`);
    }
  }
}

async function finish(page: Page, mocks: MockApiController, diagnostics: ReturnType<typeof monitorPage>) {
  for (const request of [
    'GET /drives?vehicle_id=7&limit=1000',
    'GET /charging?vehicle_id=7&limit=1000',
    'GET /signals/7/live',
  ]) expect(mocks.seen.has(request), request).toBe(true);
  await expectNoHorizontalOverflow(page);
  await expectNoRuntimeFailures(diagnostics);
  await assertMockApiComplete(page, mocks);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`qualified charge history retains exact reserve-floor sensitivity ${width} ${theme}`, async ({ page }) => {
      const { mocks } = await setup(page, theme, width, 21);
      const diagnostics = monitorPage(page);
      await ready(page, mocks, theme);
      await historicalEvidence(page);
      await reading(kpis(page), 'advisor-current-soc', '21.00%');
      const current = page.getByTestId('charge-advisor-current');
      await expect(current.getByText('Live signal', { exact: true })).toBeVisible();
      await expect(current.getByText('Fresh', { exact: true })).toBeVisible();
      await expect(current.getByText('0.00 days', { exact: true })).toBeVisible();
      await expect(current).toContainText('Jun 2, 2026');
      await expect(current).toContainText('12:00 PM');
      await expect(current).toContainText('Charge limit 80.00%');
      await expect(current.getByText('Not charging', { exact: true })).toBeVisible();
      await sensitivity(page);
      const directory = page.getByTestId('charge-advisor-directory');
      await expect(directory.locator('article')).toHaveCount(7);
      for (const [index, soc] of advisorMeanEndSoc.entries()) {
        const day = directory.locator('article').nth(index);
        await expect(day).toContainText(`2026-06-${String(index + 3).padStart(2, '0')}`);
        await expect(day.getByText('Mean end SoC', { exact: true }).locator('..')).toContainText(soc);
        await expect(day.getByText('Calendar-day p75', { exact: true }).locator('..')).toContainText('0.00%');
      }
      for (const expected of advisorReserveExpectations) {
        await page.getByLabel('Reserve floor', { exact: true }).selectOption(String(expected.floor));
        await reading(kpis(page), 'advisor-guidance', expected.guidance);
        await historicalEvidence(page);
        await reading(kpis(page), 'advisor-current-soc', '21.00%');
        await sensitivity(page);
        const selected = page.getByTestId('charge-advisor-sensitivity').locator('article').filter({
          has: page.getByText(`${expected.floor}.00%`, { exact: true }),
        });
        await expect(selected.getByText('Selected', { exact: true })).toBeVisible();
      }
      await review(page, kpis(page), /current SoC is a separate observed snapshot/i);
      const accounting = page.getByTestId('charge-advisor-accounting');
      for (const title of ['Drive-row evidence summary', 'Charging-row evidence summary']) {
        await review(page, accounting.locator('[data-operational-brief]').filter({
          has: page.getByRole('heading', { name: title, exact: true }),
        }), /Counts are not lifetime totals/i);
      }
      await finish(page, mocks, diagnostics);
    });

    test(`fresh measured zero differs from absent live and stale fallback without losing qualified history ${width} ${theme}`, async ({ page }) => {
      const { mocks, omitLive } = await setup(page, theme, width, 0);
      const diagnostics = monitorPage(page);
      await ready(page, mocks, theme);
      await historicalEvidence(page);
      await reading(kpis(page), 'advisor-current-soc', '0.00%');
      await reading(kpis(page), 'advisor-guidance', 'Charge before next use');
      const current = page.getByTestId('charge-advisor-current');
      await expect(current.getByText('Live signal', { exact: true })).toBeVisible();
      await expect(current.getByText('Fresh', { exact: true })).toBeVisible();
      await expect(current.getByText('0.00 days', { exact: true })).toBeVisible();
      await expect(current).toContainText('Jun 2, 2026');
      await expect(current).toContainText('12:00 PM');
      const zeroDays = page.getByTestId('charge-advisor-directory').locator('article');
      await expect(zeroDays).toHaveCount(7);
      for (const day of await zeroDays.all()) {
        await expect(day.getByText('Mean end SoC', { exact: true }).locator('..')).toContainText('0.00%');
      }
      for (const card of await page.getByTestId('charge-advisor-sensitivity').locator('article').all()) {
        await expect(card.getByText('0 days', { exact: true })).toHaveCount(2);
      }
      await review(page, kpis(page), /current SoC is a separate observed snapshot/i);
      omitLive();
      // New document, same frozen analysis date and histories; not a refresh-retention claim.
      await ready(page, mocks, theme);
      await historicalEvidence(page);
      await reading(kpis(page), 'advisor-current-soc', '65.00%');
      await reading(kpis(page), 'advisor-guidance', 'Current state is stale');
      await expect(kpis(page)).toContainText('Displayed as stale; guidance is blocked');
      await expect(current.getByText('Completed drive end', { exact: true })).toBeVisible();
      await expect(current.getByText('Stale', { exact: true })).toBeVisible();
      await expect(current.getByText('4.10 days', { exact: true })).toBeVisible();
      await expect(current).toContainText('May 29, 2026');
      await expect(current).toContainText('09:30 AM');
      await expect(current).toContainText('Charge limit —');
      await expect(current.getByText('Unavailable', { exact: true })).toBeVisible();
      await expect(current.getByText('Fresh', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('charge-advisor-directory').locator('article')).toHaveCount(7);
      await expect(
        page.getByTestId('charge-advisor-directory').locator('article').last()
          .getByText('Mean end SoC', { exact: true }).locator('..'),
      ).toContainText('63.46%');
      for (const card of await page.getByTestId('charge-advisor-sensitivity').locator('article').all()) {
        for (const label of ['Mean path', 'Calendar-day p75']) {
          await expect(card.getByText(label, { exact: true }).locator('..')).toContainText('—');
        }
      }
      await review(page, kpis(page), /current SoC is a separate observed snapshot/i);
      await finish(page, mocks, diagnostics);
    });
  }
}
