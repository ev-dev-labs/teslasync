import '@testing-library/jest-dom'

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
