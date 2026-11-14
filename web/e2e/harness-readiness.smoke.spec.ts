import { expect, test, type Page } from '@playwright/test';
import { waitForHarnessReady } from './mockApi';

test('DOM readiness samples are not separated by automation round trips', async ({ page }) => {
  await page.setContent('<main>Ready application</main>');
  const delayedPage = new Proxy(page, {
    get(target, property) {
      if (property === 'evaluate') {
        return async (...args: Parameters<Page['evaluate']>) => {
          await new Promise(resolve => setTimeout(resolve, 1500));
          return target.evaluate(...args);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await waitForHarnessReady(delayedPage, null);
});

test('DOM readiness still rejects continuously changing layout within its 8s budget', async ({ page }) => {
  await page.setContent('<main>Changing application</main>');
  await page.evaluate(() => {
    let expanded = false;
    setInterval(() => {
      expanded = !expanded;
      document.querySelector('main')!.style.height = expanded ? '120px' : '240px';
    }, 50);
  });
  await expect(waitForHarnessReady(page, null)).rejects.toThrow(/Timeout 8000ms exceeded/);
});

test('a caller-specific DOM budget still requires a stable layout', async ({ page }) => {
  await page.setContent('<main>Changing application</main>');
  await page.evaluate(() => {
    const state = window as Window & { __READY_CHANGES__?: number; __READY_TIMER__?: number };
    state.__READY_CHANGES__ = 0;
    state.__READY_TIMER__ = window.setInterval(() => {
      const count = (state.__READY_CHANGES__ ?? 0) + 1;
      state.__READY_CHANGES__ = count;
      document.querySelector('main')!.style.height = count % 2 ? '120px' : '240px';
    }, 100);
  });
  await expect(waitForHarnessReady(page, null, { domStabilityTimeoutMs: 600 }))
    .rejects.toThrow(/Timeout 600ms exceeded/);
  const changes = await page.evaluate(() => {
    const state = window as Window & { __READY_CHANGES__?: number; __READY_TIMER__?: number };
    window.clearInterval(state.__READY_TIMER__);
    return state.__READY_CHANGES__;
  });
  expect(changes).toBeGreaterThan(0);
  await waitForHarnessReady(page, null, { domStabilityTimeoutMs: 4_000 });
  expect(await page.evaluate(() => (window as Window & { __READY_CHANGES__?: number }).__READY_CHANGES__)).toBe(changes);
});
