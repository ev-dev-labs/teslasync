import '@testing-library/jest-dom'
import { beforeEach, vi } from 'vitest'
import * as resilience from '@/lib/resilience'

// Global default mock for useSettings. Many components reach for it
// transitively via useDateFormat / useUnits / useFormatting; without a
// stub these components fail with "No QueryClient set" inside jsdom
// because a bare render() doesn't wrap in QueryClientProvider. Tests
// that need bespoke settings can still vi.mock('@/hooks/useSettings')
// in their own file — file-level vi.mock takes precedence over the
// setupFiles registration. The defaults here mirror the
// `defaults: AppSettings` object inside the real hook so transitive
// callers see the exact same values they would in production when no
// override row exists.
vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>(
    '@/hooks/useSettings',
  )
  const defaults = {
    unit_of_length: 'km' as const,
    unit_of_temp: 'C' as const,
    unit_of_pressure: 'bar' as const,
    preferred_range: 'rated' as const,
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark' as const,
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon' as const,
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant' as const,
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle' as const,
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable' as const,
    time_format_default: 'relative' as const,
    chart_palette: 'cb_safe' as const,
    ai_mode: 'off' as const,
    ai_features: {},
    ai_provider_config: {},
    ai_cost_cap_cents: 0,
  }
  return {
    ...actual,
    useSettings: () => ({
      settings: defaults,
      isMiles: false,
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  }
})

// useTimezone() transitively reaches useSelectedVehicle → useVehicles
// (react-query) AND useMatch / useSearchParams (Router context). Both
// crash in bare jsdom renders. Stub it to return UTC by default;
// tests that need vehicle/local-time can still mock it per-file.
vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>(
    '@/lib/timezone',
  )
  return {
    ...actual,
    useTimezone: () => 'UTC',
  }
})

// Reset the module-scoped auth-expired latch in resilience.ts between
// every test. vitest's per-file isolation is not enough on its own —
// within a single file, a test that exercises a 401 path will leave
// the latch set, and subsequent tests in that file would silently
// observe a no-op handleAuthExpired() call. Wrapped in a try/catch so
// tests that vi.mock('@/lib/resilience') without exposing the test
// hook don't blow up here.
beforeEach(() => {
  try {
    resilience._resetAuthExpiredLatch?.()
  } catch {
    /* test mocked the module and stripped the hook — fine */
  }
})

// Polyfill IntersectionObserver for jsdom (used by framer-motion's useInView)
class MockIntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  constructor(private callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
  observe(target: Element) {
    // Immediately trigger with isIntersecting = true, echoing the observed
    // target back on the entry. The DOM contract guarantees every entry
    // carries its `target`; without it, consumers that key off
    // `entry.target` (rather than only `entry.isIntersecting`) would read
    // `undefined` under test.
    this.callback(
      [{ isIntersecting: true, intersectionRatio: 1, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = MockIntersectionObserver as any
}

// Polyfill ResizeObserver for jsdom (used by Recharts ResponsiveContainer,
// react-grid-layout, and a handful of our own chart wrappers). Individual
// test files used to install ad-hoc `vi.stubGlobal('ResizeObserver', …)`,
// but as soon as a non-stubbing test imports a chart/grid component
// transitively, jsdom throws `ReferenceError: ResizeObserver is not
// defined`. Installing it globally here matches what we do for
// IntersectionObserver and EventSource and removes the per-test boilerplate.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = MockResizeObserver as any
}

// Mock EventSource for SSE tests (not available in jsdom)
global.EventSource = class EventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  readyState = 0
  url: string
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    this.readyState = 1
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true }
  close() { this.readyState = 2 }
} as any
