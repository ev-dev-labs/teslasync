/**
 * Native parity port of web/src/features/onboarding/tourSteps.ts.
 *
 * Original web file docblock (preserved verbatim):
 *
 *   @deprecated The tour-step definitions moved to per-feature files under
 *   `web/src/features/onboarding/tours/`. The main dashboard walkthrough now
 *   lives in `tours/mainTour.ts` (Phase-40 / Prompt 65).
 *
 *   This file is kept temporarily so any external import of
 *   `MAIN_TOUR_STEPS` continues to compile during the migration. It will be
 *   removed in a follow-up cleanup.
 *
 * Native conversion notes (parity-contract rules 6 & 7):
 *  - The web shim did three things: (1) re-export `MAIN_TOUR` from
 *    './tours/mainTour', (2) import the `TourStep` type from '@/hooks/useTour',
 *    and (3) derive `export const MAIN_TOUR_STEPS = MAIN_TOUR.steps`.
 *  - Neither a native `tours/mainTour` parity port nor a native `useTour`
 *    parity port exists yet (only the sibling `tours/alertsTour.ts` has been
 *    ported, and it is itself fully self-contained). Mirroring that sibling's
 *    decision, the `TourStep` / `TourAutoStartContext` / `TourDefinition` types
 *    and the `MAIN_TOUR` data are inlined here verbatim instead of being
 *    imported, so the file stays self-contained and compiles under the native
 *    toolchain. When a dedicated native `tours/mainTour.ts` lands, this shim can
 *    re-export from it (matching the web "removed in a follow-up cleanup" intent).
 *  - The public surface the web shim exposed — `MAIN_TOUR` and
 *    `MAIN_TOUR_STEPS` — is preserved exactly, with identical values.
 *  - `TourStep.target` values stay the verbatim web CSS selectors
 *    ([data-tour="…"]); no DOM query runs in this file — a native tour overlay
 *    resolves them to registered native targets.
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
 * verbatim so a future native registry can consume `MAIN_TOUR` unchanged.
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

/**
 * Main onboarding tour steps. Inlined verbatim from the web
 * `tours/mainTour.ts` source that the deprecated shim re-exported.
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

/**
 * The main dashboard walkthrough. Inlined verbatim from web `tours/mainTour.ts`
 * (which the deprecated web shim re-exported) so the public `MAIN_TOUR` export
 * is preserved exactly while the native `tours/mainTour.ts` port is pending.
 */
export const MAIN_TOUR: TourDefinition = {
  id: 'main',
  routeMatch: '/',
  titleKey: 'tour.tours.main.title',
  titleFallback: 'Welcome to TeslaSync',
  descriptionKey: 'tour.tours.main.description',
  descriptionFallback: 'A quick tour of the dashboard, sidebar, and live data.',
  version: 2,
  steps: STEPS,
  autoStart: ({ pathname, vehicleCount }) =>
    pathname === '/' && vehicleCount > 0,
};

/**
 * @deprecated Mirrors the web shim's derived export. Prefer reading
 * `MAIN_TOUR.steps` directly; kept so existing `MAIN_TOUR_STEPS` consumers
 * continue to compile during the migration.
 */
export const MAIN_TOUR_STEPS: TourStep[] = MAIN_TOUR.steps;
