// Native parity port of web/src/features/onboarding/tours/mainTour.ts.
//
// The web module is a pure tour-definition data file. It imports two
// compile-time-only types — `TourStep` (web/src/hooks/useTour.ts) and
// `TourDefinition` (web/src/lib/tourRegistry.ts) via erased `import type`
// statements — and exports the `MAIN_TOUR` constant: the dashboard onboarding
// walkthrough that auto-starts the first time a user lands on `/` with at
// least one vehicle linked.
//
// Those two source modules are DOM/React-web hooks/registries that have not
// been ported to native yet, and the native app configures no `@/` path alias.
// Following the established self-contained web-parity precedent
// (useOnboardingSkip.ts inlining its `@/lib/broadcast` dependency), the two
// erased type contracts are inlined verbatim here instead of imported. No
// runtime behavior changes: every step's target, copy, placement, plus the
// tour id, routeMatch, i18n keys/fallbacks, version, steps, and the autoStart
// predicate are preserved exactly.
//
// `TourStep.target` holds DOM-selector strings (`[data-tour="…"]`) and
// `placement` describes tooltip positioning relative to a DOM element. Both
// are preserved as opaque data so a future native tour runtime can map the
// selectors to view refs / anchor positions; no DOM querying happens in this
// data module. See the parity sidecar for the capability note.

/** A single step in a guided tour (mirrors web/src/hooks/useTour.ts). */
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

/** A registered onboarding tour (mirrors web/src/lib/tourRegistry.ts). */
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
   * Optional predicate evaluated on route changes. When it returns true and
   * the tour has not been completed at the current version, the tour starts
   * automatically. Only the `main` tour opts in by default; every other tour
   * stays explicit (launcher-only).
   */
  autoStart?: (ctx: TourAutoStartContext) => boolean;
}

/**
 * Main onboarding tour.
 *
 * The dashboard-focused walkthrough that auto-starts the first time a user
 * lands on `/dashboard` with at least one vehicle linked. Bumping the
 * version below silently invalidates any previously stored completion flag.
 */

const STEPS: TourStep[] = [
  {
    target: '[data-tour="sidebar"]',
    title: 'Navigation Sidebar',
    description:
      'Browse all sections of TeslaSync from here — vehicles, charging, drives, battery, analytics, and more. The sidebar collapses on mobile.',
    placement: 'right',
  },
  {
    target: '[data-tour="dashboard-grid"]',
    title: 'Your Customizable Dashboard',
    description:
      'This is your home base. Every card is a widget that shows live data from your Tesla. You can customize everything!',
    placement: 'bottom',
  },
  {
    target: '[data-tour="edit-mode-btn"]',
    title: 'Edit Mode',
    description:
      "Click here to enter edit mode. Then you can drag widgets around, resize them, add new ones, or remove ones you don't need.",
    placement: 'bottom',
  },
  {
    target: '[data-tour="vehicle-section"]',
    title: 'Vehicles',
    description:
      'View all your Tesla vehicles, their current state, and detailed information. Dive into any vehicle for live data, commands, and history.',
    placement: 'right',
  },
  {
    target: '[data-tour="commands-section"]',
    title: 'Remote Commands',
    description:
      'Control your Tesla remotely — lock/unlock, climate, charging, trunk, and 70+ other commands. All from your browser.',
    placement: 'right',
  },
  {
    target: '[data-tour="live-signals-section"]',
    title: 'Live Signals',
    description:
      'Watch 230+ telemetry signals in real-time — battery voltage, motor torque, tire pressure, and more. Deep diagnostics at your fingertips.',
    placement: 'right',
  },
  {
    target: '[data-tour="keyboard-hint"]',
    title: 'Keyboard Shortcuts',
    description:
      'Press ? anytime to see all keyboard shortcuts. Press G then a letter to quickly navigate (G+D for Dashboard, G+V for Vehicles, etc.).',
    placement: 'top',
  },
];

export const MAIN_TOUR: TourDefinition = {
  id: 'main',
  routeMatch: '/',
  titleKey: 'tour.tours.main.title',
  titleFallback: 'Welcome to TeslaSync',
  descriptionKey: 'tour.tours.main.description',
  descriptionFallback: 'A quick tour of the dashboard, sidebar, and live data.',
  version: 2,
  steps: STEPS,
  autoStart: ({pathname, vehicleCount}) => pathname === '/' && vehicleCount > 0,
};
