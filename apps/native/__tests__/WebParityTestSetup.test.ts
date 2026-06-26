import {
  DEFAULT_TEST_TIMEZONE,
  InstalledTestGlobals,
  MockEventSource,
  MockIntersectionObserver,
  MockResizeObserver,
  ParityIntersectionObserverEntry,
  defaultSettingsMock,
  defaultUseSettingsMockReturn,
  installWebParityTestEnvironment,
  installWebParityTestGlobals,
  mockUseSettings,
  mockUseTimezone,
  nativeTestSetupCapabilities,
  resetWebParityTestState,
} from '../src/web-parity/test-setup';

// Native parity coverage for web/src/test-setup.ts. The web file was a Vitest
// `setupFiles` entry; React Native runs on Jest, so the ported module exposes
// the setup's mock payloads + global doubles as reusable exports. These tests
// exercise every ported section.

type GlobalWithBrowserDoubles = typeof globalThis & {
  IntersectionObserver?: unknown;
  ResizeObserver?: unknown;
  EventSource?: unknown;
};

describe('web-parity test-setup', () => {
  describe('default settings mock', () => {
    it('mirrors the web defaults object (km / C / bar, rated range)', () => {
      expect(defaultSettingsMock.unit_of_length).toBe('km');
      expect(defaultSettingsMock.unit_of_temp).toBe('C');
      expect(defaultSettingsMock.unit_of_pressure).toBe('bar');
      expect(defaultSettingsMock.preferred_range).toBe('rated');
      expect(defaultSettingsMock.base_cost_per_kwh).toBe(0.12);
      expect(defaultSettingsMock.locale).toBe('en-US');
      expect(defaultSettingsMock.decimal_precision).toBe(2);
      expect(defaultSettingsMock.ai_mode).toBe('off');
      expect(defaultSettingsMock.ai_features).toEqual({});
    });

    it('derives the useSettings() return values (metric, comfortable)', () => {
      expect(defaultUseSettingsMockReturn.isMiles).toBe(false);
      expect(defaultUseSettingsMockReturn.isFahrenheit).toBe(false);
      expect(defaultUseSettingsMockReturn.isPSI).toBe(false);
      expect(defaultUseSettingsMockReturn.decimals).toBe(2);
      expect(defaultUseSettingsMockReturn.density).toBe('comfortable');
      expect(defaultUseSettingsMockReturn.rangeType).toBe('rated');
      expect(defaultUseSettingsMockReturn.settings).toBe(defaultSettingsMock);
    });

    it('mockUseSettings() returns the derived payload', () => {
      expect(mockUseSettings()).toBe(defaultUseSettingsMockReturn);
    });
  });

  describe('timezone mock', () => {
    it('defaults to UTC', () => {
      expect(DEFAULT_TEST_TIMEZONE).toBe('UTC');
      expect(mockUseTimezone()).toBe('UTC');
    });
  });

  describe('resetWebParityTestState', () => {
    it('invokes the resilience latch reset hook when present', () => {
      const reset = jest.fn();
      resetWebParityTestState({_resetAuthExpiredLatch: reset});
      expect(reset).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the module or hook is absent', () => {
      expect(() => resetWebParityTestState()).not.toThrow();
      expect(() => resetWebParityTestState({})).not.toThrow();
    });

    it('swallows errors thrown by a mocked module', () => {
      expect(() =>
        resetWebParityTestState({
          _resetAuthExpiredLatch: () => {
            throw new Error('stripped hook');
          },
        }),
      ).not.toThrow();
    });
  });

  describe('MockIntersectionObserver', () => {
    it('immediately reports the target as fully intersecting', () => {
      const entries: ParityIntersectionObserverEntry[] = [];
      const observer = new MockIntersectionObserver(received => {
        entries.push(...received);
      });
      observer.observe();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({isIntersecting: true, intersectionRatio: 1});
    });

    it('exposes inert unobserve / disconnect / takeRecords', () => {
      const observer = new MockIntersectionObserver(() => {});
      expect(observer.takeRecords()).toEqual([]);
      expect(() => observer.unobserve()).not.toThrow();
      expect(() => observer.disconnect()).not.toThrow();
      expect(observer.root).toBeNull();
      expect(observer.rootMargin).toBe('');
      expect(observer.thresholds).toEqual([]);
    });
  });

  describe('MockResizeObserver', () => {
    it('provides callable no-op methods', () => {
      const observer = new MockResizeObserver();
      expect(() => observer.observe()).not.toThrow();
      expect(() => observer.unobserve()).not.toThrow();
      expect(() => observer.disconnect()).not.toThrow();
    });
  });

  describe('MockEventSource', () => {
    it('opens immediately and exposes the readyState constants', () => {
      expect(MockEventSource.CONNECTING).toBe(0);
      expect(MockEventSource.OPEN).toBe(1);
      expect(MockEventSource.CLOSED).toBe(2);

      const es = new MockEventSource('/events');
      expect(es.url).toBe('/events');
      expect(es.readyState).toBe(1);
      expect(es.onopen).toBeNull();
      expect(es.onmessage).toBeNull();
      expect(es.onerror).toBeNull();
    });

    it('close() moves readyState to CLOSED and listeners are inert', () => {
      const es = new MockEventSource('/events');
      expect(() => es.addEventListener()).not.toThrow();
      expect(() => es.removeEventListener()).not.toThrow();
      expect(es.dispatchEvent()).toBe(true);
      es.close();
      expect(es.readyState).toBe(2);
    });
  });

  describe('installWebParityTestGlobals', () => {
    const g = globalThis as GlobalWithBrowserDoubles;
    let savedIO: unknown;
    let savedRO: unknown;
    let savedES: unknown;

    beforeEach(() => {
      savedIO = g.IntersectionObserver;
      savedRO = g.ResizeObserver;
      savedES = g.EventSource;
      delete g.IntersectionObserver;
      delete g.ResizeObserver;
      delete g.EventSource;
    });

    afterEach(() => {
      g.IntersectionObserver = savedIO;
      g.ResizeObserver = savedRO;
      g.EventSource = savedES;
    });

    it('installs all three doubles when the globals are absent', () => {
      const installed: InstalledTestGlobals = installWebParityTestGlobals();
      expect(installed).toEqual({
        intersectionObserver: true,
        resizeObserver: true,
        eventSource: true,
      });
      expect(g.IntersectionObserver).toBe(MockIntersectionObserver);
      expect(g.ResizeObserver).toBe(MockResizeObserver);
      expect(g.EventSource).toBe(MockEventSource);
    });

    it('preserves an existing observer but always replaces EventSource', () => {
      const existing = function ExistingObserver() {};
      g.IntersectionObserver = existing;
      const installed = installWebParityTestGlobals();
      expect(installed.intersectionObserver).toBe(false);
      expect(g.IntersectionObserver).toBe(existing);
      expect(installed.eventSource).toBe(true);
      expect(g.EventSource).toBe(MockEventSource);
    });

    it('installWebParityTestEnvironment bundles globals + payloads', () => {
      const env = installWebParityTestEnvironment();
      expect(env.globals.eventSource).toBe(true);
      expect(env.settings).toBe(defaultUseSettingsMockReturn);
      expect(env.timezone).toBe('UTC');
    });
  });

  describe('nativeTestSetupCapabilities', () => {
    it('marks DOM/Vitest behaviors unavailable and polyfills present', () => {
      expect(nativeTestSetupCapabilities.jestDomMatchers).toBe(false);
      expect(nativeTestSetupCapabilities.vitestModuleMocking).toBe(false);
      expect(nativeTestSetupCapabilities.jestModuleMocking).toBe(true);
      expect(nativeTestSetupCapabilities.intersectionObserverPolyfill).toBe(true);
      expect(nativeTestSetupCapabilities.resizeObserverPolyfill).toBe(true);
      expect(nativeTestSetupCapabilities.eventSourcePolyfill).toBe(true);
    });
  });
});
