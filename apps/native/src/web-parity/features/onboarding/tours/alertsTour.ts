/**
 * Native parity port of web/src/features/onboarding/tours/alertsTour.ts.
 *
 * Alerts tour — covers the alerts inbox and the Alert Studio rule builder.
 * Navigates between `/notifications/alerts` and `/notifications/studio` via
 * `onShow` so each step lands on the right page before the spotlight
 * measures its target.
 *
 * Native conversion notes (parity-contract rule 7):
 *  - The web source imported `TourDefinition` (from `@/lib/tourRegistry`) and
 *    `TourStep` (from `@/hooks/useTour`). Neither module has a native parity
 *    port yet, so both interfaces are inlined here verbatim — the same
 *    self-contained decision the alertRule.ts native port made for its dropped
 *    `zod` import. They stay structurally identical to the web types, so a
 *    future native tourRegistry can consume `ALERTS_TOUR` unchanged.
 *  - The web `navigate()` helper used `window.history.pushState` +
 *    `window.dispatchEvent(new PopStateEvent('popstate'))` — browser-only
 *    history routing that does not exist on native. Mirroring the sibling
 *    router ports (LegacyNotificationsRedirect, AlertCard), it is rebuilt as a
 *    module-level navigation sink (`setAlertsTourNavigator`) plus an optional
 *    current-path resolver (`setAlertsTourCurrentPathResolver`) that together
 *    reproduce the exact web behavior — including the "skip if already on the
 *    page" guard — once a host wires real React Navigation. With nothing wired
 *    the navigation is a safe no-op.
 *  - `TourStep.target` values stay the verbatim web CSS selectors
 *    (`[data-tour="…"]`). No DOM query runs in this file; a native tour overlay
 *    resolves them to registered native targets, so the tour data is preserved
 *    without importing any browser-only behavior.
 *
 * No DOM, no `window`, no browser HTML elements, no Recharts, no Leaflet and no
 * old web UI components are imported.
 */

/**
 * A single step in a guided tour. Inlined from the web `@/hooks/useTour`
 * `TourStep` interface (no native port exists yet); shape preserved verbatim.
 */
export interface TourStep {
  /** CSS selector for the element to highlight */
  target: string;
  /** Title of the tooltip */
  title: string;
  /** Description text */
  description: string;
  /** Position of the tooltip relative to the highlighted element */
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** Optional: action to perform when this step is shown (e.g., open sidebar) */
  onShow?: () => void;
  /** Optional: action to perform when leaving this step */
  onHide?: () => void;
}

/** Context passed to {@link TourDefinition.autoStart} predicates. */
export interface TourAutoStartContext {
  pathname: string;
  vehicleCount: number;
}

/**
 * A per-feature onboarding tour. Inlined from the web `@/lib/tourRegistry`
 * `TourDefinition` interface (no native port exists yet); shape preserved
 * verbatim so a future native registry can consume `ALERTS_TOUR` unchanged.
 */
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
   * Bump this when the tour content materially changes. Any user whose stored
   * completion was at an older version gets the tour re-offered the next time
   * the auto-start predicate matches.
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

/* ------------------------------------------------------------------ */
/*  Native navigation sink (window.history.pushState port)             */
/* ------------------------------------------------------------------ */

/** Mirrors the web `navigate(href)` signature — push a route by its web path. */
export type AlertsTourNavigate = (href: string) => void;

/** Resolves the current route path, mirroring `window.location.pathname`. */
export type AlertsTourCurrentPathResolver = () => string | null;

// The web pushed history via window.history.pushState + a synthetic popstate.
// Native mounts no browser history here, so navigation defaults to a no-op a
// host overrides with real navigation (e.g. a React Navigation dispatch). Same
// module-level sink convention LegacyNotificationsRedirect established.
let alertsTourNavigate: AlertsTourNavigate = () => {};

// The web guard read window.location.pathname to skip a redundant navigation.
// Native has no window.location, so the current path is resolved through an
// overridable provider that defaults to null (the guard never short-circuits
// until a host wires the real route).
let alertsTourCurrentPath: AlertsTourCurrentPathResolver = () => null;

/** Wires the real navigator (replaces the default no-op). */
export function setAlertsTourNavigator(fn: AlertsTourNavigate): void {
  alertsTourNavigate = fn;
}

/** Wires the current-path resolver used by the "already on this page" guard. */
export function setAlertsTourCurrentPathResolver(
  fn: AlertsTourCurrentPathResolver,
): void {
  alertsTourCurrentPath = fn;
}

/**
 * Records which browser capabilities the web file used are unavailable on
 * native, so the unavailable state is explicit and programmatically
 * inspectable (parity-contract rule 7).
 */
export const nativeAlertsTourCapabilities = {
  windowHistoryPushStateAvailable: false,
  popStateEventDispatchAvailable: false,
  windowLocationPathnameAvailable: false,
} as const;

/**
 * Native-safe port of the web `navigate(href)` helper. Web behavior:
 *   if (typeof window === 'undefined') return
 *   if (window.location.pathname === href) return
 *   window.history.pushState({}, '', href)
 *   window.dispatchEvent(new PopStateEvent('popstate'))
 * The SSR `window === undefined` guard collapses into the default no-op sink;
 * the "already on this page" guard is preserved through the current-path
 * resolver; the pushState + synthetic popstate pair becomes the sink call.
 */
function navigate(href: string) {
  if (alertsTourCurrentPath() === href) return;
  alertsTourNavigate(href);
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="alerts-list"]',
    title: 'Your alert inbox',
    description:
      'All triggered alerts land here, newest first. Click a row to open the source — a vehicle event, a drive, or the rule that fired.',
    placement: 'bottom',
    onShow: () => navigate('/notifications/alerts'),
  },
  {
    target: '[data-tour="alerts-filters"]',
    title: 'Filter by severity, vehicle, or rule',
    description:
      'Narrow the inbox while you triage. Save the active combo as a Saved View from the page header to reuse it later.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="alert-studio-builder"]',
    title: 'Build new rules in Alert Studio',
    description:
      'Compose any signal, threshold, and notification channel into a rule. The preview chart shows how the rule would have fired against the last 24h.',
    placement: 'bottom',
    onShow: () => navigate('/notifications/studio'),
  },
  {
    target: '[data-tour="alert-studio-channels"]',
    title: 'Pick how you want to be told',
    description:
      'Email, ntfy, web push (Prompt 52), webhook — every rule chooses its own channels. Test the rule before saving to confirm the wiring.',
    placement: 'left',
  },
];

export const ALERTS_TOUR: TourDefinition = {
  id: 'alerts',
  routeMatch: /^\/notifications\/(alerts|studio)/,
  titleKey: 'tour.tours.alerts.title',
  titleFallback: 'Alerts & Alert Studio',
  descriptionKey: 'tour.tours.alerts.description',
  descriptionFallback: 'Triage the inbox and craft custom rules with previews.',
  version: 1,
  steps: STEPS,
};
