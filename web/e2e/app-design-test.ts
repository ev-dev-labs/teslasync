import { writeFile } from 'node:fs/promises';
import { test as base, type Page, type TestInfo } from '@playwright/test';
import { resolve } from 'node:path';
import { installAppDesignNavigation, navigateAppDesignDocument } from './app-design-navigation';
import { assertMockApiAfterNavigation, closeMockApiFixtures, prepareMockApiNavigation } from './mockApi';

export async function attachJsonEvidence(testInfo: TestInfo, name: string, value: unknown) {
  const path = testInfo.outputPath(name);
  await writeFile(path, JSON.stringify(value, null, 2));
  testInfo.attachments.push({ name, path, contentType: 'application/json' });
}

export async function routeBuiltApplication(page: Page, origin: string, paths: string[], dist?: string) {
  if (!dist) return;
  await page.route(url => url.origin === origin && (paths.includes(url.pathname) || url.pathname.startsWith('/assets/')), async route => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ path: resolve(dist, paths.includes(path) ? 'index.html' : path.slice(1)) });
  });
}

export async function navigateAppDesign(page: Page, destination: string | null) {
  const origin = /^https?:/.test(page.url()) ? new URL(page.url()).origin : null;
  await prepareMockApiNavigation(page);
  await navigateAppDesignDocument(page, destination);
  if (origin) await assertMockApiAfterNavigation(page, origin);
}

export const test = base.extend<{ mockApiLifetime: void }>({
  mockApiLifetime: [async ({ browserName }, runTest) => {
    try {
      await runTest();
    } finally {
      await base.step(`Close ${browserName} mock API listener`, closeMockApiFixtures);
    }
  }, { auto: true }],
  page: async ({ page }, runTest, testInfo) => {
    await installAppDesignNavigation(page);
    try {
      await runTest(page);
    } finally {
      if (!page.isClosed()) {
        const origin = new URL(page.url()).origin;
        try {
          if (testInfo.status !== testInfo.expectedStatus) {
            await testInfo.attach('application-before-teardown', {
              body: await page.locator('body').ariaSnapshot({ timeout: 5_000 }),
              contentType: 'text/plain',
            });
          }
        } finally {
          // Stop the document's polling before Playwright removes its API routes.
          try {
            await prepareMockApiNavigation(page);
          } finally {
            await navigateAppDesignDocument(page, 'about:blank');
          }
          if (testInfo.status === testInfo.expectedStatus) {
            await assertMockApiAfterNavigation(page, origin);
          }
        }
      }
    }
  },
});
