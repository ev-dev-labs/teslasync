import type { TourDefinition } from '@/lib/tourRegistry'
import type { TourStep } from '@/hooks/useTour'

/**
 * Main onboarding tour.
 *
 * Launcher-only since HELP-01. This tour used to auto-start the first time a
 * user landed on the dashboard with a vehicle linked — a seven-step spotlight
 * over the whole app, triggered by presence rather than by need. That is an
 * interruption: it is modal, it is global, and it is unrelated to whatever the
 * user opened the app to do.
 *
 * Progressive, task-specific onboarding replaced it (see
 * `lib/onboardingTasks.ts`): one hint, on the route where the task is
 * performed, only while the task is actually outstanding, and never for an
 * experienced user. The full walkthrough remains available on demand from the
 * tour launcher, which is where a user who wants a tour goes to ask for one.
 *
 * Bumping the version below silently invalidates any stored completion flag.
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
  // No `autoStart` predicate — by design. Every tour in the registry is now
  // launcher-only; nothing in this app opens a walkthrough the user did not
  // ask for. The invariant is pinned in `__tests__/tours.test.ts`.
}
