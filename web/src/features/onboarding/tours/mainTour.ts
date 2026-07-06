import type { TourDefinition } from '@/lib/tourRegistry'
import type { TourStep } from '@/hooks/useTour'

/**
 * Main onboarding tour.
 *
 * The dashboard-focused walkthrough that auto-starts the first time a user
 * lands on the dashboard root (`/`) with at least one vehicle linked. Bumping
 * the version below silently invalidates any previously stored completion flag.
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
]

export const MAIN_TOUR: TourDefinition = {
  id: 'main',
  routeMatch: '/',
  titleKey: 'tour.tours.main.title',
  titleFallback: 'Welcome to TeslaSync',
  descriptionKey: 'tour.tours.main.description',
  descriptionFallback: 'A quick tour of the dashboard, sidebar, and live data.',
  version: 2,
  steps: STEPS,
  // Null-safe: a malformed/partial context (missing `vehicleCount`, or no
  // context at all) must resolve to `false` rather than throw on destructure —
  // the predicate runs inside a Layout effect on every route change.
  autoStart: (ctx) => ctx?.pathname === '/' && (ctx?.vehicleCount ?? 0) > 0,
}
