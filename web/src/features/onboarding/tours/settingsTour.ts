import type { TourDefinition } from '@/lib/tourRegistry'
import type { TourStep } from '@/hooks/useTour'

/**
 * Settings onboarding tour.
 *
 * Launcher-only walkthrough (no `autoStart`) of the four settings anchors:
 * appearance, units, notifications, and the tour-replay launcher. The first
 * step routes the user to `/settings` so the highlighted panels exist in the
 * DOM before the spotlight positions itself.
 */

function navigate(href: string) {
  if (typeof window === 'undefined') return
  if (window.location.pathname === href) return
  window.history.pushState({}, '', href)
  // pushState does not emit popstate, so dispatch it manually to notify the
  // client-side router that the location changed.
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="settings-appearance"]',
    title: 'Appearance & theme',
    description:
      'Pick a colour theme, density, and motion preference. Changes preview live before you save.',
    placement: 'bottom',
    onShow: () => navigate('/settings'),
  },
  {
    target: '[data-tour="settings-units"]',
    title: 'Units',
    description:
      'Distance, temperature, energy, and date format follow your preference everywhere — no per-page toggles. Pick imperial or metric once and forget about it.',
    placement: 'top',
  },
  {
    target: '[data-tour="settings-notifications"]',
    title: 'Notification channels',
    description:
      'Configure email, web push, ntfy, or webhook channels. Test each channel before relying on it for alerts.',
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
