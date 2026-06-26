// Native parity port of web/src/features/onboarding/tours/vehiclesTour.ts.
//
// `VEHICLES_TOUR` is the onboarding-tour definition for the Vehicles area: an
// ordered list of spotlight steps (the vehicles list, opening a card, the
// detail tabs, and access sharing) plus the launcher metadata (id, route hint,
// i18n title/description keys + English fallbacks, version). The web module
// imports its two types from other modules and exports only `VEHICLES_TOUR`;
// this port keeps that exact public surface and reproduces the four steps + the
// tour metadata verbatim.
//
// Native-safe adaptations (documented in the sidecar):
//   - The web file imports `TourDefinition` from `@/lib/tourRegistry` and
//     `TourStep` from `@/hooks/useTour`. Neither module is ported as a
//     standalone native module (the sibling TourLauncher port inlines a
//     launcher-only subset of the registry), and the native tsconfig has no
//     `@/` path alias, so — following that same inline-the-un-portable-types
//     idiom — faithful local mirrors of both types are declared here. They are
//     kept non-exported so the public surface stays `VEHICLES_TOUR` only, just
//     like the web file. `TourStep.target` (a web CSS selector) and
//     `placement` (the tooltip anchor) are retained verbatim for a future
//     native tour overlay even though no native overlay consumes them yet.
//   - The web `navigate(href)` helper deep-links the SPA via
//     `window.history.pushState` + a synthetic `popstate` so a step's target
//     element exists when the step is shown. React Native has no DOM History
//     API / `window.location` (and the RN TypeScript lib excludes DOM), and no
//     native tour overlay drives these steps yet, so `navigate` is an explicit
//     native-safe no-op. The call site `onShow: () => navigate('/vehicles')`
//     and the `/vehicles` route string are preserved verbatim so the behaviour
//     can be wired to React Navigation later.
//
// No DOM, react-router-dom, react-i18next, Recharts, Leaflet, framer-motion, or
// old web UI components are imported — this is non-visual data/type code.

/** Tooltip placement relative to the highlighted element (mirrors the web `TourStep`). */
type TourPlacement = 'top' | 'bottom' | 'left' | 'right';

/**
 * Native-safe mirror of the web `TourStep` (`@/hooks/useTour`). `target` is the
 * web CSS selector for the element to highlight and `placement` the tooltip
 * anchor; both are kept verbatim so a future native overlay can map them.
 */
interface TourStep {
  /** CSS selector for the element to highlight (web overlay concern). */
  target: string;
  /** Title of the tooltip. */
  title: string;
  /** Description text. */
  description: string;
  /** Position of the tooltip relative to the highlighted element. */
  placement: TourPlacement;
  /** Optional: action to perform when this step is shown. */
  onShow?: () => void;
  /** Optional: action to perform when leaving this step. */
  onHide?: () => void;
}

/** Context passed to a `TourDefinition.autoStart` predicate (mirrors the web type). */
interface TourAutoStartContext {
  pathname: string;
  vehicleCount: number;
}

/**
 * Native-safe mirror of the web `TourDefinition` (`@/lib/tourRegistry`).
 * `routeMatch` keeps the `string | RegExp` shape; `autoStart` is part of the
 * web contract (only the `main` tour opts in) and is mirrored for fidelity even
 * though `VEHICLES_TOUR` does not set it.
 */
interface TourDefinition {
  id: string;
  routeMatch: string | RegExp;
  titleKey: string;
  titleFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  version: number;
  steps: TourStep[];
  autoStart?: (ctx: TourAutoStartContext) => boolean;
}

function navigate(href: string): void {
  // Web-only deep navigation. The web tour calls this from a step's `onShow`
  // to push the SPA to the route hosting the highlighted element
  // (`window.history.pushState` + a synthetic `popstate`). React Native has no
  // DOM History API / `window.location`, and no native tour overlay drives
  // these steps yet, so this is an explicit native-safe no-op; the route string
  // is preserved verbatim at the call site for a future React Navigation wiring.
  if (href) {
    // No native navigation side-effect (see above).
  }
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="vehicles-list"]',
    title: 'Your vehicles',
    description:
      'Every Tesla linked to your account. The card shows live state — online, asleep, charging — and the colour ring matches the section icon set.',
    placement: 'bottom',
    onShow: () => navigate('/vehicles'),
  },
  {
    target: '[data-tour="vehicles-card"]',
    title: 'Open a vehicle for the deep dive',
    description:
      'Click a card for the full digital twin: battery, climate, doors, software updates, location, and the live signal stream.',
    placement: 'right',
  },
  {
    target: '[data-tour="vehicle-detail-tabs"]',
    title: 'Sectioned details',
    description:
      'Tabs split the dossier into Overview, History, Telemetry, and Maintenance so the page stays scannable on mobile.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="vehicle-access"]',
    title: 'Share access',
    description:
      'Invite a partner or family member with their own login. Role-based access controls what they can see and command.',
    placement: 'top',
  },
];

export const VEHICLES_TOUR: TourDefinition = {
  id: 'vehicles',
  routeMatch: /^\/vehicles/,
  titleKey: 'tour.tours.vehicles.title',
  titleFallback: 'Vehicles & sharing',
  descriptionKey: 'tour.tours.vehicles.description',
  descriptionFallback: 'Browse fleet, open a vehicle, share access.',
  version: 1,
  steps: STEPS,
};
