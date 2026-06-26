// Native parity port of web/src/features/onboarding/tours/drivesTour.ts.
//
// The web file is a pure tour-definition data module for the product-tour
// system: it exports `DRIVES_TOUR: TourDefinition` (id 'drives', routeMatch
// /^\/drives/, version 1) plus its four ordered `TourStep` entries. It owns no
// UI of its own — every entry is metadata (target selector / title /
// description / placement / onShow) consumed by the TourOverlay spotlight.
// Behaviour + copy are preserved 1:1 (conversion rule 3): each step's `target`,
// `title`, `description`, `placement`, and `onShow`, plus the DRIVES_TOUR id /
// routeMatch / titleKey / titleFallback / descriptionKey / descriptionFallback /
// version / steps, are carried over verbatim (the step titles/descriptions are
// hardcoded English in the web source — the i18n keys live only at the
// tour-level titleKey/descriptionKey, so that exact i18n intent is preserved).
//
// Web/DOM-only deps mapped native-safe + documented (rules 4/6/7):
//   - `@/lib/tourRegistry` `TourDefinition` (source L1) and `@/hooks/useTour`
//     `TourStep` (source L2): neither module is ported into the native parity
//     layer yet (each is converted in its own file-by-file pass). The two type
//     contracts are therefore reproduced locally, verbatim, from the web
//     sources — the same self-contained approach the sibling `TourOverlay` port
//     uses for `TourStep` and the widget-registry ports use for `WidgetDef`.
//     Nothing about the data shape changes.
//   - the `navigate(href)` helper (source L4-9) drove the web SPA router via
//     `window.history.pushState({}, '', href)` + a synthetic `PopStateEvent`.
//     React Native has no DOM history / URL router (no react-navigation is
//     wired into this parity tree), so window-driven route navigation is
//     UNAVAILABLE on native (rule 7). The helper keeps the same signature +
//     intent, but instead of touching `window` it delegates to an optional,
//     host-registered navigator via `setTourNavigationHandler` — the same
//     explicit native injection-point pattern the `useWatch`
//     (setWatchApiKeyFromUrl) and MapOverviewPage (goToHash) ports use for
//     browser-only navigation. Absent a registered handler the call is a
//     documented no-op; the `/drives` route association still lives in
//     `DRIVES_TOUR.routeMatch` + the step data, so no intent is lost. The web
//     guard `if (window.location.pathname === href) return` has no native
//     pathname source, so dedupe is delegated to the registered handler.
//
// No DOM elements, browser globals (window/history/location), Recharts,
// Leaflet, framer-motion, lucide-react, or old web UI components are imported —
// this module is plain native-safe TypeScript with no runtime dependencies.

// ── Ported type contracts (web modules not yet in the native parity layer) ────

/**
 * Reproduced from web `@/hooks/useTour`. A single product-tour step. `target`
 * is the web CSS selector for the element to highlight — retained for shape
 * fidelity (the native TourOverlay only consumes placement/title/description).
 */
interface TourStep {
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

/** Context passed to {@link TourDefinition.autoStart} predicates. */
interface TourAutoStartContext {
  pathname: string;
  vehicleCount: number;
}

/**
 * Reproduced from web `@/lib/tourRegistry`. A per-feature onboarding tour:
 * identity, the route it is most relevant on, a version (bump to silently
 * invalidate a stored completion flag), the ordered {@link TourStep} entries,
 * and an optional auto-start predicate. Field shapes match the web source.
 */
interface TourDefinition {
  /** Stable identifier — used for storage key, registry lookup, telemetry. */
  id: string;
  /**
   * Routes where the launcher should highlight this tour as "recommended for
   * this page". A string is an exact prefix; a RegExp allows nuanced matching
   * (e.g. drive detail pages).
   */
  routeMatch: string | RegExp;
  /** i18n key for the tour's display name in the launcher. */
  titleKey: string;
  /** English fallback for {@link titleKey}. */
  titleFallback: string;
  /** i18n key for the one-line description. */
  descriptionKey: string;
  /** English fallback for {@link descriptionKey}. */
  descriptionFallback: string;
  /**
   * Bump this when the tour content materially changes so users whose stored
   * completion was at an older version get the tour re-offered.
   */
  version: number;
  steps: TourStep[];
  /**
   * Optional predicate evaluated on route changes. When it returns true and the
   * tour has not been completed at the current version, the tour starts
   * automatically.
   */
  autoStart?: (ctx: TourAutoStartContext) => boolean;
}

// ── Native-safe navigation shim (web window.history routing → host handler) ───

/** A host-supplied navigator, e.g. a react-navigation dispatch. */
type TourNavigationHandler = (href: string) => void;

let tourNavigationHandler: TourNavigationHandler | undefined;

/**
 * Registers (or clears, with `undefined`) the native navigator used by tour
 * steps. The web `navigate` helper drove `window.history`; on native a host can
 * route real navigation through this hook. Until one is registered, step-driven
 * navigation is a documented no-op (DOM history routing is unavailable here).
 */
export function setTourNavigationHandler(
  handler: TourNavigationHandler | undefined,
): void {
  tourNavigationHandler = handler;
}

/**
 * Native-safe replacement for the web `navigate(href)` (which called
 * `window.history.pushState` and dispatched a `PopStateEvent`). Delegates to the
 * {@link setTourNavigationHandler} handler when present; otherwise a documented
 * no-op. The web `pathname === href` dedupe guard has no native pathname source,
 * so dedupe is delegated to the registered handler.
 */
function navigate(href: string): void {
  tourNavigationHandler?.(href);
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="drives-list"]',
    title: 'Drives history',
    description:
      'Every drive — distance, energy, average speed. Sort, filter, and Save Views from the toolbar to keep the comparisons you reuse.',
    placement: 'bottom',
    onShow: () => navigate('/drives'),
  },
  {
    target: '[data-tour="drives-saved-views"]',
    title: 'Saved Views',
    description:
      'Any filter/sort combination can be pinned as a Saved View and shared via deep link. Set one as default to land there next time.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="drive-replay-scrubber"]',
    title: 'Replay any drive',
    description:
      'Open a drive and switch to Replay — the scrubber plays the route back in real time. Markers (Prompt 57) flag charging stops, regen events, and alerts. Use ←/→ to step and Space to play/pause.',
    placement: 'top',
  },
  {
    target: '[data-tour="drive-replay-share"]',
    title: 'Share or print the playback',
    description:
      'Copy a deep link to a specific moment, or print the page (Prompt 54) for a clean PDF that hides chrome and keeps charts crisp.',
    placement: 'left',
  },
];

export const DRIVES_TOUR: TourDefinition = {
  id: 'drives',
  routeMatch: /^\/drives/,
  titleKey: 'tour.tours.drives.title',
  titleFallback: 'Drives & replay',
  descriptionKey: 'tour.tours.drives.description',
  descriptionFallback: 'Browse drives, replay the route, share moments.',
  version: 1,
  steps: STEPS,
};
