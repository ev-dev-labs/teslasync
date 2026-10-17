import { expect, test } from '@playwright/test';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic shared-grid pagination fixtures');

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1440, 2560]) {
    test(`shared footer stays outside data scrolling at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/notifications/audit');
      await page.addInitScript(() => localStorage.setItem('teslasync.table.audit-logs.page-size', '25'));
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.route('**/api/v1/system/audit*', route => fulfillApiFixture(route, mocks, {
        json: Array.from({ length: 251 }, (_, index) => ({
          id: index + 1,
          created_at: '2026-10-01T08:00:00.000Z',
          action: 'configuration.updated',
          resource: `resource-${index + 1}-${'identifier'.repeat(30)}`,
          details: 'Synthetic shared-grid footer evidence.',
        })),
      }));
      await page.goto('/notifications/audit');
      await waitForHarnessReady(page, mocks);
      const table = page.getByRole('table', { name: 'audit-logs', exact: true });
      await expect(table).toBeVisible();
      const frame = table.locator('xpath=ancestor::*[@data-grid-frame][1]');
      const viewport = frame.locator('[data-grid-viewport]');
      const footer = frame.locator('[data-grid-footer]');
      const pagination = footer.getByRole('navigation', { name: 'Pagination', exact: true });
      await expect(pagination).toBeVisible();
      await expect(footer.getByText('Showing 1–25 of 251', { exact: true })).toBeVisible();
      const currentPage = footer.locator('button[aria-current="page"]');
      await expect(currentPage).toHaveAccessibleName('Page 1 of 11');
      expect(await viewport.locator('[data-grid-footer]').count()).toBe(0);

      // Bound the real scroll viewport independently of the card/footer.
      await viewport.evaluate(node => {
        const element = node as HTMLElement;
        element.style.maxHeight = '160px';
        element.scrollTop = 100;
        element.scrollLeft = 200;
      });
      await footer.scrollIntoViewIfNeeded();
      const geometry = await frame.evaluate(node => {
        const viewport = node.querySelector<HTMLElement>('[data-grid-viewport]')!;
        const footer = node.querySelector<HTMLElement>('[data-grid-footer]')!;
        const bounds = footer.getBoundingClientRect();
        return {
          left: bounds.left, right: bounds.right, width: window.innerWidth,
          footerOverflow: footer.scrollWidth - footer.clientWidth,
          outside: !viewport.contains(footer), scrollTop: viewport.scrollTop,
          footerBelowViewport: bounds.top >= viewport.getBoundingClientRect().bottom - 1,
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.width);
      expect(geometry.footerOverflow).toBeLessThanOrEqual(1);
      expect(geometry.outside).toBe(true);
      expect(geometry.scrollTop).toBeGreaterThan(0);
      expect(geometry.footerBelowViewport).toBe(true);
      if (width < 640) {
        for (const control of await footer.locator('button, input, select').all()) {
          const bounds = await control.boundingBox();
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
          expect(bounds!.width).toBeGreaterThanOrEqual(44);
        }
      }
      const destination = footer.getByRole('textbox', { name: 'Go to page' });
      await expect(destination).toHaveValue('1');
      await destination.fill('6');
      await destination.press('Enter');
      await expect(currentPage).toHaveAccessibleName('Page 6 of 11');
      await expect(destination).toHaveValue('6');
      await expect(footer.getByText('Showing 126–150 of 251', { exact: true })).toBeVisible();
      await expect(footer.getByText('…', { exact: true })).toHaveCount(2);
      await table.focus();
      await table.press('End');
      await expect(currentPage).toHaveAccessibleName('Page 11 of 11');
      await table.press('Home');
      await expect(currentPage).toHaveAccessibleName('Page 1 of 11');
      await destination.fill('99');
      await destination.press('Enter');
      await expect(destination).toHaveAttribute('aria-invalid', 'true');
      await expect(footer.getByRole('alert')).toHaveText('Enter a page from 1 to 11.');
      await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1440) {
        await page.screenshot({ path: test.info().outputPath(`shared-grid-footer-${width}-${theme}.png`), fullPage: true });
      }
      await assertMockApiComplete(page, mocks);
    });
  }
}
