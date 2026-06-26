// Native parity port of web/src/features/onboarding/tours/chargingTour.ts.
//
// Pure onboarding-tour DATA module: it declares the ordered walkthrough steps
// for the Charging & cost-analysis feature and exports a single TourDefinition
// (CHARGING_TOUR). Every data field is preserved one-for-one with the web
// source so the launcher/registry sees an identical tour:
//   - id 'charging', version 1, the same routeMatch RegExp
//     /^\/(charging|cost-analysis|charging-curve|smart-charge)/, and the same
//     i18n keys + English fallbacks (titleKey/titleFallback/descriptionKey/
//     descriptionFallback).
//   - The same four steps with identical target selectors, titles,
//     descriptions, and placements ('bottom'/'bottom'/'top'/'top').
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4-7) and documented in the sidecar:
//   - The TourStep type (web @/hooks/useTour) and the TourDefinition +
//     TourAutoStartContext types (web @/lib/tourRegistry) are NOT in the native
//     parity manifest, so their shapes are inlined verbatim here (same pattern
//     used by the api/hooks parity ports that inline web @/types/* interfaces).
//   - The web navigate() helper drove SPA navigation through the browser
//     History API (window.history.pushState + a synthetic PopStateEvent) with a
//     window.location.pathname de-dupe guard. React Native has NO DOM History
//     API and this standalone data module cannot reach the in-app navigate()
//     that lives in App.tsx component scope, so imperative history-push
//     navigation is STRUCTURALLY UNAVAILABLE (same limitation documented in
//     NavigationGuardProvider). The preserved route string ('/charging',
//     '/cost-analysis', '/charging-curve') is instead handed to the platform
//     URL handler (Linking.openURL) best-effort with errors swallowed — the
//     same route-string remap NoVehicleSelected uses — so a tour step never
//     crashes. nativeChargingTourCapabilities.historyNavigationAvailable=false
//     records the unavailable state explicitly.

import { Linking } from 'react-native';

/* ── @/hooks/useTour TourStep (inlined — absent from native parity manifest) ── */

export interface TourStep {
  /** Selector for the element to highlight (preserved from the web source). */
  target: string;
  /** Title of the tooltip. */
  title: string;
  /** Description text. */
  description: string;
  /** Position of the tooltip relative to the highlighted element. */
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** Optional: action to perform when this step is shown (e.g., navigate). */
  onShow?: () => void;
  /** Optional: action to perform when leaving this step. */
  onHide?: () => void;
}

/* ── @/lib/tourRegistry types (inlined — absent from native parity manifest) ── */

/** Context passed to {@link TourDefinition.autoStart} predicates. */
export interface TourAutoStartContext {
  pathname: string;
  vehicleCount: number;
}

export interface TourDefinition {
  /** Stable identifier — used for storage key, registry lookup, telemetry. */
  id: string;
  /**
   * Routes where the launcher should highlight this tour as
   * "recommended for this page". A string is an exact prefix; a RegExp allows
   * more nuanced matching.
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
  /** Bump when the tour content materially changes (invalidates completion). */
  version: number;
  steps: TourStep[];
  /**
   * Optional predicate evaluated on route changes. When it returns true and the
   * tour has not been completed at the current version, the tour starts
   * automatically.
   */
  autoStart?: (ctx: TourAutoStartContext) => boolean;
}

/* ── Native capability flag ─────────────────────────────────────────────── */

export const nativeChargingTourCapabilities = {
  /**
   * The web navigate() used window.history.pushState + PopStateEvent to drive
   * in-app SPA navigation. React Native has no DOM History API and this data
   * module cannot reach the in-app navigate(), so an imperative history push is
   * unavailable; the preserved route string is handed to Linking.openURL
   * best-effort instead.
   */
  historyNavigationAvailable: false,
} as const;

/* ── navigate (web window.history.pushState + PopStateEvent) replacement ── */
// No DOM History API and no module-scope access to the in-app router on native;
// the preserved web route string is handed to the platform URL handler on a
// best-effort basis and any failure is swallowed so a tour step never crashes.
function navigate(href: string): void {
  Promise.resolve()
    .then(() => Linking.openURL(href))
    .catch(() => undefined);
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="charging-list"]',
    title: 'Every charging session',
    description:
      'Each row is a session — kWh added, average power, cost. Click into any row for the full charging curve and live signals captured during the session.',
    placement: 'bottom',
    onShow: () => navigate('/charging'),
  },
  {
    target: '[data-tour="charging-filters"]',
    title: 'Filter sessions by location or vehicle',
    description:
      'Save filter combos as Saved Views from the header to compare AC vs DC, home vs Supercharger, or this month vs last.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="cost-analysis"]',
    title: 'Cost analysis',
    description:
      'Tariffs, free supercharging credit, and per-session cost — exportable as CSV. Print the summary with the toolbar Print button (Prompt 54).',
    placement: 'top',
    onShow: () => navigate('/cost-analysis'),
  },
  {
    target: '[data-tour="charging-curve"]',
    title: 'Session detail & curve',
    description:
      'Open a session to see the power curve, SoC ramp, and battery temperature side by side. Cursor sync keeps every chart aligned.',
    placement: 'top',
    onShow: () => navigate('/charging-curve'),
  },
];

export const CHARGING_TOUR: TourDefinition = {
  id: 'charging',
  routeMatch: /^\/(charging|cost-analysis|charging-curve|smart-charge)/,
  titleKey: 'tour.tours.charging.title',
  titleFallback: 'Charging & cost analysis',
  descriptionKey: 'tour.tours.charging.description',
  descriptionFallback: 'Sessions, cost breakdowns, and curve diagnostics.',
  version: 1,
  steps: STEPS,
};
