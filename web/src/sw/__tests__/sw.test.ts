/**
 * Duplicate notification icon regression test.
 *
 * Regression test that pins the contract: the service worker MUST NOT
 * populate `NotificationOptions.icon` when handling a push event. On
 * Android Chrome, populating the icon slot in addition to the PWA
 * manifest icon causes the same image to render on both sides of the
 * notification card (the user-reported "duplicate icon" bug).
 *
 * The test mocks `workbox-*` (which would otherwise crash at import
 * time outside a real Service Worker scope) and stubs out
 * `self.registration.showNotification` so we can capture the options
 * object the SW passes through.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('workbox-precaching', () => ({
  precacheAndRoute: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
}));

vi.mock('workbox-routing', () => ({
  registerRoute: vi.fn(),
  NavigationRoute: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('workbox-strategies', () => ({
  CacheFirst: vi.fn().mockImplementation(function (options: unknown) {
    return { kind: 'CacheFirst', options };
  }),
  NetworkFirst: vi.fn().mockImplementation(function (options: unknown) {
    return { kind: 'NetworkFirst', options };
  }),
}));

vi.mock('workbox-expiration', () => ({
  ExpirationPlugin: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('workbox-cacheable-response', () => ({
  CacheableResponsePlugin: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

interface CapturedNotification {
  title: string;
  options: NotificationOptions;
}

const capturedNotifications: CapturedNotification[] = [];
const showNotificationSpy = vi.fn(async (title: string, options: NotificationOptions) => {
  capturedNotifications.push({ title, options });
});

const originalSelf = globalThis as Record<string, unknown>;

beforeEach(async () => {
  capturedNotifications.length = 0;
  showNotificationSpy.mockClear();

  // jsdom's `self` (= window) doesn't have a ServiceWorker `registration`
  // property; synthesise a minimal one for the SW import to attach to.
  Object.assign(originalSelf, {
    __WB_MANIFEST: [],
    registration: { showNotification: showNotificationSpy },
    skipWaiting: vi.fn(),
    clients: {
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => null),
    },
  });

  // Reset the module registry so listeners are re-registered fresh on
  // each import (vitest caches modules across test cases otherwise).
  vi.resetModules();
  await import('../sw');
});

afterEach(() => {
  // Drop the listeners the SW import added so they don't leak across files.
  // jsdom doesn't expose a removeAllListeners on `self`; instead we
  // re-import via vi.resetModules() in the next beforeEach.
});

afterAll(() => {
  delete originalSelf.__WB_MANIFEST;
  delete originalSelf.registration;
  delete originalSelf.skipWaiting;
  delete originalSelf.clients;
});

// dispatchPush synthesises a real PushEvent that the SW's
// addEventListener('push', ...) handler will pick up.
function dispatchPush(payload: Record<string, unknown> | null) {
  // Build a minimal Event with a `data` property mimicking PushMessageData.
  const event = new Event('push') as Event & {
    data?: { json: () => unknown; text: () => string };
    waitUntil: (p: Promise<unknown>) => void;
  };
  if (payload != null) {
    event.data = {
      json: () => payload,
      text: () => JSON.stringify(payload),
    };
  }
  const pending: Promise<unknown>[] = [];
  event.waitUntil = (p: Promise<unknown>) => {
    pending.push(p);
  };
  (self as unknown as EventTarget).dispatchEvent(event);
  return Promise.all(pending);
}

describe('Service worker push handler — Phase-49 / Slice 0010 duplicate-icon fix', () => {
  it('does not populate NotificationOptions.icon for a typical alert payload', async () => {
    await dispatchPush({
      title: 'Drive Started',
      body: 'Roadster is moving',
      url: '/drives/42',
      tag: 'drive-42',
      severity: 'info',
    });

    expect(showNotificationSpy).toHaveBeenCalledTimes(1);
    const opts = capturedNotifications[0].options;
    expect(opts.icon).toBeUndefined();
  });

  it('still populates badge for the Android status-bar slot', async () => {
    await dispatchPush({ title: 'Critical alert', severity: 'critical' });

    const opts = capturedNotifications[0].options;
    expect(opts.badge).toBe('/icons/badge-72.png');
    // requireInteraction MUST be true for critical so the user can't
    // miss it; this assertion guards the slice's other invariant.
    expect(opts.requireInteraction).toBe(true);
  });

  it('ignores any stray `icon` key the upstream payload happens to include', async () => {
    // Defence-in-depth: even if a future backend regression reintroduces
    // `icon` on the wire, the SW's typed PushPayload omits it from the
    // interface AND we never read it into the options object. This test
    // pins that nothing leaks through despite the field appearing in
    // the JSON body.
    await dispatchPush({
      title: 'Stale schema',
      icon: '/icons/icon-192.png',
    });

    const opts = capturedNotifications[0].options;
    expect(opts.icon).toBeUndefined();
  });
});

describe('Service worker on-demand route asset caching', () => {
  it('runtime-caches only same-origin scripts and styles', async () => {
    const { registerRoute } = await import('workbox-routing');
    const calls = vi.mocked(registerRoute).mock.calls as unknown as Array<
      [unknown, { options?: { cacheName?: string } }]
    >;
    const assetRoute = calls.find(([, strategy]) =>
      strategy?.options?.cacheName === 'app-route-assets');

    expect(assetRoute).toBeDefined();
    const matcher = assetRoute?.[0] as (context: {
      request: Pick<Request, 'destination'>;
      url: URL;
    }) => boolean;
    const sameOrigin = new URL('/assets/TimelinePage-hash.js', window.location.href);

    expect(matcher({
      request: { destination: 'script' },
      url: sameOrigin,
    })).toBe(true);
    expect(matcher({
      request: { destination: 'style' },
      url: new URL('/assets/index-hash.css', window.location.href),
    })).toBe(true);
    expect(matcher({
      request: { destination: 'image' },
      url: sameOrigin,
    })).toBe(false);
    expect(matcher({
      request: { destination: 'script' },
      url: new URL('https://cdn.example.com/chunk.js'),
    })).toBe(false);
  });

  it('refuses to cache redirected ForwardAuth responses as route assets', async () => {
    const { registerRoute } = await import('workbox-routing');
    const calls = vi.mocked(registerRoute).mock.calls as unknown as Array<
      [unknown, {
        options?: {
          cacheName?: string;
          plugins?: Array<{
            cacheWillUpdate?: (context: { response: Response }) => Promise<Response | null>;
          }>;
        };
      }]
    >;
    const strategy = calls.find(([, candidate]) =>
      candidate?.options?.cacheName === 'app-route-assets')?.[1];
    const guard = strategy?.options?.plugins?.find((plugin) => plugin.cacheWillUpdate);

    expect(guard?.cacheWillUpdate).toBeTypeOf('function');
    const valid = {
      status: 200,
      redirected: false,
      url: `${window.location.origin}/assets/chunk.js`,
    } as Response;
    const redirected = {
      status: 200,
      redirected: true,
      url: `${window.location.origin}/auth/login`,
    } as Response;

    await expect(guard?.cacheWillUpdate?.({ response: valid })).resolves.toBe(valid);
    await expect(guard?.cacheWillUpdate?.({ response: redirected })).resolves.toBeNull();
  });
});
