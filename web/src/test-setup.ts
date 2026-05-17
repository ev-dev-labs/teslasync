import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import * as resilience from '@/lib/resilience'

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
  observe(_target: Element) {
    // Immediately trigger with isIntersecting = true
    this.callback(
      [{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
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
