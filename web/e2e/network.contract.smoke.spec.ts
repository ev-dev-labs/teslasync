import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';

test('SSE fixture is event-stream typed and does not reconnect or error', async ({ page }) => {
  await seedBrowserState(page, 'dark');
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);

  const requestsBefore = mockApi?.sseRequests ?? 0;
  const responsePromise = page.waitForResponse((response) =>
    response.headers()['content-type']?.includes('text/event-stream') === true,
  );
  const eventSourcePromise = page.evaluate(async () => {
    let errors = 0;
    let opens = 0;
    let connected = 0;
    const nativeSource = /\[native code\]/.test(EventSource.toString());
    const source = new EventSource('/api/v1/events?contract=1');
    source.addEventListener('open', () => { opens += 1; });
    source.addEventListener('error', () => { errors += 1; });
    source.addEventListener('connected', () => { connected += 1; });
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    const readyState = source.readyState;
    source.close();
    return { errors, opens, connected, readyState, nativeSource };
  });
  const [response, eventSourceState] = await Promise.all([responsePromise, eventSourcePromise]);
  expect(response.headers()['content-type']).toContain('text/event-stream');
  expect(eventSourceState).toEqual({
    errors: 0,
    opens: 1,
    connected: 1,
    readyState: 1,
    nativeSource: true,
  });
  expect(mockApi?.sseRequests).toBe(requestsBefore + 1);
  await page.waitForTimeout(1_200);
  expect(mockApi?.sseRequests).toBe(requestsBefore + 1);
  expect([...(mockApi?.sse ?? [])]).toContain('/events?contract=1');
  await assertMockApiComplete(page, mockApi);
});
