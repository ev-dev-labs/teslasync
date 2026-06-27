import {AppState, type AppStateStatus} from 'react-native';
import {
  __resetWebVitalsReporterForTests,
  flush,
  setVitalsConsentRequirement,
  setVitalsRouteProvider,
  setWebVitalsSource,
  startWebVitalsReporter,
  type VitalsPayload,
  type WebVitalsMetric,
  type WebVitalsSource,
} from '../src/web-parity/lib/webVitalsReporter';

// Capture the callbacks registered with the injected web-vitals source so the
// tests can invoke them with synthetic metrics, mirroring the web test's
// `registeredCallbacks` map.
const registeredCallbacks: Record<
  string,
  ((m: WebVitalsMetric) => void) | undefined
> = {};

function makeSource(): WebVitalsSource {
  const register = (name: string) => (cb: (m: WebVitalsMetric) => void) => {
    registeredCallbacks[name] = cb;
  };
  return {
    onLCP: register('LCP'),
    onINP: register('INP'),
    onCLS: register('CLS'),
    onFCP: register('FCP'),
    onTTFB: register('TTFB'),
  };
}

function makeMetric(overrides: Partial<WebVitalsMetric> = {}): WebVitalsMetric {
  return {
    name: 'LCP',
    value: 1234,
    id: 'v3-1234',
    rating: 'good',
    navigationType: 'navigate',
    ...overrides,
  };
}

// Minimal Blob stand-in so flush() builds a sendBeacon payload we can inspect.
class MockBlob {
  readonly parts: string[];
  readonly type?: string;
  constructor(parts: unknown[], options?: {type?: string}) {
    this.parts = parts.map(part => String(part));
    this.type = options?.type;
  }
  async text(): Promise<string> {
    return this.parts.join('');
  }
}

const API_BASE = 'https://teslasync.example.test';
const EXPECTED_URL = `${API_BASE}/api/v1/web-vitals`;

type MutableNavigator = {sendBeacon?: unknown};

function navigatorObject(): MutableNavigator {
  const scope = globalThis as typeof globalThis & {navigator?: MutableNavigator};
  if (!scope.navigator) {
    Object.defineProperty(scope, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });
  }
  return scope.navigator as MutableNavigator;
}

function setSendBeacon(
  fn: ((url: string, data?: unknown) => boolean) | undefined,
): void {
  navigatorObject().sendBeacon = fn;
}

describe('web/src/lib/webVitalsReporter native parity', () => {
  const globalScope = globalThis as unknown as Record<string, unknown>;

  let beacon: jest.Mock<boolean, [string, unknown?]>;
  let fetchSpy: jest.Mock<Promise<Response>, [string, RequestInit?]>;
  let originalBlob: unknown;
  let originalFetch: unknown;

  beforeEach(() => {
    jest.useFakeTimers();
    for (const key of Object.keys(registeredCallbacks)) {
      delete registeredCallbacks[key];
    }
    __resetWebVitalsReporterForTests();
    setWebVitalsSource(makeSource());
    setVitalsRouteProvider(() => '/dashboard');

    globalScope.TESLASYNC_API_BASE_URL = `${API_BASE}/`;

    beacon = jest.fn<boolean, [string, unknown?]>(() => true);
    setSendBeacon(beacon as unknown as (url: string, data?: unknown) => boolean);

    originalBlob = globalScope.Blob;
    globalScope.Blob = MockBlob;

    originalFetch = globalScope.fetch;
    fetchSpy = jest.fn<Promise<Response>, [string, RequestInit?]>(() =>
      Promise.resolve(new Response(null, {status: 204})),
    );
    globalScope.fetch = fetchSpy;
  });

  afterEach(() => {
    __resetWebVitalsReporterForTests();
    jest.clearAllTimers();
    jest.useRealTimers();
    setSendBeacon(undefined);
    globalScope.Blob = originalBlob;
    if (originalFetch === undefined) {
      delete globalScope.fetch;
    } else {
      globalScope.fetch = originalFetch;
    }
    globalScope.TESLASYNC_API_BASE_URL = undefined;
  });

  test('registers callbacks for LCP, INP, CLS, FCP, and TTFB', () => {
    startWebVitalsReporter();
    expect(typeof registeredCallbacks.LCP).toBe('function');
    expect(typeof registeredCallbacks.INP).toBe('function');
    expect(typeof registeredCallbacks.CLS).toBe('function');
    expect(typeof registeredCallbacks.FCP).toBe('function');
    expect(typeof registeredCallbacks.TTFB).toBe('function');
  });

  test('is idempotent — registering twice does not double-register', () => {
    startWebVitalsReporter();
    const firstLCP = registeredCallbacks.LCP;
    const sentinel = jest.fn();
    registeredCallbacks.LCP = sentinel;
    startWebVitalsReporter();
    expect(registeredCallbacks.LCP).toBe(sentinel);
    expect(firstLCP).not.toBe(sentinel);
  });

  test('coalesces metrics into a single batch and ships via sendBeacon', async () => {
    startWebVitalsReporter();

    registeredCallbacks.LCP?.(makeMetric({name: 'LCP', value: 1500, id: 'lcp-1'}));
    registeredCallbacks.CLS?.(
      makeMetric({name: 'CLS', value: 0.05, id: 'cls-1', rating: 'good'}),
    );
    registeredCallbacks.INP?.(makeMetric({name: 'INP', value: 200, id: 'inp-1'}));

    expect(beacon).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2_000);

    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, payload] = beacon.mock.calls[0];
    expect(url).toBe(EXPECTED_URL);
    expect(payload).toBeInstanceOf(MockBlob);
    const text = await (payload as MockBlob).text();
    const parsed = JSON.parse(text) as {metrics: VitalsPayload[]};
    expect(parsed.metrics).toHaveLength(3);
    expect(parsed.metrics.map(m => m.name).sort()).toEqual(['CLS', 'INP', 'LCP']);
    expect(parsed.metrics[0].route).toBe('/dashboard');
  });

  test('falls back to fetch when sendBeacon is unavailable', async () => {
    setSendBeacon(undefined);
    startWebVitalsReporter();
    registeredCallbacks.FCP?.(makeMetric({name: 'FCP', value: 800}));

    await jest.advanceTimersByTimeAsync(2_000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(EXPECTED_URL);
    const requestInit = init as RequestInit;
    expect(requestInit.method).toBe('POST');
    expect((requestInit.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect((requestInit as {keepalive?: boolean}).keepalive).toBe(true);
    const parsed = JSON.parse(requestInit.body as string) as {
      metrics: VitalsPayload[];
    };
    expect(parsed.metrics).toHaveLength(1);
    expect(parsed.metrics[0].name).toBe('FCP');
  });

  test('falls back to fetch when sendBeacon refuses the payload', async () => {
    beacon.mockReturnValue(false);
    startWebVitalsReporter();
    registeredCallbacks.LCP?.(makeMetric({name: 'LCP', value: 1500}));

    await jest.advanceTimersByTimeAsync(2_000);

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('flushes when the app moves to the background (AppState analog)', async () => {
    const addSpy = jest.spyOn(AppState, 'addEventListener');
    startWebVitalsReporter();
    registeredCallbacks.LCP?.(makeMetric({name: 'LCP', value: 1500}));

    const handler = addSpy.mock.calls[0]?.[1] as (s: AppStateStatus) => void;
    expect(typeof handler).toBe('function');
    handler('background');

    await Promise.resolve();
    expect(beacon).toHaveBeenCalledTimes(1);
    addSpy.mockRestore();
  });

  test('does not call sendBeacon or fetch when the queue is empty', async () => {
    startWebVitalsReporter();
    await flush();
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('swallows network errors without throwing', async () => {
    setSendBeacon(undefined);
    fetchSpy.mockImplementation(() => Promise.reject(new Error('network down')));

    startWebVitalsReporter();
    registeredCallbacks.TTFB?.(makeMetric({name: 'TTFB', value: 120}));

    await expect(jest.advanceTimersByTimeAsync(2_000)).resolves.not.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('drops the batch when consent is required and not yet accepted', async () => {
    setVitalsConsentRequirement(true);
    startWebVitalsReporter();
    registeredCallbacks.LCP?.(makeMetric({name: 'LCP', value: 1500}));

    await jest.advanceTimersByTimeAsync(2_000);

    expect(beacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
