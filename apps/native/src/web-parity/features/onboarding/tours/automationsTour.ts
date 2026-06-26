/**
 * Automations onboarding tour definition.
 *
 * React Native parity port of
 * web/src/features/onboarding/tours/automationsTour.ts.
 *
 * This is a non-visual configuration module: it declares the ordered set of
 * tour steps that walk a user through the automation builder, layered
 * conditions, actions, and conflict warnings, plus the registry metadata
 * (id / routeMatch / i18n keys / version) the tour launcher consumes. All of
 * that data — selectors, titles, descriptions, placements, i18n keys and
 * fallbacks — is preserved verbatim from the web source.
 *
 * Browser-only reductions (explicit unavailable state — see the `.parity.json`
 * sidecar):
 *   - The web `navigate(href)` helper drove a step's `onShow` by pushing
 *     browser history (`window.history.pushState`) and dispatching a synthetic
 *     `PopStateEvent`, guarding on `typeof window` (SSR) and the current
 *     `window.location.pathname`. React Native has no `window.history`;
 *     navigation is owned by the native navigator. `navigate` is reproduced as
 *     a native-safe shim that forwards the href to a host-registered handler
 *     (`setAutomationsTourNavigator`) and otherwise no-ops. The SSR guard and
 *     the same-path early-return were browser-specific and are dropped. The
 *     target path ('/automations/new') is preserved verbatim at the call site
 *     so the parity intent is retained.
 *   - `TourDefinition` is imported from `@/lib/tourRegistry` and `TourStep`
 *     from `@/hooks/useTour` on web. Those modules are not part of this file's
 *     conversion, so the two type shapes are reproduced locally (field-for-
 *     field) to keep the port self-contained and type-checked. `TourStep.target`
 *     (a selector string) and `placement` are preserved as data; they are
 *     interpreted by the native tour overlay when one is wired up.
 */

/** Position of the tour tooltip relative to the highlighted target. */
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right';

/**
 * A single tour step. Field-for-field parity port of the web `TourStep`
 * (`@/hooks/useTour`). `target` remains a selector string identifying the
 * element to highlight; on native it is matched by the native tour overlay.
 */
export interface TourStep {
  /** Selector for the element to highlight (preserved from web). */
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

/**
 * Context passed to a {@link TourDefinition.autoStart} predicate. Mirrors the
 * web `TourAutoStartContext`.
 */
export interface TourAutoStartContext {
  pathname: string;
  vehicleCount: number;
}

/**
 * Tour definition / registry entry. Field-for-field parity port of the web
 * `TourDefinition` (`@/lib/tourRegistry`).
 */
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
  /** Bump when the tour content materially changes (invalidates completion). */
  version: number;
  /** Ordered steps the user is walked through. */
  steps: TourStep[];
  /** Optional auto-start predicate evaluated on route changes. */
  autoStart?: (ctx: TourAutoStartContext) => boolean;
}

/* ── native-safe navigate (parity port of the web history-push helper) ────── */

type TourNavigator = (href: string) => void;

let activeNavigator: TourNavigator | null = null;

/**
 * Registers the host navigator used by tour steps' `onShow` callbacks. The
 * native navigator (e.g. a React Navigation wrapper) can call this once at
 * startup; until then {@link navigate} is a documented no-op (explicit
 * unavailable state). Pass `null` to clear the registration.
 */
export function setAutomationsTourNavigator(
  navigator: TourNavigator | null,
): void {
  activeNavigator = navigator;
}

/**
 * Native-safe replacement for the web `navigate(href)` helper. On web this
 * pushed browser history and dispatched a synthetic `popstate`; on native it
 * forwards the href to the registered host navigator (if any) and otherwise
 * does nothing. The href contract ('/automations/new') is unchanged.
 */
function navigate(href: string): void {
  activeNavigator?.(href);
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="automation-builder"]',
    title: 'The automation builder',
    description:
      'Compose triggers → conditions → actions visually. Every saved automation runs server-side, so it works even when this tab is closed.',
    placement: 'bottom',
    onShow: () => navigate('/automations/new'),
  },
  {
    target: '[data-tour="automation-conditions"]',
    title: 'Layered conditions',
    description:
      'Combine signal thresholds, time windows, geofences, and vehicle state. AND/OR groups give you arbitrary depth without writing code.',
    placement: 'right',
  },
  {
    target: '[data-tour="automation-actions"]',
    title: 'Actions',
    description:
      'Send a command, fire a webhook, push a notification, or chain another automation. Re-order with drag handles.',
    placement: 'right',
  },
  {
    target: '[data-tour="automation-conflicts"]',
    title: 'Conflict warnings',
    description:
      'The builder flags rules that contradict each other (e.g. one starts charging while another stops it). Resolve before saving to avoid loops.',
    placement: 'top',
  },
];

export const AUTOMATIONS_TOUR: TourDefinition = {
  id: 'automations',
  routeMatch: /^\/automations/,
  titleKey: 'tour.tours.automations.title',
  titleFallback: 'Automations',
  descriptionKey: 'tour.tours.automations.description',
  descriptionFallback: 'Build triggers, conditions, and actions visually.',
  version: 1,
  steps: STEPS,
};
