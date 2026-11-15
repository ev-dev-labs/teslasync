import { expect, type Page, type TestInfo } from '@playwright/test';
import { getAppDesignAttributes } from '../src/components/ui/app-designs/designs';
import { PACK_IDS } from '../src/features/dashboard/widgets/designPacks/types';
import { routeBuiltApplication, test } from './app-design-test';
import { assertMockApiComplete, closeMockApiFixtures, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import { createReviewPreference, installPackReview } from './widget-design-packs.mock';
import { specializedTranscripts } from './widget-design-packs.specialized.fixtures';
import { installSpecializedReviewSources } from './widget-design-packs.specialized.mock';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic Helix fixtures');
test.afterAll(async () => { await closeMockApiFixtures(); });

async function openHelix(
  page: Page, testInfo: TestInfo, pack: 'classic' | 'blueprint',
  reply?: string, appWide = true, theme: 'dark' | 'light' = 'dark',
) {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string') throw new Error('A local test origin is required');
  const origin = new URL(baseURL).origin;
  const saved = createReviewPreference();
  saved.pack_id = pack;
  saved.app_wide = appWide;
  await page.setViewportSize({ width: 360, height: 800 });
  const mocks = await installPackReview(page, theme, 390, false, [], true, saved, origin);
  await installSpecializedReviewSources(page, mocks, theme);
  if (reply !== undefined) {
    await page.route(url => url.pathname === '/api/v1/chatbot/history' && url.searchParams.get('session_id') === 'qa-one', route =>
      fulfillApiFixture(route, mocks, {
        json: specializedTranscripts['qa-one'].map(message => message.role === 'assistant'
          ? { ...message, content: reply }
          : message),
      }));
  }
  await routeBuiltApplication(page, origin, ['/chatbot'], process.env.DESIGN_PACK_DIST_DIR);
  await page.goto('/chatbot', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mocks);
  if (appWide) await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', pack);
  else await expect(page.locator('html')).not.toHaveAttribute('data-app-design-pack');
  if (reply !== undefined) {
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.getByRole('button', { name: /^QA first session/ }).click();
  }
  return mocks;
}

for (const pack of ['classic', 'blueprint'] as const) {
  test(`Helix composer stays reachable in ${pack} on phones`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const mocks = await openHelix(page, testInfo, pack);
    const composer = page.locator('[data-app-part~="conversation-composer"]');
    const input = composer.getByRole('textbox', { name: 'Message' });
    const send = composer.getByRole('button', { name: 'Send message' });
    for (const [width, height] of [[360, 800], [390, 844], [430, 932]]) {
      await page.setViewportSize({ width, height });
      await composer.scrollIntoViewIfNeeded();
      await input.fill('Test draft');
      const bounds = await composer.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          tabsTop: document.querySelector('[data-role="bottom-tab-bar"]')!.getBoundingClientRect().top,
          statusTop: document.querySelector('[data-role="status-bar"]')!.getBoundingClientRect().top,
          mainBottom: document.querySelector('[data-role="main-content"]')!.getBoundingClientRect().bottom,
        };
      });
      const button = await send.boundingBox();
      if (!button) throw new Error('Send button is not visible');
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.bottom).toBeLessThanOrEqual(Math.min(bounds.tabsTop, bounds.statusTop, bounds.mainBottom) + 1);
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
      await expect(send).toBeEnabled();
      await expect(send).toBeInViewport({ ratio: 1 });
    }
    await assertMockApiComplete(page, mocks);
  });

  test(`Helix long code wraps without scrolling in ${pack} on phones`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const longLine = `const example = "${'a'.repeat(160)}";`;
    const mocks = await openHelix(page, testInfo, pack, `\`\`\`ts\n${longLine}\n\`\`\``);
    const code = page.locator('[data-app-part~="conversation-answer"] pre');
    await expect(code).toContainText(longLine);
    await expect(code).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${pack}(?:\\s|$)`));
    for (const [width, height] of [[360, 800], [390, 844], [430, 932]]) {
      await page.setViewportSize({ width, height });
      const geometry = await code.evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        fontSize: parseFloat(getComputedStyle(element).fontSize),
      }));
      expect(geometry.scrollWidth - geometry.clientWidth, `${pack} ${width}px code overflow`).toBeLessThanOrEqual(1);
      expect(geometry.fontSize).toBeGreaterThanOrEqual(16);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(code).toHaveCSS('white-space', 'pre');
    await expect(code).toHaveCSS('overflow-x', 'auto');
    await assertMockApiComplete(page, mocks);
  });

  test(`Helix wide tables retain readable column labels in ${pack} on phones`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const reply = [
      '| **Metric name** | `Energy use` | Thermal status | Distance traveled | Efficiency rating |',
      '| --- | --- | --- | --- | --- |',
      '| First measurement | 24.5 kWh | Normal | 120 km | Efficient |',
    ].join('\n');
    const mocks = await openHelix(page, testInfo, pack, reply);
    const table = page.locator('[data-app-part~="conversation-answer"] table');
    await expect(table.getByRole('columnheader')).toHaveCount(5);
    await expect(table).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${pack}(?:\\s|$)`));
    const labels = ['Metric name', 'Energy use', 'Thermal status', 'Distance traveled', 'Efficiency rating'];
    for (const [width, height] of [[360, 800], [390, 844], [430, 932]]) {
      await page.setViewportSize({ width, height });
      const geometry = await table.evaluate(element => {
        const scroll = element.parentElement!;
        return {
          clientWidth: scroll.clientWidth,
          scrollWidth: scroll.scrollWidth,
          rowDisplay: getComputedStyle(element.querySelector('tbody tr')!).display,
          cells: Array.from(element.querySelectorAll('tbody td'), cell => ({
            label: cell.getAttribute('data-mobile-label'),
            visibleLabel: getComputedStyle(cell, '::before').content,
            width: cell.getBoundingClientRect().width,
            top: Math.round(cell.getBoundingClientRect().top),
            overflow: cell.scrollWidth - cell.clientWidth,
            fontSize: parseFloat(getComputedStyle(cell).fontSize),
          })),
        };
      });
      expect(geometry.scrollWidth - geometry.clientWidth, `${pack} ${width}px table overflow`).toBeLessThanOrEqual(1);
      expect(geometry.rowDisplay).toBe('grid');
      expect(geometry.cells.map(cell => cell.label)).toEqual(labels);
      expect(new Set(geometry.cells.map(cell => cell.top)).size, JSON.stringify(geometry)).toBe(labels.length);
      geometry.cells.forEach((cell, index) => {
        expect(cell.visibleLabel).toContain(labels[index]);
        expect(cell.width).toBeGreaterThanOrEqual(100);
        expect(cell.overflow).toBeLessThanOrEqual(1);
        expect(cell.fontSize).toBeGreaterThanOrEqual(16);
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(table.locator('tbody tr').first()).toHaveCSS('display', 'table-row');
    await assertMockApiComplete(page, mocks);
  });
}

test('Helix mobile styles preserve report and kiosk presentations', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const reply = '```ts\nconst example = 1;\n```\n\n| Header | Value |\n| --- | --- |\n| A | B |';
  const mocks = await openHelix(page, testInfo, 'classic', reply);
  const code = page.locator('[data-app-part~="conversation-answer"] pre');
  const row = page.locator('[data-conversation-table] tbody tr').first();
  await expect(code).toHaveCSS('white-space', 'pre-wrap');
  await expect(row).toHaveCSS('display', 'grid');
  const shell = page.locator('[data-app-part~="shell"]');
  for (const mode of ['report', 'kiosk']) {
    await shell.evaluate((element, value) => element.setAttribute('data-presentation-mode', value), mode);
    await expect(code).toHaveCSS('white-space', 'pre');
    await expect(row).toHaveCSS('display', 'table-row');
  }
  await shell.evaluate(element => element.setAttribute('data-presentation-mode', 'standard'));
  await assertMockApiComplete(page, mocks);
});

test('Helix mobile styles do not affect widget-only designs', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const reply = '```ts\nconst example = 1;\n```\n\n| Header | Value |\n| --- | --- |\n| A | B |';
  const mocks = await openHelix(page, testInfo, 'classic', reply, false);
  const code = page.locator('[data-app-part~="conversation-answer"] pre');
  const row = page.locator('[data-conversation-table] tbody tr').first();
  await expect(code).toHaveCSS('white-space', 'pre');
  await expect(row).toHaveCSS('display', 'table-row');
  await assertMockApiComplete(page, mocks);
});

for (const theme of ['dark', 'light'] as const) {
  test(`all application packs keep long Helix content within phone widths in ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const longLine = `const example = "${'a'.repeat(160)}";`;
    const reply = `\`\`\`ts\n${longLine}\n\`\`\`\n\n`
      + '| Metric name | Energy use | Thermal status | Distance traveled | Efficiency rating |\n'
      + '| --- | --- | --- | --- | --- |\n'
      + '| First measurement | 24.5 kWh | Normal | 120 km | Efficient |';
    const mocks = await openHelix(page, testInfo, 'classic', reply, true, theme);
    const code = page.locator('[data-app-part~="conversation-answer"] pre');
    const table = page.locator('[data-conversation-table]');
    await expect(code).toContainText(longLine);
    for (const pack of PACK_IDS) {
      await page.locator('html').evaluate((element, attributes) => {
        for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      }, getAppDesignAttributes(pack));
      const owner = new RegExp(`^pack-${pack}(?:\\s|$)`);
      await expect(code).toHaveAttribute('data-app-design-owner', owner);
      await expect(table).toHaveAttribute('data-app-design-owner', owner);
      for (const width of [360, 430]) {
        await page.setViewportSize({ width, height: 932 });
        const codeGeometry = await code.evaluate(element => ({
          overflow: element.scrollWidth - element.clientWidth,
          fontSize: parseFloat(getComputedStyle(element).fontSize),
        }));
        const tableGeometry = await table.evaluate(element => {
          const scroll = element.parentElement!;
          const cells = Array.from(element.querySelectorAll('tbody td'));
          return {
            overflow: scroll.scrollWidth - scroll.clientWidth,
            rowDisplay: getComputedStyle(element.querySelector('tbody tr')!).display,
            cellWidths: cells.map(cell => cell.getBoundingClientRect().width),
            cellRows: new Set(cells.map(cell => Math.round(cell.getBoundingClientRect().top))).size,
          };
        });
        const context = `${pack}, ${theme}, ${width}px`;
        expect(codeGeometry.overflow, context).toBeLessThanOrEqual(1);
        expect(codeGeometry.fontSize, context).toBeGreaterThanOrEqual(16);
        expect(tableGeometry.overflow, context).toBeLessThanOrEqual(1);
        expect(tableGeometry.rowDisplay, context).toBe('grid');
        expect(tableGeometry.cellRows, context).toBe(5);
        expect(Math.min(...tableGeometry.cellWidths), context).toBeGreaterThanOrEqual(100);
      }
    }
    await assertMockApiComplete(page, mocks);
  });
}
