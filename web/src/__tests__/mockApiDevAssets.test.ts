import { vi } from 'vitest';

// The SSE helper binds a real socket; the routing decision under test never
// reaches it, so stub the origin.
vi.mock('../../e2e/mockSseServer', () => ({
  ensureMockSseServer: vi.fn(async () => ({ origin: 'http://127.0.0.1:9' })),
}));

import { installApiMocks } from '../../e2e/mockApi';

// ─────────────────────────────────────────────────────────────────────────────
// installApiMocks intercepts '**/api/**'. Under `vite dev` that glob also
// matches source modules such as /src/api/queryClient.ts, which must load
// as static assets — aborting them (the no-network-escape default) leaves
// React unbooted on a perpetual splash. Preview builds issue no such
// requests, so the passthrough is a no-op for the standard suite.
// ─────────────────────────────────────────────────────────────────────────────

type RouteHandler = (route: unknown) => Promise<void> | void;

function fakeRequest(url: string) {
  return {
    url: () => url,
    method: () => 'GET',
    resourceType: () => 'script',
    headers: () => ({}),
  };
}

function fakeRoute(url: string) {
  return {
    request: () => fakeRequest(url),
    continue: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    fulfill: vi.fn(async () => {}),
  };
}

async function captureHandler() {
  const seen: Array<{ pattern: unknown; handler: RouteHandler }> = [];
  const page = {
    on: vi.fn(),
    route: vi.fn(async (pattern: unknown, handler: RouteHandler) => {
      seen.push({ pattern, handler });
    }),
  };
  const controller = await installApiMocks(page as never);
  if (!controller) throw new Error('expected mocks to install');
  const entry = seen.find((s) => s.pattern === '**/api/**');
  if (!entry) throw new Error('expected a **/api/** route');
  return { controller, handler: entry.handler };
}

describe('installApiMocks vite-dev passthrough', () => {
  it.each([
    'http://127.0.0.1:3210/src/api/queryClient.ts',
    'http://127.0.0.1:3210/src/api/hooks/useActivity.ts',
    'http://127.0.0.1:3210/@fs/home/app/src/api/token.ts',
    'http://127.0.0.1:3210/node_modules/.vite/deps/api-chunk.js',
  ])('continues dev-asset request %s without recording an escape', async (url) => {
    const { controller, handler } = await captureHandler();
    const route = fakeRoute(url);
    await handler(route);
    expect(route.continue).toHaveBeenCalledTimes(1);
    expect(route.abort).not.toHaveBeenCalled();
    expect(route.fulfill).not.toHaveBeenCalled();
    expect([...controller.unmatched]).toEqual([]);
  });

  it('still aborts non-v1 API paths as network escapes', async () => {
    const { controller, handler } = await captureHandler();
    const route = fakeRoute('http://127.0.0.1:3210/api/v2/vehicles');
    await handler(route);
    expect(route.abort).toHaveBeenCalledTimes(1);
    expect(route.continue).not.toHaveBeenCalled();
    expect([...controller.unmatched]).toEqual(['GET /api/v2/vehicles']);
  });
});
