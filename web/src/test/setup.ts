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
  const instances = new Map<string, Set<MediaQueryList>>()
  const currentMatches = new Map<string, boolean>()

  const factory = (query: string): MediaQueryList => {
    const set = listeners.get(query) ?? new Set<(event: MediaQueryListEvent) => void>()
    listeners.set(query, set)
    const queryInstances = instances.get(query) ?? new Set<MediaQueryList>()
    instances.set(query, queryInstances)
    const mql = {
      matches: currentMatches.get(query) ?? matches(query),
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
    queryInstances.add(mql as unknown as MediaQueryList)
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
      const event = { matches: next, media: query } as MediaQueryListEvent
      currentMatches.set(query, next)
      for (const mql of instances.get(query) ?? []) {
        Object.defineProperty(mql, 'matches', {
          configurable: true,
          writable: true,
          value: next,
        })
      }
      set?.forEach((listener) => listener(event))
    },
    restore: () => {
      if (previous) Object.defineProperty(win, 'matchMedia', previous)
      else Reflect.deleteProperty(win, 'matchMedia')
    },
  }
}

export type TranslationOptions = {
  count?: number
  defaultValue?: string
  defaultValue_one?: string
  defaultValue_other?: string
  replace?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface TranslationMockResources {
  [key: string]: unknown
}

export interface TranslationMockOptions {
  language?: string
  resources?: TranslationMockResources
  onLanguageChange?: (language: string) => void
}

export function interpolateTranslation(
  text: string,
  values: Record<string, unknown> | null | undefined,
): string {
  if (!values) return text
  return text.replace(/{{\s*([^{}\s]+)\s*}}/g, (_match, key: string) => {
    const value = values[key]
    return value == null ? '' : String(value)
  })
}

function readTranslationResource(
  resources: TranslationMockResources | undefined,
  key: string,
  language: string,
): unknown {
  const languageRoot = resources?.[language]
  const current =
    languageRoot && typeof languageRoot === 'object'
      && Object.prototype.hasOwnProperty.call(languageRoot, 'translation')
      ? (languageRoot as Record<string, unknown>).translation
      : languageRoot
  if (!current || typeof current !== 'object') return undefined
  let cursor = current as Record<string, unknown>
  for (const segment of key.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = cursor[segment] as Record<string, unknown>
  }
  return cursor
}

export function createTranslationT(options: TranslationMockOptions = {}) {
  const state = {
    language: options.language ?? 'en',
  }
  const t = (
    key: string,
    second?: string | TranslationOptions | null,
    third?: TranslationOptions | null,
  ): string => {
    const explicitFallback = typeof second === 'string' ? second : undefined
    const bag = (
      typeof second === 'object' && second !== null ? second : third
    ) as TranslationOptions | undefined
    const resource = readTranslationResource(options.resources, key, state.language)
    const plainResource = typeof resource === 'string' ? resource : undefined

    let fallback: string
    if (typeof bag?.count === 'number') {
      fallback =
        bag.count === 1
          ? bag.defaultValue_one ?? explicitFallback ?? plainResource ?? key
          : bag.defaultValue_other ?? explicitFallback ?? plainResource ?? key
    } else {
      fallback =
        explicitFallback
        ?? (typeof bag?.defaultValue === 'string' ? bag.defaultValue : undefined)
        ?? plainResource
        ?? key
    }

    const values = bag?.replace && typeof bag.replace === 'object'
      ? bag.replace
      : bag
    return interpolateTranslation(fallback, values as Record<string, unknown> | undefined)
  }
  const setLanguage = (language: string) => {
    state.language = language
    options.onLanguageChange?.(language)
    return Promise.resolve(language)
  }
  return {
    t,
    i18n: {
      get language() {
        return state.language
      },
      changeLanguage: setLanguage,
    },
  }
}

export function createReactI18nextMock(options: TranslationMockOptions = {}) {
  const translation = createTranslationT(options)
  return {
    useTranslation: () => translation,
    Trans: ({ children }: { children?: unknown }) => children,
    I18nextProvider: ({ children }: { children?: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  }
}

/**
 * A deterministic in-process BroadcastChannel test double. Messages posted by
 * a channel are delivered asynchronously to every other open channel with the
 * same name, matching the browser's cross-context behavior.
 */
export class MockBroadcastChannel extends EventTarget implements BroadcastChannel {
  static readonly instances = new Map<string, Set<MockBroadcastChannel>>()

  readonly name: string
  readonly referrerPolicy = 'strict-origin-when-cross-origin'
  onmessage: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null
  onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null

  constructor(name: string) {
    super()
    this.name = String(name)
    const peers = MockBroadcastChannel.instances.get(this.name)
      ?? new Set<MockBroadcastChannel>()
    peers.add(this)
    MockBroadcastChannel.instances.set(this.name, peers)
  }

  postMessage(message: unknown): void {
    queueMicrotask(() => {
      if (!this.closed) {
        const peers = MockBroadcastChannel.instances.get(this.name)
        peers?.forEach((peer) => {
          if (peer !== this && !peer.closed) peer.emitMessage(message)
        })
      }
    })
  }

  emitMessage(message: unknown): void {
    const event = new MessageEvent('message', { data: message })
    this.onmessage?.call(this as unknown as BroadcastChannel, event)
    this.dispatchEvent(event)
  }

  emitMessageError(message: unknown): void {
    const event = new MessageEvent('messageerror', { data: message })
    this.onmessageerror?.call(this as unknown as BroadcastChannel, event)
    this.dispatchEvent(event)
  }

  private isClosed = false
  get closed(): boolean {
    return this.isClosed
  }

  close(): void {
    if (this.isClosed) return
    this.isClosed = true
    const peers = MockBroadcastChannel.instances.get(this.name)
    peers?.delete(this)
    if (peers?.size === 0) MockBroadcastChannel.instances.delete(this.name)
  }

  static reset(): void {
    for (const peers of MockBroadcastChannel.instances.values()) {
      for (const peer of peers) peer.close()
    }
    MockBroadcastChannel.instances.clear()
  }
}

export function patchBroadcastChannel(
  target: GlobalLike = globalThis as unknown as GlobalLike,
): () => void {
  const previous = Object.getOwnPropertyDescriptor(target, 'BroadcastChannel')
  MockBroadcastChannel.reset()
  target.BroadcastChannel = MockBroadcastChannel
  return () => {
    MockBroadcastChannel.reset()
    if (previous) Object.defineProperty(target, 'BroadcastChannel', previous)
    else Reflect.deleteProperty(target, 'BroadcastChannel')
  }
}

export class MockServiceWorkerRegistration {
  readonly scope = 'http://localhost/'
  active: ServiceWorker | null = null
  waiting: ServiceWorker | null = null
  installing: ServiceWorker | null = null

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true
  }
  private updateImpl: () => Promise<void> = async () => {}
  setUpdateImpl(updateImpl: () => Promise<void>): void {
    this.updateImpl = updateImpl
  }
  async update(): Promise<void> {
    await this.updateImpl()
  }
  async unregister(): Promise<boolean> {
    return true
  }
  async showNotification(): Promise<void> {}
  async getNotifications(): Promise<readonly Notification[]> {
    return []
  }
}

export class MockServiceWorkerLifecycle {
  readonly registration: MockServiceWorkerRegistration
  readonly controller = {
    postMessage: (_message: unknown, _transfer?: Transferable[]) => {},
  } as unknown as ServiceWorker

  private readonly containerListeners = new Set<(event: Event) => void>()
  private readonly messageListeners = new Set<(event: MessageEvent) => void>()
  private readonly registrations: MockServiceWorkerRegistration[] = []
  private controllerValue: ServiceWorker | null = null
  readyResolve!: () => void
  readonly ready: Promise<ServiceWorkerRegistration>

  readonly container = {
    get controller() {
      return this.containerController
    },
    containerController: null as ServiceWorker | null,
    ready: undefined as Promise<ServiceWorkerRegistration> | undefined,
    register: async () => this.registration,
    getRegistration: async () => this.registration,
    getRegistrations: async () => this.registrations,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'controllerchange') {
        this.containerListeners.add(listener as (event: Event) => void)
      }
      if (type === 'message') {
        this.messageListeners.add(listener as (event: MessageEvent) => void)
      }
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'controllerchange') {
        this.containerListeners.delete(listener as (event: Event) => void)
      }
      if (type === 'message') {
        this.messageListeners.delete(listener as (event: MessageEvent) => void)
      }
    },
    startMessages: () => undefined,
  }

  constructor() {
    this.registration = new MockServiceWorkerRegistration()
    this.registrations.push(this.registration)
    this.ready = new Promise<ServiceWorkerRegistration>((resolve) => {
      this.readyResolve = () => resolve(this.registration as unknown as ServiceWorkerRegistration)
    })
    this.container.ready = this.ready
  }

  setUpdateImpl(updateImpl: () => Promise<void>): void {
    this.registration.setUpdateImpl(updateImpl)
  }

  installWaiting(): void {
    this.registration.waiting = this.controller
  }

  activate(): void {
    this.registration.waiting = null
    this.registration.active = this.controller
    this.controllerValue = this.controller
    this.container.containerController = this.controller
    this.readyResolve()
    const event = new Event('controllerchange')
    this.containerListeners.forEach((listener) => listener(event))
  }

  updateFailure(error: unknown): Promise<void> {
    return Promise.reject(error)
  }

  emitMessage(data: unknown): void {
    const event = new MessageEvent('message', { data })
    this.messageListeners.forEach((listener) => listener(event))
  }
}

export interface ServiceWorkerLifecycleController {
  lifecycle: MockServiceWorkerLifecycle
  restore: () => void
}

export function patchServiceWorkerLifecycle(
  nav: Navigator = navigator,
): ServiceWorkerLifecycleController {
  const lifecycle = new MockServiceWorkerLifecycle()
  const previous = Object.getOwnPropertyDescriptor(nav, 'serviceWorker')
  Object.defineProperty(nav, 'serviceWorker', {
    configurable: true,
    writable: true,
    value: lifecycle.container,
  })
  return {
    lifecycle,
    restore: () => {
      if (previous) Object.defineProperty(nav, 'serviceWorker', previous)
      else Reflect.deleteProperty(nav, 'serviceWorker')
    },
  }
}

export class TestCleanupRegistry {
  private readonly cleanups: Array<() => void> = []

  add(cleanup: () => void): () => void {
    this.cleanups.push(cleanup)
    return cleanup
  }

  cleanup(): void {
    while (this.cleanups.length) this.cleanups.pop()?.()
  }
}
