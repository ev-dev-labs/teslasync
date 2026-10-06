import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertMockApiComplete, waitForHarnessReady } from '../mockApi';
import {
  expectDialogsInsideViewport, expectIntegratedGridFooter, expectNoHorizontalOverflow, monitorPage,
} from '../qualityAssertions';
import {
  activityReport, deliveryRows, INBOX_ROUTE, installNotificationFixtures,
} from './notifications.fixtures';

test.use({ timezoneId: 'UTC' });

async function metric(brief: Locator, key: string, value: string, state: 'value' | 'missing' = 'value') {
  const cell = brief.locator(`[data-operational-metric="${key}"]`);
  await expect(cell).toHaveAttribute('data-value-state', state);
  await expect(cell.locator('[data-operational-value]')).toHaveText(value);
  return cell;
}

async function briefMarker(page: Page, testId: string) {
  const brief = page.getByTestId(testId);
  await expect(brief).toBeVisible();
  await expect(brief).toHaveAttribute('data-operational-brief', '');
  return brief;
}

async function review(page: Page, brief: Locator, title: string, preserved: readonly string[]) {
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: `${title} details`, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  for (const text of preserved) await expect(drawer).toContainText(text);
  const close = drawer.locator('[data-drawer-header]').getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeFocused();
  if (title === 'Rule noise and engagement') {
    await drawer.getByRole('button', { name: 'More info about fatiguing rules', exact: true }).focus();
    await expect(page.getByRole('tooltip')).toContainText('The noise score blends three things');
    await close.focus();
  }
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test.describe(`${width}px ${theme} notification Brief source contracts`, () => {
      test.beforeEach(async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
      });

      test('bounded active sample, loaded page, server total and full period stay distinct', async ({ page }) => {
        const diagnostics = monitorPage(page);
        const { mocks, ledger } = await installNotificationFixtures(page, theme, INBOX_ROUTE);
        await page.goto(INBOX_ROUTE);
        await waitForHarnessReady(page, mocks);
        const backlog = await briefMarker(page, 'notification-backlog-brief');
        await metric(backlog, 'inbox-total', '50');
        await metric(backlog, 'inbox-unread', '25');
        await metric(backlog, 'inbox-critical', '13');
        await metric(backlog, 'inbox-warn', '13');
        await metric(backlog, 'inbox-info', '12');
        await expect(backlog).toContainText('25 of 50');
        await expect(backlog).toContainText('12 with unknown severity');
        await expect(backlog).toContainText('Latest 50 active entries · all time');
        await expect(page.getByTestId('inbox-result-count')).toHaveText('83 notifications');
        const table = page.locator('main').getByRole('table', { name: 'Inbox', exact: true });
        await expect(table.getByRole('button', { name: /^Open notification:/ })).toHaveCount(25);
        await expectIntegratedGridFooter(table);
        const report = await briefMarker(page, 'notification-report-brief');
        await metric(report, 'report-triggered', '120');
        await metric(report, 'report-deliveries', '310');
        await metric(report, 'report-fanout', '2.50');
        await metric(report, 'report-uncorrelated', '10');
        await metric(report, 'report-http', '401');
        await expect(report).toContainText('(exclusive) · UTC');
        const request = ledger.find(entry => entry.path === '/notifications/report');
        expect(request).toBeDefined();
        await expect(report).toContainText(request!.params.get('from_instant')!);
        await expect(report).toContainText(request!.params.get('to_exclusive')!);
        await review(page, backlog, 'Backlog severity and read status', [
          '25 of 50', '12 with unknown severity', 'Latest 50 active entries · all time',
          'not the workspace period or the server total',
        ]);
        await review(page, report, 'Triggers, linked deliveries, and outbound calls', [
          'Triggers recorded', '120', '2.50', 'retries and failures', '(exclusive) · UTC',
        ]);
        const frame = table.locator('xpath=ancestor::*[@data-grid-frame][1]');
        const search = frame.getByPlaceholder('Search messages…', { exact: true });
        await search.fill('notification 83');
        await expect.poll(() => ledger.some(entry => entry.params.get('q') === 'notification 83')).toBe(true);
        await expect(table.getByRole('button', { name: /^Open notification:/ })).toHaveCount(1);
        await expect(page.getByTestId('inbox-result-count')).toHaveText('1 notifications');
        await metric(backlog, 'inbox-total', '50');
        await metric(report, 'report-triggered', '120');
        await expect(frame.getByRole('button', { name: 'Export list', exact: true })).toBeVisible();
        await expect(frame.getByRole('button', { name: 'Reorder or hide columns' })).toBeVisible();
        await expect(page.locator('main').getByRole('link', { name: 'View archived', exact: true }))
          .toHaveAttribute('href', '/notifications/archived');
        await search.fill('');
        await expect(table.getByRole('button', { name: /^Open notification:/ })).toHaveCount(25);
        const column = width < 768 ? 'Notification' : 'Severity';
        await table.getByRole('button', { name: `${column} filter`, exact: true }).click();
        const filter = page.getByRole('dialog', { name: `${column} filter`, exact: true });
        await filter.getByRole('button', { name: 'Warn', exact: true }).click();
        await filter.getByRole('button', { name: 'Done', exact: true }).click();
        await expect.poll(() => ledger.some(entry => entry.params.get('severity') === 'warn')).toBe(true);
        await expect(page.getByTestId('inbox-result-count')).toHaveText('21 notifications');
        await metric(backlog, 'inbox-warn', '13');
        await expectNoHorizontalOverflow(page);
        expect(diagnostics.pageErrors).toEqual([]);
        await assertMockApiComplete(page, mocks);
      });

      test('archived sample preserves normalization, read denominator and restore inspection', async ({ page }) => {
        const path = '/notifications/archived?view=flat&size=25';
        const { mocks } = await installNotificationFixtures(page, theme, path);
        await page.goto(path);
        await waitForHarnessReady(page, mocks);
        const brief = await briefMarker(page, 'notification-backlog-brief');
        await metric(brief, 'inbox-total', '50');
        await metric(brief, 'inbox-unread', '25');
        await metric(brief, 'inbox-critical', '13');
        await expect(brief).toContainText('Latest 50 archived entries · all time');
        await review(page, brief, 'Backlog severity and read status', [
          'Latest 50 archived entries · all time', '25 of 50', 'Last archived',
        ]);
        const table = page.locator('main').getByRole('table', { name: 'Archived', exact: true });
        await table.getByRole('button', { name: 'Open notification: Synthetic archived notification 1', exact: true }).click();
        const detail = page.getByRole('dialog', { name: 'Synthetic archived notification 1', exact: true });
        await expect(detail).toContainText('Recorded synthetic evidence; no inferred delivery timestamp.');
        await expect(detail.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('delivery countTotal is configured channels, not a success percentage', async ({ page }) => {
        const { mocks } = await installNotificationFixtures(page, theme, '/notifications/channels');
        await page.goto('/notifications/channels');
        await waitForHarnessReady(page, mocks);
        const brief = await briefMarker(page, 'notification-channel-brief');
        await metric(brief, 'channels-sent', '17');
        await metric(brief, 'channels-failed', '0');
        await metric(brief, 'channels-pending', '3');
        await metric(brief, 'channels-active', '2/5');
        await review(page, brief, 'Delivery channels and recorded outcomes', [
          '2/5', 'Delivery counts have no reported time bounds', 'configured enabled/total count',
        ]);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('rules statistics precede table filters and snoozes overlap enabled rules', async ({ page }) => {
        const { mocks } = await installNotificationFixtures(page, theme, '/notifications/rules');
        await page.goto('/notifications/rules');
        await waitForHarnessReady(page, mocks);
        const brief = await briefMarker(page, 'alert-rules-brief');
        for (const [key, value] of [
          ['rules-total', '4'], ['rules-enabled', '3'], ['rules-disabled', '1'],
          ['rules-critical', '1'], ['rules-snoozed', '1'], ['rules-computed', '1'],
        ]) await metric(brief, key, value);
        await review(page, brief, 'Rule configuration and current snoozes', [
          'All loaded rules · before filters', 'Snoozed rules can overlap enabled or disabled rules',
        ]);
        await page.getByPlaceholder('Search rules...', { exact: true }).fill('Synthetic rule 4');
        await metric(brief, 'rules-total', '4');
        await expect(page.locator('main').getByRole('link', { name: 'Synthetic rule 4', exact: true }))
          .toHaveAttribute('href', '/notifications/rules?rule=74');
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('quiet schedules preserve countTotal, live local policy and enabled-only bypass', async ({ page }) => {
        const { mocks } = await installNotificationFixtures(page, theme, '/notifications/quiet-hours');
        await page.goto('/notifications/quiet-hours');
        await waitForHarnessReady(page, mocks);
        const brief = await briefMarker(page, 'quiet-hours-brief');
        await metric(brief, 'quiet-windows', '2');
        await metric(brief, 'quiet-enabled', '1/2');
        await metric(brief, 'quiet-now', 'Quiet');
        await metric(brief, 'quiet-bypass', 'critical');
        await review(page, brief, 'Schedules, delivery status, and bypass policy', [
          '1/2', '1 window active now', 'Configured schedules · right now', 'local weekday and time',
        ]);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('health keeps SI seconds rendered as ms, measured zero, derived samples and SLO eligibility', async ({ page }) => {
        const path = '/notifications/health#latency';
        const { mocks } = await installNotificationFixtures(page, theme, path);
        await page.goto(path);
        await waitForHarnessReady(page, mocks);
        const latency = await briefMarker(page, 'notification-latency-brief');
        await metric(latency, 'latency-p50', '1,000.00 ms');
        await metric(latency, 'latency-p95', '1,900.00 ms');
        await metric(latency, 'latency-p99', '1,980.00 ms');
        await metric(latency, 'latency-apdex', '0.750');
        await review(page, latency, 'Delivery speed, tail latency, and Apdex', [
          'trimmed mean 1,000.00 ms', '2 measured deliveries', 'T = 1 s · tolerating through 4 s',
          'not a guaranteed complete analysis window',
        ]);
        const burn = await briefMarker(page, 'notification-burn-rate-brief');
        await metric(burn, 'burn-delivery', '66.67%');
        await metric(burn, 'burn-short', '33.33×');
        await metric(burn, 'burn-long', '33.33×');
        await review(page, burn, 'Delivery reliability and error budget', [
          '1 failed · 2 sent', '1 deferred by DND', 'Deferred DND and pending attempts are excluded.',
        ]);
        const fatigue = await briefMarker(page, 'alert-fatigue-brief');
        await metric(fatigue, 'fatigue-rules', '0');
        await metric(fatigue, 'fatigue-ignored', '50%');
        await review(page, fatigue, 'Rule noise and engagement', [
          'of 3 rules', 'of notifications with read tracking', 'not a complete requested analysis period',
          'A rule can be low-volume and still fatiguing if every firing comes in a cluster of six.',
        ]);
        await expect(page.getByRole('navigation', { name: 'Notification health sections' }).getByRole('link')).toHaveCount(3);
        await expect(page.locator('#latency')).toContainText('Synthetic measured delivery');
        await expect(page.locator('#latency')).toContainText('Synthetic derived delivery');
        await expect(page.locator('#latency')).toContainText('Measured');
        await expect(page.locator('#latency')).toContainText('Derived');
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('first report load is genuinely busy and cannot publish placeholder zeros', async ({ page }) => {
        let release: () => void = () => { throw new Error('Report gate not initialized'); };
        const reportGate = new Promise<void>(resolve => { release = resolve; });
        const { mocks } = await installNotificationFixtures(page, theme, INBOX_ROUTE, { reportGate });
        try {
          await page.goto(INBOX_ROUTE, { waitUntil: 'domcontentloaded' });
          const brief = await briefMarker(page, 'notification-report-brief');
          await expect(brief).toHaveAttribute('aria-busy', 'true');
          await expect(brief.locator('[data-operational-metric]')).toHaveCount(5);
          await expect(brief.locator('[data-operational-value]')).toHaveCount(0);
        } finally {
          release();
        }
        await waitForHarnessReady(page, mocks);
        const brief = await briefMarker(page, 'notification-report-brief');
        await metric(brief, 'report-triggered', '120');
        await expect(brief).not.toHaveAttribute('aria-busy', 'true');
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('browser counts follow real in-tab and sound master controls without inventing delivery health', async ({ page }) => {
        const { mocks } = await installNotificationFixtures(page, theme, '/notifications/browser');
        await page.context().grantPermissions(['notifications']);
        await page.goto('/notifications/browser');
        await waitForHarnessReady(page, mocks);
        const brief = await briefMarker(page, 'browser-notifications-brief');
        await metric(brief, 'browser-permission', 'Enabled');
        await metric(brief, 'browser-push', '1/2');
        await metric(brief, 'browser-tab', '1/2');
        await metric(brief, 'browser-sounds', '0/7');
        await review(page, brief, 'Permission and enabled notification surfaces', [
          '1 of 2 on', '0 of 7 on', 'This browser · saved tab settings',
          'configuration counts, not delivery success rates',
        ]);
        await page.getByRole('switch', { name: 'Enable notification sounds', exact: true }).click();
        await metric(brief, 'browser-sounds', '3/7');
        await page.getByRole('switch', { name: 'Alerts', exact: true }).click();
        await metric(brief, 'browser-push', '0/2');
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test.describe(`${width}px ${theme} notification source states`, () => {
      test.beforeEach(async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
      });
      test.afterEach(async ({ page }) => {
        await expectNoHorizontalOverflow(page);
      });

test('report zero counts are valid but zero-denominator fanout and absent source remain missing', async ({ page }) => {
  const { mocks } = await installNotificationFixtures(page, theme, INBOX_ROUTE, {
    emptyBacklog: true, report: activityReport(true),
  });
  await page.goto(INBOX_ROUTE);
  await waitForHarnessReady(page, mocks);
  const brief = await briefMarker(page, 'notification-report-brief');
  for (const key of ['report-triggered', 'report-deliveries', 'report-uncorrelated', 'report-http']) {
    await metric(brief, key, '0');
  }
  await metric(brief, 'report-fanout', '—', 'missing');
  await expect(page.getByTestId('notification-backlog-brief')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Manage alert rules', exact: true }))
    .toHaveAttribute('href', '/notifications/rules');
  await page.getByRole('link', { name: 'Manage alert rules', exact: true }).click();
  await waitForHarnessReady(page, mocks);
  await expect(page).toHaveURL(/\/notifications\/rules$/);
  await assertMockApiComplete(page, mocks);
});

test('missing report source retains all five unknown measurements and breakdown shells', async ({ page }) => {
  test.setTimeout(90_000);
  const { mocks } = await installNotificationFixtures(page, theme, INBOX_ROUTE, { reportUnavailable: true });
  await page.goto(INBOX_ROUTE);
  const brief = await briefMarker(page, 'notification-report-brief');
  await expect(brief).toContainText('Report unavailable', { timeout: 45_000 });
  await waitForHarnessReady(page, mocks);
  for (const key of ['report-triggered', 'report-deliveries', 'report-fanout', 'report-uncorrelated', 'report-http']) {
    await metric(brief, key, '—', 'missing');
  }
  const activity = page.getByRole('region', { name: 'Notification activity', exact: true });
  for (const heading of ['Trigger sources', 'Event types', 'Severities', 'Delivery channels', 'Delivery outcomes']) {
    await expect(activity.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await review(page, brief, 'Triggers, linked deliveries, and outbound calls', [
    'Outbound HTTP calls', '(exclusive) · UTC', 'retries and failures',
  ]);
  await assertMockApiComplete(page, mocks);
});

test('no usable health outcomes are unknown rather than zero latency or a healthy SLO', async ({ page }) => {
  const { mocks } = await installNotificationFixtures(page, theme, '/notifications/health', { deliveries: [] });
  await page.goto('/notifications/health');
  await waitForHarnessReady(page, mocks);
  const latency = await briefMarker(page, 'notification-latency-brief');
  for (const key of ['latency-p50', 'latency-p95', 'latency-p99', 'latency-apdex']) await metric(latency, key, '—', 'missing');
  await expect(latency).toContainText('No usable latency measurements');
  const burn = await briefMarker(page, 'notification-burn-rate-brief');
  for (const key of ['burn-delivery', 'burn-short', 'burn-long']) await metric(burn, key, '—', 'missing');
  await expect(burn).toContainText('No eligible delivery outcomes');
  const fatigue = await briefMarker(page, 'alert-fatigue-brief');
  await metric(fatigue, 'fatigue-rules', '0');
  await metric(fatigue, 'fatigue-ignored', '—', 'missing');
  await assertMockApiComplete(page, mocks);
});

test('measured zero is preserved in the canonical latency bridge', async ({ page }) => {
  const { mocks } = await installNotificationFixtures(page, theme, '/notifications/health#latency', {
    deliveries: [deliveryRows[0]],
  });
  await page.goto('/notifications/health#latency');
  await waitForHarnessReady(page, mocks);
  const brief = await briefMarker(page, 'notification-latency-brief');
  for (const key of ['latency-p50', 'latency-p95', 'latency-p99']) await metric(brief, key, '0.00 ms');
  await metric(brief, 'latency-apdex', '1.000');
  await expect(brief).toContainText('1 measured deliveries');
  await assertMockApiComplete(page, mocks);
});

test('empty quiet schedule keeps zero windows distinct from missing enabled denominator', async ({ page }) => {
  const { mocks } = await installNotificationFixtures(page, theme, '/notifications/quiet-hours', { quiet: [] });
  await page.goto('/notifications/quiet-hours');
  await waitForHarnessReady(page, mocks);
  const brief = await briefMarker(page, 'quiet-hours-brief');
  await metric(brief, 'quiet-windows', '0');
  await metric(brief, 'quiet-enabled', '—', 'missing');
  await metric(brief, 'quiet-bypass', '—', 'missing');
  await metric(brief, 'quiet-now', 'Delivering');
  await expect(brief).toContainText('No configured windows');
  await assertMockApiComplete(page, mocks);
});

test('failed real refresh retains published channel counts and drawer provenance', async ({ page }) => {
  test.setTimeout(90_000);
  const { mocks, control } = await installNotificationFixtures(page, theme, '/notifications/channels');
  await page.goto('/notifications/channels');
  await waitForHarnessReady(page, mocks);
  const brief = await briefMarker(page, 'notification-channel-brief');
  await metric(brief, 'channels-active', '2/5');
  const previous = control.statsRequests;
  control.failStats = true;
  await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => control.statsRequests).toBeGreaterThan(previous);
  await expect(brief).toContainText('Data may be stale', { timeout: 45_000 });
  await metric(brief, 'channels-sent', '17');
  await metric(brief, 'channels-failed', '0');
  await metric(brief, 'channels-active', '2/5');
  await review(page, brief, 'Delivery channels and recorded outcomes', [
    'Data may be stale', '2/5', 'Delivery counts have no reported time bounds',
  ]);
  control.failStats = false;
  await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(brief).toContainText('Statistics available');
  await waitForHarnessReady(page, mocks);
  await assertMockApiComplete(page, mocks);
});
    });
  }
}
