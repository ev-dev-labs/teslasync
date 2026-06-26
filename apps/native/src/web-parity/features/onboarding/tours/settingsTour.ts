// settingsTour — native parity port of
// web/src/features/onboarding/tours/settingsTour.ts.
//
// Non-visual tour-definition data module. It declares the ordered onboarding
// walkthrough for the Settings page: four steps (appearance/theme, units,
// notification channels, tour-launcher) plus the SETTINGS_TOUR definition that
// the tour registry consumes. Every step `target`, `title`, `description`,
// `placement`, the appearance step's navigation `onShow`, and the whole
// SETTINGS_TOUR definition (id, routeMatch regex, titleKey/titleFallback,
// descriptionKey/descriptionFallback, version, steps) are preserved verbatim
// from the web source.
//
// Native adaptations vs. the web source (behaviour / data / keys kept):
//   - The `TourStep` type (web L2, from @/hooks/useTour) and the
//     `TourDefinition` + `TourAutoStartContext` types (web L1, from
//     @/lib/tourRegistry) are inline-ported here as local, faithfully-shaped
//     copies because neither dependency has been converted into this RN parity
//     layer yet. This follows the self-contained inline-port precedent set by
//     OnboardingPage.tsx in this directory. They are kept private (the web file
//     imports — not re-exports — them) so the only data export remains
//     SETTINGS_TOUR; structural typing keeps SETTINGS_TOUR assignable to the
//     real TourDefinition once that module is converted.
//   - The private `navigate(href)` helper (web L4-9) used the DOM history API
//     (`window.history.pushState({}, '', href)` + dispatching a
//     `PopStateEvent('popstate')`, guarded by `typeof window === 'undefined'`
//     and a same-path `window.location.pathname === href` check). React Native
//     has no DOM history/location/PopStateEvent, so navigation is delegated to
//     a handler the native tour runner can register via
//     `setTourNavigationHandler`, mirroring the `onNavigate?.(path)`
//     navigation-shell pattern used across this parity layer. When no handler
//     is registered the call is a documented no-op — the explicit "navigation
//     unavailable" state replacing the web's `typeof window === 'undefined'`
//     early return. The same-path dedup guard (web L6) becomes the registered
//     handler/runner's responsibility because the live current route cannot be
//     read from a data module on native.
//
// No DOM / window.history / PopStateEvent / react-router / react-i18next /
// lucide / Recharts / Leaflet / framer-motion / old web-UI import reaches the
// native output — this is plain TypeScript data.

/**
 * A single step in a guided tour.
 *
 * Inline-ported (private) copy of the web `TourStep` interface from
 * `@/hooks/useTour` — that hook is not yet part of this RN parity layer.
 */
interface TourStep {
  /** CSS/`data-tour` selector for the element to highlight */
  target: string
  /** Title of the tooltip */
  title: string
  /** Description text */
  description: string
  /** Position of the tooltip relative to the highlighted element */
  placement: 'top' | 'bottom' | 'left' | 'right'
  /** Optional: action to perform when this step is shown (e.g., open sidebar) */
  onShow?: () => void
  /** Optional: action to perform when leaving this step */
  onHide?: () => void
}

/**
 * Context passed to a {@link TourDefinition.autoStart} predicate.
 *
 * Inline-ported (private) copy of the web `TourAutoStartContext` interface from
 * `@/lib/tourRegistry`.
 */
interface TourAutoStartContext {
  pathname: string
  vehicleCount: number
}

/**
 * A per-feature onboarding tour definition.
 *
 * Inline-ported (private) copy of the web `TourDefinition` interface from
 * `@/lib/tourRegistry`.
 */
interface TourDefinition {
  /** Stable identifier — storage key, registry lookup, telemetry */
  id: string
  /** Route(s) where the launcher should recommend this tour */
  routeMatch: string | RegExp
  /** i18n key for the tour's display name in the launcher */
  titleKey: string
  /** English fallback for {@link titleKey} */
  titleFallback: string
  /** i18n key for the one-line description */
  descriptionKey: string
  /** English fallback for {@link descriptionKey} */
  descriptionFallback: string
  /** Bump when the tour content materially changes */
  version: number
  /** Ordered list of steps the user is walked through */
  steps: TourStep[]
  /** Optional auto-start predicate evaluated on route changes */
  autoStart?: (ctx: TourAutoStartContext) => boolean
}

/**
 * Native-safe navigation handler for tour steps. The native tour runner can
 * register a real navigation function (e.g. one bound to its navigation shell)
 * here; until then `navigate` is a documented no-op. This replaces the web's
 * DOM `window.history.pushState` + `PopStateEvent('popstate')` mechanism.
 */
type TourNavigationHandler = (href: string) => void

let tourNavigationHandler: TourNavigationHandler | null = null

/**
 * Register (or clear, with `null`) the navigation handler used by tour-step
 * `onShow` callbacks. Mirrors the `onNavigate?.(path)` navigation-shell pattern
 * used elsewhere in this parity layer.
 */
export function setTourNavigationHandler(handler: TourNavigationHandler | null): void {
  tourNavigationHandler = handler
}

function navigate(href: string): void {
  // Native-safe replacement for the web's
  //   window.history.pushState({}, '', href) + dispatch PopStateEvent('popstate')
  // React Native has no DOM history/location/PopStateEvent, so the actual
  // navigation (and the web L6 same-path dedup) is delegated to the registered
  // handler. With none registered this is the explicit "navigation
  // unavailable" no-op, mirroring the web `typeof window === 'undefined'`
  // early return.
  tourNavigationHandler?.(href)
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="settings-appearance"]',
    title: 'Appearance & theme',
    description:
      'Pick a colour theme, density, and motion preference (Prompt 60). Changes preview live before you save.',
    placement: 'bottom',
    onShow: () => navigate('/settings'),
  },
  {
    target: '[data-tour="settings-units"]',
    title: 'Units (Prompt 21)',
    description:
      'Distance, temperature, energy, and date format follow your preference everywhere — no per-page toggles. Pick imperial or metric once and forget about it.',
    placement: 'top',
  },
  {
    target: '[data-tour="settings-notifications"]',
    title: 'Notification channels',
    description:
      'Configure email, web push (Prompt 52), ntfy, or webhook channels. Test each channel before relying on it for alerts.',
    placement: 'top',
  },
  {
    target: '[data-tour="settings-tour"]',
    title: 'Replay any tour later',
    description:
      'This block opens the Tour Launcher so you can re-run any walkthrough. The launcher also lives in the help shortcut at the top of the sidebar.',
    placement: 'top',
  },
]

export const SETTINGS_TOUR: TourDefinition = {
  id: 'settings',
  routeMatch: /^\/settings/,
  titleKey: 'tour.tours.settings.title',
  titleFallback: 'Settings',
  descriptionKey: 'tour.tours.settings.description',
  descriptionFallback: 'Theme, units, notifications, and tours.',
  version: 1,
  steps: STEPS,
}
