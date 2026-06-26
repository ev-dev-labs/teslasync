/**
 * Native parity port of web/src/test-setup.ts.
 *
 * The web file is the Vitest `setupFiles` entry that runs once before every
 * jsdom test. It (1) registers @testing-library/jest-dom matchers, (2) installs
 * default `vi.mock` stubs for `@/hooks/useSettings` and `@/lib/timezone`,
 * (3) resets the module-scoped auth-expired latch in `@/lib/resilience` in a
 * `beforeEach`, and (4) polyfills the browser globals jsdom lacks
 * (IntersectionObserver, ResizeObserver, EventSource).
 *
 * Web -> native adaptation (conversion contract rules 6 & 7):
 *   - The React Native suite runs on Jest with the `react-native` preset, not
 *     Vitest/jsdom. `vitest` and `@testing-library/jest-dom` are NOT imported
 *     here — doing so would break the native typecheck/lint/test gates. Their
 *     responsibilities are represented as explicit native-safe capabilities and
 *     reusable payloads instead (see `nativeTestSetupCapabilities`).
 *   - `vi.mock(...)` hoisted module mocking has no import-time equivalent in a
 *     plain module, so the mock *data* (default settings object, derived
 *     `useSettings` return, default timezone) is exported as constants/factories
 *     that a per-file `jest.mock(...)` factory can return. This mirrors the web
 *     note that file-level mocks take precedence over the setup registration.
 *   - The browser globals absent from React Native are provided as native-safe
 *     classes and installed on demand through `installWebParityTestGlobals()`
 *     rather than mutating globals at import time, so importing this module in a
 *     production bundle has no side effects.
 *   - `@/lib/resilience` is not yet ported to native, so `resetWebParityTestState`
 *     accepts the resilience-like module as an optional argument and probes its
 *     `_resetAuthExpiredLatch` test hook exactly as the web `beforeEach` did,
 *     guarded by the same try/catch for suites that strip the hook.
 *
 * This module imports only platform-neutral TypeScript — no DOM modules, browser
 * HTML elements, Recharts, Leaflet, or old web UI components.
 */

/**
 * Capability matrix documenting which web/jsdom/Vitest test-setup behaviors are
 * available in the React Native environment versus replaced by a native-safe
 * adaptation. Mirrors, line for line, the four concerns of the web setup file.
 */
export const nativeTestSetupCapabilities = {
  // L1: `@testing-library/jest-dom` registers DOM-only matchers
  // (toBeInTheDocument, toHaveTextContent, ...). React Native renders a host
  // component tree, not the DOM, so those matchers are unavailable; native
  // suites assert via @testing-library/react-native / react-test-renderer.
  jestDomMatchers: false,
  // L2/L15/L72: Vitest's `vi.mock` hoisted module mocking is unavailable.
  vitestModuleMocking: false,
  // ...replaced by Jest's `jest.mock`, registered by individual native test
  // files; this module supplies the payloads those factories return.
  jestModuleMocking: true,
  // L97-117 / L119-134 / L136-157: browser globals absent from the RN runtime,
  // installed on demand via installWebParityTestGlobals() instead of at import.
  intersectionObserverPolyfill: true,
  resizeObserverPolyfill: true,
  eventSourcePolyfill: true,
} as const;

/**
 * Default settings payload (web test-setup L19-52). Mirrors the `defaults`
 * object inside the real `@/hooks/useSettings` so transitive callers
 * (useDateFormat / useUnits / useFormatting) observe the exact production values
 * that exist when no override row is present. A native `jest.mock` factory for a
 * settings hook returns this object.
 */
export const defaultSettingsMock = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
  currency_symbol: '$',
  locale: 'en-US',
  tz_display_default: 'vehicle',
  timezone_user: '',
  tab_badge_enabled: true,
  critical_flash_enabled: true,
  ui_density: 'comfortable',
  time_format_default: 'relative',
  chart_palette: 'cb_safe',
  ai_mode: 'off',
  ai_features: {} as Record<string, boolean>,
  ai_provider_config: {} as Record<string, unknown>,
  ai_cost_cap_cents: 0,
} as const;

export type WebParitySettingsMock = typeof defaultSettingsMock;

/**
 * Derived `useSettings()` return value (web test-setup L55-64). This is the
 * object the web mock factory's `useSettings: () => ({ ... })` produced; the
 * `...actual` spread is reproduced in native by a per-file
 * `jest.requireActual(...)` when a suite needs the non-mocked exports.
 */
export const defaultUseSettingsMockReturn = {
  settings: defaultSettingsMock,
  isMiles: false,
  isFahrenheit: false,
  isPSI: false,
  decimals: 2,
  locale: 'en-US',
  density: 'comfortable',
  rangeType: 'rated',
} as const;

export type WebParityUseSettingsReturn = typeof defaultUseSettingsMockReturn;

/** Factory mirroring the web mock's `useSettings: () => ({ ... })`. */
export function mockUseSettings(): WebParityUseSettingsReturn {
  return defaultUseSettingsMockReturn;
}

/**
 * Default timezone the web setup forced via `vi.mock('@/lib/timezone')`
 * (L72-80). useTimezone() transitively reaches react-query and Router context,
 * both of which crash in a bare render; returning 'UTC' keeps transitive callers
 * deterministic. Tests that need vehicle/local time mock it per-file.
 */
export const DEFAULT_TEST_TIMEZONE = 'UTC' as const;

/** Factory mirroring the web mock's `useTimezone: () => 'UTC'`. */
export function mockUseTimezone(): string {
  return DEFAULT_TEST_TIMEZONE;
}

/**
 * Shape of the `@/lib/resilience` module's test-only latch reset hook. The web
 * module exposes `_resetAuthExpiredLatch` so suites can clear the module-scoped
 * auth-expired latch between tests.
 */
export interface AuthExpiredLatchResettable {
  _resetAuthExpiredLatch?: () => void;
}

/**
 * Native equivalent of the web `beforeEach` (L89-95). Resets the module-scoped
 * auth-expired latch so a test that exercises a 401 path does not leave the
 * latch set for later tests in the same file. The resilience module is passed in
 * (it is not yet ported to native), and the call is guarded by the same
 * try/catch so suites that mock the module and strip the hook do not blow up.
 */
export function resetWebParityTestState(
  resilienceModule?: AuthExpiredLatchResettable,
): void {
  try {
    resilienceModule?._resetAuthExpiredLatch?.();
  } catch {
    /* a test mocked the module and stripped the hook — fine */
  }
}

/** Minimal native-safe entry type used by the IntersectionObserver double. */
export type ParityIntersectionObserverEntry = {
  readonly isIntersecting: boolean;
  readonly intersectionRatio: number;
};

export type ParityIntersectionObserverCallback = (
  entries: ParityIntersectionObserverEntry[],
  observer: MockIntersectionObserver,
) => void;

export interface ParityIntersectionObserverInit {
  readonly root?: unknown;
  readonly rootMargin?: string;
  readonly threshold?: number | number[];
}

/**
 * IntersectionObserver double (web test-setup L98-113). jsdom lacks
 * IntersectionObserver, which framer-motion's useInView depends on; the web mock
 * immediately reports the target as fully intersecting so in-view animations run
 * synchronously. The native runtime is likewise missing the global, so the same
 * double is reused. DOM `Element`/`IntersectionObserverEntry` types are replaced
 * by native-safe local types because React Native ships no DOM lib.
 */
export class MockIntersectionObserver {
  readonly root: unknown = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(
    private readonly callback: ParityIntersectionObserverCallback,
    _options?: ParityIntersectionObserverInit,
  ) {}

  observe(_target?: unknown): void {
    // Immediately trigger with isIntersecting = true.
    this.callback([{isIntersecting: true, intersectionRatio: 1}], this);
  }

  unobserve(_target?: unknown): void {}

  disconnect(): void {}

  takeRecords(): ParityIntersectionObserverEntry[] {
    return [];
  }
}

/**
 * ResizeObserver double (web test-setup L126-130). jsdom (and React Native) lack
 * ResizeObserver, which Recharts ResponsiveContainer / chart wrappers depend on;
 * a no-op double removes the per-test boilerplate the web comment describes.
 */
export class MockResizeObserver {
  observe(_target?: unknown): void {}

  unobserve(_target?: unknown): void {}

  disconnect(): void {}
}

/** Native-safe stand-ins for the DOM Event / MessageEvent the web mock typed. */
export type ParityEvent = {readonly type?: string};
export type ParityMessageEvent = {readonly type?: string; readonly data?: unknown};

/**
 * EventSource double for SSE tests (web test-setup L137-157). Neither jsdom nor
 * the React Native runtime provides EventSource; the double opens "immediately"
 * (readyState = OPEN) and exposes inert listener plumbing so SSE-driven parity
 * code resolves a constructor instead of throwing ReferenceError.
 */
export class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = 0;
  url: string;
  onopen: ((ev: ParityEvent) => void) | null = null;
  onmessage: ((ev: ParityMessageEvent) => void) | null = null;
  onerror: ((ev: ParityEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    this.readyState = 1;
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  dispatchEvent(): boolean {
    return true;
  }

  close(): void {
    this.readyState = 2;
  }
}

type MutableTestGlobal = typeof globalThis & {
  IntersectionObserver?: unknown;
  ResizeObserver?: unknown;
  EventSource?: unknown;
};

/** Records which globals installWebParityTestGlobals() actually assigned. */
export interface InstalledTestGlobals {
  intersectionObserver: boolean;
  resizeObserver: boolean;
  eventSource: boolean;
}

/**
 * Installs the browser-global doubles onto `globalThis`, mirroring the web
 * setup's conditional polyfills (L115-117 / L132-134) and unconditional
 * EventSource assignment (L137-157). IntersectionObserver and ResizeObserver are
 * only installed when absent so a host-provided polyfill wins; EventSource is
 * always replaced with the SSE test double, exactly as the web setup did.
 */
export function installWebParityTestGlobals(): InstalledTestGlobals {
  const g = globalThis as MutableTestGlobal;
  const installed: InstalledTestGlobals = {
    intersectionObserver: false,
    resizeObserver: false,
    eventSource: false,
  };

  if (typeof g.IntersectionObserver === 'undefined') {
    g.IntersectionObserver = MockIntersectionObserver;
    installed.intersectionObserver = true;
  }

  if (typeof g.ResizeObserver === 'undefined') {
    g.ResizeObserver = MockResizeObserver;
    installed.resizeObserver = true;
  }

  g.EventSource = MockEventSource;
  installed.eventSource = true;

  return installed;
}

export interface WebParityTestEnvironment {
  globals: InstalledTestGlobals;
  settings: WebParityUseSettingsReturn;
  timezone: string;
}

/**
 * Native analog of "the web setup file ran": installs the global doubles and
 * returns the default mock payloads in one call. A Jest `setupFiles` entry or an
 * individual native test can invoke this to reproduce the web setup's effects.
 */
export function installWebParityTestEnvironment(): WebParityTestEnvironment {
  const globals = installWebParityTestGlobals();
  return {
    globals,
    settings: defaultUseSettingsMockReturn,
    timezone: DEFAULT_TEST_TIMEZONE,
  };
}
