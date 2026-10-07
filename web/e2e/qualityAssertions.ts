import { expect, type Page, type TestInfo } from '@playwright/test';

export interface PageDiagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  brokenResources: string[];
  failedDataRequests: string[];
}

export function monitorPage(page: Page): PageDiagnostics {
  const result: PageDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    brokenResources: [],
    failedDataRequests: [],
  };
  const appendUnique = (items: string[], value: string) => {
    const key = value.split('\n', 1)[0];
    if (items.some((item) => item.split('\n', 1)[0] === key)) return;
    if (items.length < 50) items.push(value);
  };
  page.on('console', (message) => {
    if (message.type() === 'error') appendUnique(result.consoleErrors, message.text());
  });
  page.on('pageerror', (error) => appendUnique(result.pageErrors, error.stack ?? error.message));
  page.on('response', (response) => {
    const kind = response.request().resourceType();
    if (response.status() >= 400 && ['document', 'script', 'stylesheet', 'image', 'font'].includes(kind)) {
      appendUnique(result.brokenResources, `${response.status()} ${kind} ${response.url()}`);
    }
    if (response.status() >= 400 && ['fetch', 'xhr'].includes(kind)) {
      appendUnique(result.failedDataRequests, `${response.status()} ${kind} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    const kind = request.resourceType();
    const reason = request.failure()?.errorText ?? 'unknown';
    if (['document', 'script', 'stylesheet', 'image', 'font'].includes(kind) && !reason.includes('ERR_ABORTED')) {
      appendUnique(result.brokenResources, `${reason} ${kind} ${request.url()}`);
    }
    if (['fetch', 'xhr'].includes(kind) && !reason.includes('ERR_ABORTED')) {
      appendUnique(result.failedDataRequests, `${reason} ${kind} ${request.url()}`);
    }
  });
  return result;
}

export async function attachDiagnostics(testInfo: TestInfo, diagnostics: PageDiagnostics): Promise<void> {
  await testInfo.attach('page-diagnostics.json', {
    body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
    contentType: 'application/json',
  });
}

export async function expectNoRuntimeFailures(diagnostics: PageDiagnostics): Promise<void> {
  expect(diagnostics.pageErrors, 'uncaught page errors').toEqual([]);
  expect(diagnostics.consoleErrors, 'browser console errors').toEqual([]);
  expect(diagnostics.brokenResources, 'broken document/script/style/image/font resources').toEqual([]);
  expect(diagnostics.failedDataRequests, 'failed fetch/xhr requests').toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      root: { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth },
      body: { clientWidth: body.clientWidth, scrollWidth: body.scrollWidth },
    };
  });
  expect(overflow.root.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.root.clientWidth + 1);
  expect(overflow.body.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.body.clientWidth + 1);
}

export async function expectStableChartHeights(page: Page): Promise<void> {
  const sample = () => page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return [...document.querySelectorAll<HTMLElement>('.recharts-responsive-container, [data-chart-container], canvas')]
      .filter((element) => element.offsetParent !== null)
      .map((element) => ({ height: element.getBoundingClientRect().height, selector: element.className }));
  });
  const first = await sample();
  const original = page.viewportSize();
  if (!original) return;
  await page.setViewportSize({ width: Math.max(320, original.width - 37), height: original.height + 13 });
  const resized = await sample();
  await page.setViewportSize(original);
  const settled = await sample();
  const heights = [...first, ...resized, ...settled].map((entry) => entry.height);
  expect(Math.max(0, ...heights), 'chart exceeded the runaway-height ceiling').toBeLessThanOrEqual(Math.max(1400, original.height * 1.5));
  first.forEach((entry, index) => {
    const finalHeight = settled[index]?.height ?? entry.height;
    expect(Math.abs(finalHeight - entry.height), `chart ${index} failed to settle after resize`).toBeLessThanOrEqual(12);
  });
}

export async function expectDialogsInsideViewport(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;
  for (const dialog of await page.getByRole('dialog').all()) {
    if (!(await dialog.isVisible())) continue;
    const box = await dialog.boundingBox();
    expect(box, 'visible dialog has no layout box').not.toBeNull();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    const actions = dialog.locator('button:visible, a[href]:visible');
    for (let index = 0; index < await actions.count(); index += 1) {
      const action = actions.nth(index);
      await expect.poll(async () => {
        const actionBox = await action.boundingBox();
        return actionBox == null || actionBox.x + actionBox.width <= viewport.width + 1;
      }, { message: `dialog action ${index} remained clipped after animation` }).toBe(true);
    }
  }
}

export async function waitForRoute(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByText(/page failed to load/i)).toHaveCount(0);
}
