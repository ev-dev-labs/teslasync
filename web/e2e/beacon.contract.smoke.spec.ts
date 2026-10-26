import { expect, test } from '@playwright/test';
import { expectNoRuntimeFailures, monitorPage } from './qualityAssertions';
import {
  assertMockApiComplete,
  closeMockedPage,
  installApiMocks,
  readCapturedBeacons,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';

const vitalsBody = {
  context: { route: '/', navigation_type: 'navigate' },
  metrics: [{ name: 'LCP', value: 123, id: 'e2e-lcp', rating: 'good' }],
  events: [{ kind: 'navigation', outcome: 'success', route: '/', count: 1 }],
};
const webErrorBody = {
  name: 'E2EContract',
  message: 'Synthetic reporter contract',
  route: '/',
  userAgent: 'TeslaSync E2E',
  occurredAt: '2026-08-26T16:00:00.000Z',
};

test('reviewed RUM beacon and fetch transports remain in-process', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/');
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);

  const before = await readCapturedBeacons(page);
  const accepted = await page.evaluate(({ vitals, webError }) => [
    navigator.sendBeacon(
      '/api/v1/web-vitals',
      new Blob([JSON.stringify(vitals)], { type: 'application/json' }),
    ),
    navigator.sendBeacon(
      '/api/v1/web-errors',
      new Blob([JSON.stringify(webError)], { type: 'application/json' }),
    ),
  ], { vitals: vitalsBody, webError: webErrorBody });
  expect(accepted).toEqual([true, true]);
  const after = await readCapturedBeacons(page);
  expect(after.slice(before.length)).toEqual([
    expect.objectContaining({
      method: 'POST',
      sameOrigin: true,
      path: '/api/v1/web-vitals',
      contentType: 'application/json',
      accepted: true,
      violations: [],
      body: expect.objectContaining({ metrics: expect.any(Array) }),
    }),
    expect.objectContaining({
      method: 'POST',
      sameOrigin: true,
      path: '/api/v1/web-errors',
      contentType: 'application/json',
      accepted: true,
      violations: [],
      body: expect.objectContaining({ name: 'E2EContract' }),
    }),
  ]);

  const fallbackStatuses = await page.evaluate(async ({ vitals, webError }) =>
    Promise.all([
      fetch('/api/v1/web-vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vitals),
        keepalive: true,
      }),
      fetch('/api/v1/web-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webError),
        keepalive: true,
      }),
    ]).then((responses) => responses.map((response) => response.status)),
  { vitals: vitalsBody, webError: webErrorBody });
  expect(fallbackStatuses).toEqual([200, 200]);
  expect([...(mockApi?.seen ?? [])]).toEqual(expect.arrayContaining([
    'POST /web-vitals',
    'POST /web-errors',
  ]));
  await assertMockApiComplete(page, mockApi);
});

test('beacon policy rejects URL, content, schema, type, and size violations', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/');
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);

  const results = await page.evaluate(({ vitals }) => {
    const json = JSON.stringify(vitals);
    const validBlob = () => new Blob([json], { type: 'application/json' });
    const form = new FormData();
    form.set('payload', json);
    return [
      navigator.sendBeacon('https://attacker.invalid/api/v1/web-vitals', validBlob()),
      navigator.sendBeacon('//other-host.invalid/api/v1/web-vitals', validBlob()),
      navigator.sendBeacon('http://[invalid', validBlob()),
      navigator.sendBeacon('/api/v1/web-vitals?debug=true', validBlob()),
      navigator.sendBeacon('/api/v1/web-vitals#fragment', validBlob()),
      navigator.sendBeacon('/api/v1/web-vitals', new Blob([], { type: 'application/json' })),
      navigator.sendBeacon('/api/v1/web-vitals', new Blob(['{'], { type: 'application/json' })),
      navigator.sendBeacon('/api/v1/web-vitals', new Blob(['{}'], { type: 'application/json' })),
      navigator.sendBeacon('/api/v1/web-errors', new Blob(['{}'], { type: 'application/json' })),
      navigator.sendBeacon('/api/v1/web-vitals', json),
      navigator.sendBeacon('/api/v1/web-vitals', new TextEncoder().encode(json).buffer),
      navigator.sendBeacon('/api/v1/web-vitals', new TextEncoder().encode(json)),
      navigator.sendBeacon('/api/v1/web-vitals', form),
      navigator.sendBeacon(
        '/api/v1/web-vitals',
        new Blob([
          JSON.stringify({
            ...vitals,
            context: { padding: 'x'.repeat(70 * 1024) },
          }),
        ], { type: 'application/json' }),
      ),
    ];
  }, { vitals: vitalsBody });
  expect(results).toEqual(Array.from({ length: 14 }, () => false));
  const invalid = (await readCapturedBeacons(page)).filter((beacon) => !beacon.accepted);
  expect(invalid).toHaveLength(14);
  expect(invalid.flatMap((beacon) => beacon.violations)).toEqual(expect.arrayContaining([
    'off-origin',
    'invalid-url',
    'search',
    'hash',
    'empty-or-unserializable-body',
    'malformed-json',
    'web-vitals-schema',
    'web-errors-schema',
    'content-type',
    'payload-too-large',
  ]));

  let failure = '';
  try {
    await assertMockApiComplete(page, mockApi);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  expect(failure).toContain('invalid or unreviewed navigator.sendBeacon requests');
  expect(failure).not.toContain('attacker.invalid');
  expect(failure).not.toContain('Synthetic reporter contract');
});

test('request recorder survives resource-buffer pressure and blocks escaped API paths', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/');
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);

  const healthRequestsBefore = mockApi?.requests.filter(
    (request) => request.path === '/api/v1/system/health',
  ).length ?? 0;
  const statuses = await page.evaluate(async () => Promise.all(
    Array.from({ length: 260 }, (_, index) =>
      fetch(`/api/v1/system/health?probe=${index}`).then((response) => response.status)),
  ));
  expect(statuses.every((status) => status === 200)).toBe(true);
  const healthRequestsAfter = mockApi?.requests.filter(
    (request) => request.path === '/api/v1/system/health',
  ).length ?? 0;
  expect(healthRequestsAfter - healthRequestsBefore).toBe(260);

  await page.evaluate(async () => {
    await fetch('/api/v2/escaped-after-buffer-pressure').catch(() => undefined);
  });
  await expect(assertMockApiComplete(page, mockApi))
    .rejects.toThrow(/unmatched E2E API requests|API requests escaped/);
});

test('late pagehide API work is routed and isolated to the current page', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/');
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);
  await page.evaluate(() => {
    window.addEventListener('pagehide', () => {
      void fetch('/api/v1/system/health?late_teardown=1', { keepalive: true });
    }, { once: true });
  });
  await assertMockApiComplete(page, mockApi);
  expect([...(mockApi?.seen ?? [])]).toContain('GET /system/health?late_teardown=1');
});

test('closing a mocked document drains late requests before removing its routes', async ({ page }) => {
  const originalDiagnostics = monitorPage(page);
  await seedBrowserState(page, 'dark', '/');
  const originalApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, originalApi);
  const child = await page.context().newPage();
  const childDiagnostics = monitorPage(child);
  await seedBrowserState(child, 'dark', '/');
  const childApi = await installApiMocks(child, 'populated');
  await child.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(child, childApi);
  await child.evaluate(() => {
    window.addEventListener('pagehide', () => {
      setTimeout(() => {
        for (const source of ['climate', 'security']) {
          void fetch(`/api/v1/${source}/latest?vehicle_id=7&closing_document=child`, { keepalive: true });
        }
      }, 0);
    }, { once: true });
  });
  await closeMockedPage(child, childApi);
  await expectNoRuntimeFailures(childDiagnostics);
  expect(child.isClosed()).toBe(true);
  for (const source of ['climate', 'security']) {
    const path = `/api/v1/${source}/latest`;
    expect(childApi?.seen.has(`GET /${source}/latest?vehicle_id=7&closing_document=child`)).toBe(true);
    expect(childApi?.requests.filter(request => request.path === path).every(
      request => request.disposition === 'fulfilled',
    )).toBe(true);
    expect(originalApi?.seen.has(`GET /${source}/latest?vehicle_id=7&closing_document=child`)).toBe(false);
  }
  expect(await page.evaluate(() => fetch('/api/v1/system/health').then(response => response.status))).toBe(200);
  await closeMockedPage(page, originalApi);
  await expectNoRuntimeFailures(originalDiagnostics);
});
