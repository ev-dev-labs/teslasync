import {
  PREFETCHABLE_PATHS,
  ROUTE_PREFETCH_NATIVE_UNAVAILABLE_REASON,
  isPrefetchablePath,
  prefetchRoute,
  __getPrefetchedForTests,
  __resetPrefetchedForTests,
} from '../src/web-parity/lib/routePrefetch';

declare const __dirname: string;
declare function require(moduleName: string): unknown;

const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};
const { resolve } = require('path') as {
  resolve: (...paths: string[]) => string;
};

const webSource = readFileSync(
  resolve(
    __dirname,
    '..',
    '..',
    '..',
    'web',
    'src',
    'lib',
    'routePrefetch.ts',
  ),
  'utf8',
);

function extractWebPreloaderKeys(source: string): string[] {
  return [...source.matchAll(/^\s*'([^']+)':\s*\(\)\s*=>\s*import\(/gm)].map(
    match => match[1],
  );
}

beforeEach(() => {
  __resetPrefetchedForTests();
});

describe('routePrefetch parity with web PRELOADERS', () => {
  test('PREFETCHABLE_PATHS equals the web routePrefetch.ts PRELOADERS keys', () => {
    const webKeys = extractWebPreloaderKeys(webSource);
    expect(webKeys.length).toBeGreaterThan(0);
    expect([...PREFETCHABLE_PATHS].sort()).toEqual([...webKeys].sort());
    expect(new Set(PREFETCHABLE_PATHS).size).toBe(PREFETCHABLE_PATHS.length);
  });

  test('isPrefetchablePath returns true for every web preloader key', () => {
    for (const key of extractWebPreloaderKeys(webSource)) {
      expect(isPrefetchablePath(key)).toBe(true);
    }
  });
});

describe('isPrefetchablePath', () => {
  test('returns true for known top-level routes', () => {
    expect(isPrefetchablePath('/')).toBe(true);
    expect(isPrefetchablePath('/battery')).toBe(true);
    expect(isPrefetchablePath('/drives')).toBe(true);
    expect(isPrefetchablePath('/charging')).toBe(true);
    expect(isPrefetchablePath('/live')).toBe(true);
  });

  test('returns true for known parameterized routes (matched by literal pattern)', () => {
    expect(isPrefetchablePath('/vehicles/:id')).toBe(true);
  });

  test('returns false for unknown routes', () => {
    expect(isPrefetchablePath('/totally-not-a-route')).toBe(false);
    expect(isPrefetchablePath('/vehicles/123')).toBe(false);
  });

  test('returns false for empty / falsy paths', () => {
    expect(isPrefetchablePath('')).toBe(false);
  });
});

describe('prefetchRoute', () => {
  test('records a known path immediately on call', () => {
    prefetchRoute('/battery');
    expect(__getPrefetchedForTests()).toContain('/battery');
  });

  test('is idempotent for repeated calls with the same path', () => {
    prefetchRoute('/drives');
    prefetchRoute('/drives');
    prefetchRoute('/drives');
    const matches = __getPrefetchedForTests().filter(p => p === '/drives');
    expect(matches.length).toBe(1);
  });

  test('is a no-op for unknown paths', () => {
    prefetchRoute('/totally-not-a-route');
    expect(__getPrefetchedForTests()).toEqual([]);
  });

  test('is a no-op for empty paths', () => {
    prefetchRoute('');
    expect(__getPrefetchedForTests()).toEqual([]);
  });

  test('does not throw for unknown paths', () => {
    expect(() => prefetchRoute('/missing')).not.toThrow();
    expect(() => prefetchRoute('')).not.toThrow();
  });

  test('native no-op preload resolves and never evicts a tracked path', async () => {
    prefetchRoute('/charging');
    // Flush the preload microtask: on native the preloader resolves immediately
    // (single Metro bundle, nothing to download), so the eviction branch never
    // fires and the path stays tracked.
    await Promise.resolve();
    await Promise.resolve();
    expect(__getPrefetchedForTests()).toContain('/charging');
  });
});

describe('ROUTE_PREFETCH_NATIVE_UNAVAILABLE_REASON', () => {
  test('documents the browser-only chunk-prefetch seam', () => {
    expect(typeof ROUTE_PREFETCH_NATIVE_UNAVAILABLE_REASON).toBe('string');
    expect(ROUTE_PREFETCH_NATIVE_UNAVAILABLE_REASON.length).toBeGreaterThan(0);
  });
});
