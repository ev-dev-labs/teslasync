import { test as base, type Page } from '@playwright/test';
import { resolve } from 'node:path';

export async function routeBuiltApplication(page: Page, origin: string, paths: string[], dist?: string) {
  if (!dist) return;
  await page.route(url => url.origin === origin && (paths.includes(url.pathname) || url.pathname.startsWith('/assets/')), async route => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ path: resolve(dist, paths.includes(path) ? 'index.html' : path.slice(1)) });
  });
}

export const test = base.extend({
  page: async ({ page }, runTest, testInfo) => {
    try {
      await runTest(page);
    } finally {
      if (!page.isClosed()) {
        try {
          if (testInfo.status !== testInfo.expectedStatus) {
            await testInfo.attach('application-before-teardown', {
              body: await page.locator('body').ariaSnapshot({ timeout: 5_000 }),
              contentType: 'text/plain',
            });
          }
        } finally {
          // Stop the document's polling before Playwright removes its API routes.
          await page.goto('about:blank');
        }
      }
    }
  },
});
