/**
 * Unit tests for the `leafletGlobal` side-effect module.
 *
 * The module's entire job IS a side effect: it mirrors leaflet's default
 * export onto `window.L` so classical (non-ESM) leaflet plugins that look up
 * `window.L` at evaluation time — `leaflet.markercluster`, `leaflet-draw`,
 * `leaflet.heat` — can find it under Vite's ESM bundle. There are no runtime
 * exports to call, so every case drives the module through a fresh dynamic
 * `import()` (with `vi.resetModules()` in between) and asserts the global it
 * leaves behind.
 *
 * `leaflet` is mocked with a sentinel object so we can assert *identity*
 * (`window.L === <that object>`) without importing real leaflet — which pokes
 * at browser globals at import time — into the jsdom worker.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fakeLeaflet = { __sentinel_leaflet__: true } as const;

vi.mock('leaflet', () => ({ default: fakeLeaflet }));

type GlobalWithL = { L?: unknown };

const asGlobal = () => globalThis as GlobalWithL;
const asWindow = () => window as unknown as GlobalWithL;

describe('leafletGlobal (window.L mirror)', () => {
  beforeEach(() => {
    vi.resetModules();
    delete asGlobal().L;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete asGlobal().L;
  });

  it('mirrors the leaflet default export onto window.L when it is unset', async () => {
    expect(asWindow().L).toBeUndefined();

    await import('../leafletGlobal');

    expect(asWindow().L).toBe(fakeLeaflet);
    // window === globalThis under jsdom, so the same reference is visible to
    // plugins that reach for either handle.
    expect(asGlobal().L).toBe(fakeLeaflet);
  });

  it('never clobbers a leaflet already provided (e.g. by a CDN <script>)', async () => {
    const existing = { __cdn_leaflet__: true };
    asWindow().L = existing;

    await import('../leafletGlobal');

    expect(asWindow().L).toBe(existing);
    expect(asWindow().L).not.toBe(fakeLeaflet);
  });

  it('is idempotent across repeated evaluations (no clobber on re-import)', async () => {
    await import('../leafletGlobal');
    const first = asWindow().L;
    expect(first).toBe(fakeLeaflet);

    vi.resetModules();
    await import('../leafletGlobal');

    expect(asWindow().L).toBe(first);
  });

  it('is SSR-safe: assigns no global when window is undefined', async () => {
    vi.stubGlobal('window', undefined);
    expect(typeof window).toBe('undefined');

    await import('../leafletGlobal');

    expect(asGlobal().L).toBeUndefined();
  });

  it('exposes no runtime value exports (pure side-effect module)', async () => {
    const mod = await import('../leafletGlobal');

    const valueExports = Object.keys(mod).filter(
      (key) => (mod as Record<string, unknown>)[key] !== undefined,
    );
    expect(valueExports).toEqual([]);
    expect((mod as { default?: unknown }).default).toBeUndefined();
  });
});
