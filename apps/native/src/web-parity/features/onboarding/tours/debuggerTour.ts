/**
 * Debugger onboarding tour — React Native parity port of
 * web/src/features/onboarding/tours/debuggerTour.ts.
 *
 * Faithful port of the state-machine debugger walkthrough definition. The
 * walkthrough is pure data (four steps plus the registry metadata) with a
 * single navigation side effect on the first step.
 *
 * Web -> native mapping:
 *   • The shared tour types `TourDefinition` (@/lib/tourRegistry) and `TourStep`
 *     (@/hooks/useTour) are not yet in the native parity manifest, so the
 *     minimal type surface this definition relies on is inlined below and kept
 *     structurally identical to the web types (target/title/description/
 *     placement/onShow/onHide for steps; id/routeMatch/titleKey/titleFallback/
 *     descriptionKey/descriptionFallback/version/steps/autoStart for the
 *     definition). When the shared modules are ported these can re-export from
 *     there.
 *   • `navigate(href)` used the browser History API
 *     (window.history.pushState + a synthetic PopStateEvent). React Native has
 *     no window/History, so navigation is delegated to a shell-registered
 *     navigator (setTourNavigator) — the same setActivePath-based navigate the
 *     native App shell already exposes (App.tsx). With no navigator registered
 *     it is an explicit no-op (nativeDebuggerTourCapabilities.historyApiAvailable
 *     === false), mirroring the web SSR guard (`typeof window === 'undefined'`).
 *   • step.target keeps the web `[data-tour="…"]` anchor strings verbatim — they
 *     are opaque anchor keys the (not-yet-ported) tour overlay resolves; the
 *     native overlay will map them to native anchors. The overlay itself
 *     (TourOverlay) is not ported here; this file only provides the definition.
 *
 * No DOM elements, window/History, react-router-dom, Recharts, Leaflet,
 * react-dom, or web UI-kit modules are imported into this native output.
 */

export interface TourStep {
  /**
   * Anchor identifier for the element to highlight. On web this was a CSS
   * selector (`[data-tour="…"]`); preserved verbatim as an opaque anchor key
   * for the native tour overlay to resolve.
   */
  target: string;
  /** Title of the tooltip. */
  title: string;
  /** Description text. */
  description: string;
  /** Position of the tooltip relative to the highlighted element. */
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** Optional: action to perform when this step is shown. */
  onShow?: () => void;
  /** Optional: action to perform when leaving this step. */
  onHide?: () => void;
}

/** Context passed to {@link TourDefinition.autoStart} predicates. */
export interface TourAutoStartContext {
  pathname: string;
  vehicleCount: number;
}

export interface TourDefinition {
  /** Stable identifier — used for storage key, registry lookup, telemetry. */
  id: string;
  /** Route(s) where the launcher highlights this tour as recommended. */
  routeMatch: string | RegExp;
  /** i18n key for the tour's display name in the launcher. */
  titleKey: string;
  /** English fallback for {@link titleKey}. */
  titleFallback: string;
  /** i18n key for the one-line description. */
  descriptionKey: string;
  /** English fallback for {@link descriptionKey}. */
  descriptionFallback: string;
  /** Bump when the tour content materially changes. */
  version: number;
  steps: TourStep[];
  /** Optional auto-start predicate evaluated on route changes. */
  autoStart?: (ctx: TourAutoStartContext) => boolean;
}

/**
 * Capabilities/limitations of this native tour definition relative to the web
 * original. Surfaced so the shell and tests can assert honest parity.
 */
export const nativeDebuggerTourCapabilities = {
  /** No window.history.pushState / PopStateEvent in React Native. */
  historyApiAvailable: false,
  /** Navigation is delegated to a shell-registered navigator. */
  pluggableNavigator: true,
} as const;

/**
 * Navigator the tour step side effects delegate to. The native App shell
 * registers its setActivePath-based navigate here.
 */
export type TourNavigator = (href: string) => void;

let tourNavigator: TourNavigator | null = null;

/**
 * Registers the navigator the tour steps delegate to (the native replacement
 * for the browser History API). Pass null to unregister (e.g. on teardown or in
 * tests).
 */
export function setTourNavigator(navigator: TourNavigator | null): void {
  tourNavigator = navigator;
}

/**
 * Native-safe replacement for the web `navigate(href)` helper. The web version
 * guarded SSR (`typeof window === 'undefined'`) and the same-route case
 * (`window.location.pathname === href`) before pushing history state and
 * dispatching a popstate event. React Native has none of the History API, so we
 * delegate to the shell-registered navigator. The native App navigator
 * normalizes the path and its setState is idempotent, so re-navigating to the
 * current route is already a no-op — preserving the web same-route guard
 * intent. With no navigator registered this is an explicit no-op, mirroring the
 * web SSR guard.
 */
function navigate(href: string): void {
  tourNavigator?.(href);
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="debugger-timeline"]',
    title: 'State machine timeline',
    description:
      'Every transition for the selected vehicle, ordered newest-first. Hover a row to peek at the inputs that drove the decision.',
    placement: 'bottom',
    onShow: () => navigate('/state-debugger'),
  },
  {
    target: '[data-tour="debugger-source-badges"]',
    title: 'Source-layer badges',
    description:
      'L1 = in-process Store, L2 = Redis, LOG = signal_log, STALE = stale Redis. The badge tells you which layer answered each read.',
    placement: 'right',
  },
  {
    target: '[data-tour="debugger-controls"]',
    title: 'Freeze, step, replay',
    description:
      'Pause the live stream so you can inspect a moment, then step through transitions one at a time. Useful when reproducing a flaky issue.',
    placement: 'top',
  },
  {
    target: '[data-tour="debugger-share"]',
    title: 'Permalink the moment (Prompt 58)',
    description:
      'Copy a deep link that pins the timeline to the exact transition you opened — perfect for bug reports and async hand-offs.',
    placement: 'left',
  },
];

export const DEBUGGER_TOUR: TourDefinition = {
  id: 'debugger',
  routeMatch:
    /^\/(state-debugger|live-monitor|signal-explorer|signal-diff|signal-gaps|mqtt-inspector|signal-log|redis-signals)/,
  titleKey: 'tour.tours.debugger.title',
  titleFallback: 'State machine debugger',
  descriptionKey: 'tour.tours.debugger.description',
  descriptionFallback: 'Timeline, layered sources, freeze/step, deep links.',
  version: 1,
  steps: STEPS,
};
