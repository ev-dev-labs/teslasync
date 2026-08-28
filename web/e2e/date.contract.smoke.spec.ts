import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';

test('browser Date semantics remain native after deterministic state seeding', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/');
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);
  let assertionError: unknown;
  try {
    const result = await page.evaluate(() => {
      const before = Date.now();
      const current = new Date();
      const timestamp = new Date(1_234_567_890);
      const iso = new Date('2020-02-03T04:05:06.000Z');
      const parts = new Date(2020, 1, 3, 4, 5, 6, 7);
      const called = Date();
      const after = Date.now();
      return {
        currentWithinCall: current.getTime() >= before && current.getTime() <= after,
        timestamp: timestamp.getTime(),
        iso: iso.toISOString(),
        parts: [
          parts.getFullYear(), parts.getMonth(), parts.getDate(),
          parts.getHours(), parts.getMinutes(), parts.getSeconds(), parts.getMilliseconds(),
        ],
        calledParsesNearNow: Math.abs(Date.parse(called) - after) < 1_500,
        nativeSource: /\[native code\]/.test(Date.toString()),
      };
    });
    expect(result).toEqual({
      currentWithinCall: true,
      timestamp: 1_234_567_890,
      iso: '2020-02-03T04:05:06.000Z',
      parts: [2020, 1, 3, 4, 5, 6, 7],
      calledParsesNearNow: true,
      nativeSource: true,
    });
  } catch (error) {
    assertionError = error;
  }

  let completionError: unknown;
  try {
    await assertMockApiComplete(page, mockApi);
  } catch (error) {
    completionError = error;
  }

  if (assertionError !== undefined && completionError !== undefined) {
    throw new AggregateError(
      [assertionError, completionError],
      'Date contract and hermetic API completion both failed',
    );
  }
  if (assertionError !== undefined) throw assertionError;
  if (completionError !== undefined) throw completionError;
});
