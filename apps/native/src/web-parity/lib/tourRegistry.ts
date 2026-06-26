// Native parity port of web/src/lib/tourRegistry.ts.
//
// Tour registry.
//
// Per-feature onboarding tours. Each definition declares its identity, the
// route it is most relevant on (used by the launcher to highlight "recommended
// for this page"), a version (bump to silently invalidate any previously stored
// completion flag — same trick as form drafts), and the ordered list of
// {@link TourStep} entries the user is walked through.
//
// Storage model (unchanged from web):
//   - Per-tour completion flag: `teslasync:tour:v{version}:{id}` ->
//     'completed' | 'skipped'. When the version stored on disk does not match
//     the registry version, the tour is treated as "not yet seen" so users get
//     re-prompted after a meaningful update.
//   - Launcher-seen flag: `teslasync:tour:list-seen` -> 'true' once the launcher
//     has been opened at least once. Used to surface the "More tours available"
//     hint to brand-new users.
//
// ## Native conversion (contract rules 6 + 7)
//
// React Native ships no `window`, no `localStorage`, and no same-document
// `CustomEvent`, so the three browser-bound seams are replaced — following the
// sibling cookieConsent.ts / broadcast.ts ports — by native-safe equivalents
// that keep the full public API and the exact storage-key contract:
//
//   1. localStorage (getTourStatus / isTourCompleted / markTour* / resetTour /
//      resetAllTours / hasSeenTourList / markTourListSeen): the web
//      `window.localStorage` (read/written under a `typeof window === 'undefined'`
//      guard) is replaced by a structural `TourStorage` seam that AUTO-DETECTS a
//      global `localStorage` (the react-native-web browser build / a host
//      polyfill) and is host-injectable via {@link setTourStorage}. On pure
//      native with neither, reads return the "not yet seen" default and writes
//      are a documented no-op ({@link TOUR_STORAGE_UNAVAILABLE_REASON}) — never
//      throwing. The key-iteration reset helpers use the same seam's
//      `length` / `key(i)` members.
//   2. CustomEvent dispatch (TOUR_START_EVENT / TOUR_OPEN_LAUNCHER_EVENT): the
//      web `window.dispatchEvent(new CustomEvent(...))` is replaced by an
//      in-process subscriber registry (the native analog of the same-document
//      event) PLUS a best-effort mirror onto a detected global event dispatcher,
//      so a react-native-web consumer using `window.addEventListener` still
//      receives the signal exactly as on the web. Native consumers subscribe via
//      the added {@link subscribeTourStart} / {@link subscribeTourLauncherOpen}
//      helpers — the native analog of `window.addEventListener`.
//   3. Registry imports (web `@/features/onboarding/tours/*`): only `drivesTour`
//      is ported into the native parity layer so far, so DRIVES_TOUR is imported
//      for real (identical relative path → maximum fidelity, real step data); the
//      other seven tours are NOT yet ported (each is converted in its own
//      file-by-file pass). A static import of a not-yet-existent native module
//      would not type-check, so each instead resolves to an explicit native-safe
//      placeholder that carries the real, verbatim tour metadata (id / routeMatch
//      / titleKey / titleFallback / descriptionKey / descriptionFallback /
//      version, plus main's pure `autoStart` predicate) with empty `steps` (the
//      step walkthrough is the unported UI part). A future pass swaps each
//      placeholder for the real native import — the same approach the dashboard
//      widget-registry ports (registry/vehicle.ts) use for not-yet-ported deps.
//
// The `TourStep` type (web `@/hooks/useTour`) is reproduced locally — useTour is
// not yet in the native parity layer — exactly as the sibling drivesTour /
// TourOverlay ports do; the data shape is unchanged.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, framer-motion,
// or web UI components are imported — only the already-ported native drivesTour
// data module.

import {DRIVES_TOUR} from '../features/onboarding/tours/drivesTour';

// ── Reproduced type contract (web `@/hooks/useTour`, not yet ported) ──────────

/**
 * Reproduced from web `@/hooks/useTour`. A single product-tour step. `target`
 * is the web CSS selector for the element to highlight — retained for shape
 * fidelity (the native TourOverlay only consumes placement/title/description).
 */
export interface TourStep {
  /** CSS selector (web) / element key (native) for the element to highlight. */
  target: string;
  /** Title of the tooltip. */
  title: string;
  /** Description text. */
  description: string;
  /** Position of the tooltip relative to the highlighted element. */
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** Optional: action to perform when this step is shown (e.g., open sidebar). */
  onShow?: () => void;
  /** Optional: action to perform when leaving this step. */
  onHide?: () => void;
}

export type TourCompletionStatus = 'completed' | 'skipped';

export interface TourDefinition {
  /** Stable identifier — used for storage key, registry lookup, telemetry */
  id: string;
  /**
   * Routes where the launcher should highlight this tour as
   * "recommended for this page". Provide a string for an exact prefix or a
   * RegExp for more nuanced matching (e.g. drive detail pages).
   */
  routeMatch: string | RegExp;
  /** i18n key for the tour's display name in the launcher */
  titleKey: string;
  /** English fallback for {@link titleKey} */
  titleFallback: string;
  /** i18n key for the one-line description */
  descriptionKey: string;
  /** English fallback for {@link descriptionKey} */
  descriptionFallback: string;
  /**
   * Bump this when the tour content materially changes. Any user whose
   * stored completion was at an older version gets the tour re-offered the
   * next time the auto-start predicate matches.
   */
  version: number;
  steps: TourStep[];
  /**
   * Optional predicate evaluated on route changes. When it returns true and
   * the tour has not been completed at the current version, the tour starts
   * automatically. Per the prompt, only the `main` tour opts in by default;
   * every other tour stays explicit (launcher-only) so we don't interrupt
   * users who already know the app.
   */
  autoStart?: (ctx: TourAutoStartContext) => boolean;
}

/** Context passed to {@link TourDefinition.autoStart} predicates. */
export interface TourAutoStartContext {
  pathname: string;
  vehicleCount: number;
}

// ── Native-safe storage seam (web `window.localStorage`) ─────────────────────
// React Native has no `window.localStorage`. The web helper read/wrote it
// directly under a `typeof window === 'undefined'` guard. The native port routes
// every read/write through a structural `TourStorage` (the Web-Storage members
// this module actually uses, including `length` / `key(i)` for the reset
// helpers) that prefers a host-injected backend, then an auto-detected global
// `localStorage`, and is otherwise `null` (no persistence) — never throwing.
// React Native's tsconfig omits the DOM lib, so `Storage` is modelled
// structurally (mirrors the cookieConsent / broadcast ports).

/**
 * Minimal Web-Storage-shaped backend used by the tour registry. The
 * react-native-web build's `localStorage` satisfies this structurally, and a
 * pure-native host can inject any conforming sync store via
 * {@link setTourStorage}.
 */
export interface TourStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let injectedStorage: TourStorage | null = null;

/**
 * Wire (or clear, with `null`) a host-provided persistent storage backend.
 * Passing `null` reverts to the auto-detected global `localStorage` when
 * available, otherwise the no-persistence default. Intended for pure-native
 * hosts that want real cross-launch persistence (e.g. an MMKV- or
 * sync-AsyncStorage-backed shim) and for tests that simulate storage.
 */
export function setTourStorage(storage: TourStorage | null): void {
  injectedStorage = storage;
}

function getGlobalStorage(): TourStorage | null {
  const candidate = (globalThis as typeof globalThis & {localStorage?: unknown})
    .localStorage;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const storage = candidate as Partial<TourStorage>;
  return typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function' &&
    typeof storage.key === 'function'
    ? (candidate as TourStorage)
    : null;
}

/**
 * Native-safe replacement for the web `typeof window !== 'undefined' &&
 * window.localStorage` access. Prefers a host-injected backend, then an
 * auto-detected global `localStorage`, and is `null` (no persistence) when
 * neither exists — never throwing.
 */
function safeTourStorage(): TourStorage | null {
  if (injectedStorage) {
    return injectedStorage;
  }
  try {
    return getGlobalStorage();
  } catch {
    return null;
  }
}

/**
 * Explicit no-persistence reason, surfaced (and documented in the parity
 * sidecar) so callers / log readers can tell "this tour has not been seen yet"
 * apart from "this platform cannot persist tour state". On pure native (no
 * global `localStorage`, no injected storage) every read returns the "not yet
 * seen" default and every write is a no-op — the same fallback the web helper
 * already takes when Web Storage is unavailable.
 */
export const TOUR_STORAGE_UNAVAILABLE_REASON =
  'React Native provides no localStorage; tour completion / launcher-seen flags ' +
  'are not persisted across launches (every tour reads as "not yet seen" and ' +
  'every write is a no-op) until a host injects a Web-Storage-shaped backend ' +
  'via setTourStorage. The react-native-web browser build auto-detects ' +
  'localStorage and persists with full web parity.';

const STORAGE_PREFIX = 'teslasync:tour';
const LIST_SEEN_KEY = `${STORAGE_PREFIX}:list-seen`;

function storageKey(id: string, version: number): string {
  return `${STORAGE_PREFIX}:v${version}:${id}`;
}

/** Returns the stored completion status for a tour at a given version, or null. */
export function getTourStatus(
  id: string,
  version: number,
): TourCompletionStatus | null {
  const ls = safeTourStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(storageKey(id, version));
    if (raw === 'completed' || raw === 'skipped') return raw;
    return null;
  } catch {
    return null;
  }
}

/** True when the user has finished or skipped the tour at the current version. */
export function isTourCompleted(id: string, version: number): boolean {
  return getTourStatus(id, version) !== null;
}

/** Marks a tour as completed (user finished all steps). */
export function markTourCompleted(id: string, version: number): void {
  const ls = safeTourStorage();
  if (!ls) return;
  try {
    ls.setItem(storageKey(id, version), 'completed');
  } catch {
    /* localStorage quota / disabled — non-fatal */
  }
}

/** Marks a tour as skipped (user closed mid-way). */
export function markTourSkipped(id: string, version: number): void {
  const ls = safeTourStorage();
  if (!ls) return;
  try {
    ls.setItem(storageKey(id, version), 'skipped');
  } catch {
    /* non-fatal */
  }
}

/** Clears the completion flag for a single tour (any version). */
export function resetTour(id: string): void {
  const ls = safeTourStorage();
  if (!ls) return;
  try {
    const prefix = `${STORAGE_PREFIX}:`;
    const suffix = `:${id}`;
    const toRemove: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key && key.startsWith(prefix) && key.endsWith(suffix)) {
        toRemove.push(key);
      }
    }
    toRemove.forEach(k => ls.removeItem(k));
  } catch {
    /* non-fatal */
  }
}

/** Clears every per-tour completion flag and the list-seen marker. */
export function resetAllTours(): void {
  const ls = safeTourStorage();
  if (!ls) return;
  try {
    const prefix = `${STORAGE_PREFIX}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key && key.startsWith(prefix)) toRemove.push(key);
    }
    toRemove.forEach(k => ls.removeItem(k));
    // Legacy single-flag from the pre-Prompt-65 implementation. Removing it
    // ensures "Reset all tours" actually re-enables the dashboard auto-start
    // for users who completed the tour before the migration.
    ls.removeItem('teslasync-tour-completed');
  } catch {
    /* non-fatal */
  }
}

/** Has the launcher been opened at least once? */
export function hasSeenTourList(): boolean {
  const ls = safeTourStorage();
  if (!ls) return false;
  try {
    return ls.getItem(LIST_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Records that the launcher has been opened. */
export function markTourListSeen(): void {
  const ls = safeTourStorage();
  if (!ls) return;
  try {
    ls.setItem(LIST_SEEN_KEY, 'true');
  } catch {
    /* non-fatal */
  }
}

/** True when the path matches the tour's route hint. */
export function isRecommendedForRoute(
  def: TourDefinition,
  pathname: string,
): boolean {
  if (typeof def.routeMatch === 'string') {
    if (def.routeMatch === '/') return pathname === '/';
    return (
      pathname === def.routeMatch || pathname.startsWith(`${def.routeMatch}/`)
    );
  }
  return def.routeMatch.test(pathname);
}

// ── Native-safe event seam (web same-document `window` CustomEvent) ───────────

/**
 * Custom event name used to start a tour from anywhere in the app
 * (TourLauncher, command palette, status-bar menus, etc). The Layout listens
 * for this event and resolves the id against {@link TOURS}.
 */
export const TOUR_START_EVENT = 'teslasync:tour:start';

/**
 * Custom event name used to open the launcher (the modal that lists every
 * available tour). Mirrors the existing `toggle-keyboard-shortcuts` pattern
 * so the launcher does not need to be threaded through React context.
 */
export const TOUR_OPEN_LAUNCHER_EVENT = 'teslasync:tour:openLauncher';

export interface TourStartEventDetail {
  id: string;
}

// React Native's tsconfig omits the DOM lib, so the optional global
// `CustomEvent` constructor + `dispatchEvent` are typed structurally. Only the
// members the mirror actually uses are modelled.
type NativeCustomEventConstructor = new (
  type: string,
  init?: {detail?: unknown},
) => unknown;

interface NativeEventDispatcher {
  dispatchEvent(event: unknown): boolean;
}

function getEventDispatcher(): NativeEventDispatcher | null {
  const candidate = globalThis as typeof globalThis &
    Partial<NativeEventDispatcher>;
  return typeof candidate.dispatchEvent === 'function'
    ? (candidate as NativeEventDispatcher)
    : null;
}

function getCustomEventConstructor(): NativeCustomEventConstructor | null {
  const candidate = (globalThis as typeof globalThis & {CustomEvent?: unknown})
    .CustomEvent;
  return typeof candidate === 'function'
    ? (candidate as NativeCustomEventConstructor)
    : null;
}

/**
 * Best-effort mirror of a tour signal onto a detected global event dispatcher
 * (react-native-web `window`), so a consumer using the web `window
 * .addEventListener(TOUR_*_EVENT)` path still receives it. A no-op on pure
 * native (no global dispatcher / `CustomEvent`); in-process subscribers below
 * are the native delivery path there.
 */
function emitGlobalTourEvent(type: string, detail?: unknown): void {
  const dispatcher = getEventDispatcher();
  const CustomEventCtor = getCustomEventConstructor();
  if (!dispatcher || !CustomEventCtor) return;
  try {
    dispatcher.dispatchEvent(new CustomEventCtor(type, {detail}));
  } catch {
    /* best-effort: in-process subscribers already received the signal */
  }
}

// In-process subscriber registries — the native analog of the web same-document
// CustomEvent. A dispatch notifies these synchronously on every platform; a
// react-native-web `window.addEventListener` consumer additionally receives the
// mirrored global CustomEvent. No subscriber is registered on BOTH channels, so
// there is no double delivery.
const tourStartListeners = new Set<(id: string) => void>();
const launcherOpenListeners = new Set<() => void>();

/** Convenience helper to dispatch the start event. */
export function dispatchTourStart(id: string): void {
  for (const cb of [...tourStartListeners]) {
    try {
      cb(id);
    } catch {
      /* never let one subscriber break the dispatch loop */
    }
  }
  const detail: TourStartEventDetail = {id};
  emitGlobalTourEvent(TOUR_START_EVENT, detail);
}

/** Convenience helper to dispatch the launcher-open event. */
export function dispatchTourLauncherOpen(): void {
  for (const cb of [...launcherOpenListeners]) {
    try {
      cb();
    } catch {
      /* never let one subscriber break the dispatch loop */
    }
  }
  emitGlobalTourEvent(TOUR_OPEN_LAUNCHER_EVENT);
}

/**
 * Native analog of `window.addEventListener(TOUR_START_EVENT)`. Subscribes to
 * tour-start dispatches (carrying the resolved id) and returns an idempotent
 * unsubscribe. On react-native-web a consumer may instead keep using the web
 * `window.addEventListener` path — {@link dispatchTourStart} mirrors there too.
 */
export function subscribeTourStart(cb: (id: string) => void): () => void {
  tourStartListeners.add(cb);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    tourStartListeners.delete(cb);
  };
}

/**
 * Native analog of `window.addEventListener(TOUR_OPEN_LAUNCHER_EVENT)`.
 * Subscribes to launcher-open dispatches and returns an idempotent unsubscribe.
 */
export function subscribeTourLauncherOpen(cb: () => void): () => void {
  launcherOpenListeners.add(cb);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    launcherOpenListeners.delete(cb);
  };
}

// ─── Registry ────────────────────────────────────────────────────────────────
// drivesTour is the only tour ported into the native parity layer so far, so it
// is imported for real (above). The other seven tours are NOT yet ported; each
// resolves to a native-safe placeholder carrying the real, verbatim tour
// metadata with empty `steps` (the unported step walkthrough). A future pass
// swaps each placeholder for the real native import when that tour module lands.

/**
 * Build a native-safe placeholder for a not-yet-ported tour: the real metadata
 * (everything except the step walkthrough) plus an empty `steps` array, so the
 * launcher list, route-recommendation, and `autoStart` behaviour stay faithful
 * until the tour's own file-by-file pass ports its `TourStep[]`.
 */
function unportedTour(meta: Omit<TourDefinition, 'steps'>): TourDefinition {
  return {...meta, steps: []};
}

const MAIN_TOUR = unportedTour({
  id: 'main',
  routeMatch: '/',
  titleKey: 'tour.tours.main.title',
  titleFallback: 'Welcome to TeslaSync',
  descriptionKey: 'tour.tours.main.description',
  descriptionFallback: 'A quick tour of the dashboard, sidebar, and live data.',
  version: 2,
  autoStart: ({pathname, vehicleCount}) =>
    pathname === '/' && vehicleCount > 0,
});

const ALERTS_TOUR = unportedTour({
  id: 'alerts',
  routeMatch: /^\/notifications\/(alerts|studio)/,
  titleKey: 'tour.tours.alerts.title',
  titleFallback: 'Alerts & Alert Studio',
  descriptionKey: 'tour.tours.alerts.description',
  descriptionFallback: 'Triage the inbox and craft custom rules with previews.',
  version: 1,
});

const CHARGING_TOUR = unportedTour({
  id: 'charging',
  routeMatch: /^\/(charging|cost-analysis|charging-curve|smart-charge)/,
  titleKey: 'tour.tours.charging.title',
  titleFallback: 'Charging & cost analysis',
  descriptionKey: 'tour.tours.charging.description',
  descriptionFallback: 'Sessions, cost breakdowns, and curve diagnostics.',
  version: 1,
});

const VEHICLES_TOUR = unportedTour({
  id: 'vehicles',
  routeMatch: /^\/vehicles/,
  titleKey: 'tour.tours.vehicles.title',
  titleFallback: 'Vehicles & sharing',
  descriptionKey: 'tour.tours.vehicles.description',
  descriptionFallback: 'Browse fleet, open a vehicle, share access.',
  version: 1,
});

const AUTOMATIONS_TOUR = unportedTour({
  id: 'automations',
  routeMatch: /^\/automations/,
  titleKey: 'tour.tours.automations.title',
  titleFallback: 'Automations',
  descriptionKey: 'tour.tours.automations.description',
  descriptionFallback: 'Build triggers, conditions, and actions visually.',
  version: 1,
});

const SETTINGS_TOUR = unportedTour({
  id: 'settings',
  routeMatch: /^\/settings/,
  titleKey: 'tour.tours.settings.title',
  titleFallback: 'Settings',
  descriptionKey: 'tour.tours.settings.description',
  descriptionFallback: 'Theme, units, notifications, and tours.',
  version: 1,
});

const DEBUGGER_TOUR = unportedTour({
  id: 'debugger',
  routeMatch:
    /^\/(state-debugger|live-monitor|signal-explorer|signal-diff|signal-gaps|mqtt-inspector|signal-log|redis-signals)/,
  titleKey: 'tour.tours.debugger.title',
  titleFallback: 'State machine debugger',
  descriptionKey: 'tour.tours.debugger.description',
  descriptionFallback: 'Timeline, layered sources, freeze/step, deep links.',
  version: 1,
});

export const TOURS: Record<string, TourDefinition> = {
  main: MAIN_TOUR,
  alerts: ALERTS_TOUR,
  charging: CHARGING_TOUR,
  drives: DRIVES_TOUR,
  vehicles: VEHICLES_TOUR,
  automations: AUTOMATIONS_TOUR,
  settings: SETTINGS_TOUR,
  debugger: DEBUGGER_TOUR,
};

/** Iteration order for the launcher list. */
export const TOUR_ORDER: readonly string[] = [
  'main',
  'vehicles',
  'drives',
  'charging',
  'alerts',
  'automations',
  'settings',
  'debugger',
] as const;

/** Lookup helper that returns the definition or null. */
export function getTour(id: string): TourDefinition | null {
  return TOURS[id] ?? null;
}

/** Returns every tour in display order. */
export function listTours(): TourDefinition[] {
  return TOUR_ORDER.map(id => TOURS[id]).filter((d): d is TourDefinition =>
    Boolean(d),
  );
}
