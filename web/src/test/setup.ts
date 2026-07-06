/**
 * Shared test setup + reusable jsdom polyfills / mock factories.
 *
 * jsdom ships without several browser APIs that the TeslaSync component tree
 * reaches for transitively:
 *   - `IntersectionObserver` — framer-motion `useInView` (FadeIn, lazy charts)
 *   - `ResizeObserver`       — recharts `ResponsiveContainer`, react-grid-layout
 *   - `EventSource`          — the SSE live-signal hub
 *   - a controllable `window.matchMedia` — responsive `useMediaQuery` hooks
 *
 * The canonical *global* registration lives in `src/test-setup.ts` (wired via
 * `vitest.config` `setupFiles`). This module exposes the SAME primitives as
 * named, strongly-typed, individually-importable helpers so a single test can
 * opt into a bespoke instance — drive a `matchMedia` transition, emit an SSE
 * message, assert an element was observed — instead of re-declaring the ad-hoc
 * inline `class MockResizeObserver {}` that has been copy-pasted across a dozen
 * `*.test.tsx` files.
 *
 * Importing this module is side-effect-light: it only registers the
 * `@testing-library/jest-dom` matchers (idempotent — the global setup already
 * loaded them) and defines inert classes. Nothing touches `globalThis` or
 * `window` until you explicitly call `installTestPolyfills()` /
 * `patchMatchMedia()`.
 */
import '@testing-library/jest-dom'

// A minimal structural view of an object we can hang browser globals off of:
// `globalThis` in real use, or a throwaway fake target in unit tests.
type GlobalLike = Record<string, unknown>

/**
 * jsdom-safe `IntersectionObserver`. `observe()` reports the target as fully
 * intersecting immediately so `useInView`-gated content (FadeIn, lazy charts)
 * mounts synchronously under test rather than staying invisible forever.
 */
export class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly thresholds: ReadonlyArray<number>
  /** Targets currently observed — exposed for assertions. */
  readonly observed = new Set<Element>()

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.root = options?.root ?? null
    this.rootMargin = options?.rootMargin ?? '0px'
    const threshold = options?.threshold
    this.thresholds = Array.isArray(threshold) ? threshold : [threshold ?? 0]
  }

  observe(target: Element): void {
    this.observed.add(target)
    const entry: IntersectionObserverEntry = {
      target,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: 0,
    }
    this.callback([entry], this)
  }

  unobserve(target: Element): void {
    this.observed.delete(target)
  }

  disconnect(): void {
    this.observed.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

/**
 * jsdom-safe `ResizeObserver`. The default `observe`/`disconnect` are enough to
 * stop recharts' `ResponsiveContainer` from throwing; `trigger()` lets a test
 * synchronously drive a resize callback when it needs to.
 */
export class MockResizeObserver implements ResizeObserver {
  /** Targets currently observed — exposed for assertions. */
  readonly observed = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.observed.add(target)
  }

  unobserve(target: Element): void {
    this.observed.delete(target)
  }

  disconnect(): void {
    this.observed.clear()
  }

  /** Test helper: synchronously invoke the callback for an observed target. */
  trigger(target: Element): void {
    const entry = {
      target,
      contentRect: target.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    } as unknown as ResizeObserverEntry
    this.callback([entry], this)
  }
}

export type EventSourceListener = (event: MessageEvent) => void

/**
 * jsdom-safe `EventSource` for SSE tests. Opens synchronously and exposes
 * `emit*` helpers so a test can push named events / messages / errors without a
 * real network connection.
 */
export class MockEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2

  readyState: number = MockEventSource.CONNECTING
  readonly url: string
  readonly withCredentials: boolean
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private readonly listeners = new Map<string, Set<EventSourceListener>>()

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = String(url)
    this.withCredentials = init?.withCredentials ?? false
    this.readyState = MockEventSource.OPEN
  }

  addEventListener(type: string, listener: EventSourceListener): void {
    const set = this.listeners.get(type) ?? new Set<EventSourceListener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: EventSourceListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatchEvent(_event: Event): boolean {
    return true
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED
  }

  /** Mark the stream open and fire `onopen`. */
  emitOpen(): void {
    this.readyState = MockEventSource.OPEN
    this.onopen?.(new Event('open'))
  }

  /**
   * Deliver a message. Non-string payloads are JSON-serialised to mirror the
   * wire format the real SSE hub emits. `type === 'message'` also fires the
   * `onmessage` handler; named events reach `addEventListener` subscribers.
   */
  emit(type: string, data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    const event = new MessageEvent(type, { data: payload })
    if (type === 'message') this.onmessage?.(event)
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }

  /** Transition to an error state and fire `onerror`. */
  emitError(): void {
    this.readyState = MockEventSource.CLOSED
    this.onerror?.(new Event('error'))
  }
}

export interface InstallPolyfillOptions {
  /** Overwrite an existing global even if one is already defined. */
  force?: boolean
}

/**
 * Install the jsdom polyfills (`IntersectionObserver`, `ResizeObserver`,
 * `EventSource`) onto `target` (defaults to `globalThis`). By default an
 * already-present global is left untouched; pass `{ force: true }` to override.
 *
 * @returns a restore function that reverts every global this call changed back
 *   to its prior value (or removes it if there was none).
 */
export function installTestPolyfills(
  target: GlobalLike = globalThis as unknown as GlobalLike,
  options: InstallPolyfillOptions = {},
): () => void {
  const { force = false } = options
  const restorers: Array<() => void> = []

  const define = (key: string, value: unknown): void => {
    if (!force && target[key] !== undefined) return
    const had = Object.prototype.hasOwnProperty.call(target, key)
    const previous = target[key]
    target[key] = value
    restorers.push(() => {
      if (had) target[key] = previous
      else delete target[key]
    })
  }

  define('IntersectionObserver', MockIntersectionObserver)
  define('ResizeObserver', MockResizeObserver)
  define('EventSource', MockEventSource)

  return () => {
    while (restorers.length) restorers.pop()?.()
  }
}

export interface MatchMediaController {
  /** Notify every `change` listener registered for `query` that it flipped. */
  fire: (query: string, matches: boolean) => void
  /** Restore the previous `window.matchMedia` (or remove the stub). */
  restore: () => void
}

/**
 * Install a controllable `window.matchMedia` stub. `matches(query)` decides the
 * initial match state per query; `fire(query, next)` replays a media-query
 * change to registered listeners so reactive hooks (`useMediaQuery`) update.
 */
export function patchMatchMedia(
  matches: (query: string) => boolean,
  win: Window = window,
): MatchMediaController {
  const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>()

  const factory = (query: string): MediaQueryList => {
    const set = listeners.get(query) ?? new Set<(event: MediaQueryListEvent) => void>()
    listeners.set(query, set)
    const mql = {
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === 'change') set.add(listener)
      },
      removeEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === 'change') set.delete(listener)
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => set.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) => set.delete(listener),
      dispatchEvent: () => true,
    }
    return mql as unknown as MediaQueryList
  }

  const previous = Object.getOwnPropertyDescriptor(win, 'matchMedia')
  Object.defineProperty(win, 'matchMedia', {
    configurable: true,
    writable: true,
    value: factory,
  })

  return {
    fire: (query, next) => {
      const set = listeners.get(query)
      if (!set) return
      const event = { matches: next, media: query } as MediaQueryListEvent
      set.forEach((listener) => listener(event))
    },
    restore: () => {
      if (previous) Object.defineProperty(win, 'matchMedia', previous)
      else Reflect.deleteProperty(win, 'matchMedia')
    },
  }
}
