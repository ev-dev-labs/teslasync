import type { Page } from '@playwright/test';

export async function withRunningObservationClock<T>(page: Page, interact: () => Promise<T>): Promise<T> {
  const observationTime = await page.evaluate(() => Date.now());
  // Native chart/map interactions need elapsed time; retain the fixture epoch afterward.
  await page.clock.setSystemTime(observationTime);
  try {
    return await interact();
  } finally {
    await page.clock.setFixedTime(observationTime);
  }
}
