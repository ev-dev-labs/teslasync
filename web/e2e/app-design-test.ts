import { test as base } from '@playwright/test';

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
