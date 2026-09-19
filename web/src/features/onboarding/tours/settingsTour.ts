import type { TourDefinition } from '@/lib/tourRegistry'
import type { TourStep } from '@/hooks/useTour'
import i18n from 'i18next'

/**
 * Settings onboarding tour.
 *
 * Launcher-only walkthrough (no `autoStart`) of the four settings anchors:
 * appearance, units, workspace, and the tour-replay launcher. Each step
 * opens its settings category before the spotlight positions itself.
 */

function navigate(href: string) {
  if (typeof window === 'undefined') return
  if (window.location.pathname + window.location.hash === href) return
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
    onShow: () => navigate('/settings#appearance'),
  },
  {
    target: '[data-tour="settings-units"]',
    title: 'Units',
    description:
      'Distance, temperature, energy, and date format follow your preference everywhere — no per-page toggles. Pick imperial or metric once and forget about it.',
    placement: 'top',
    onShow: () => navigate('/settings#general'),
  },
  {
    target: '[data-tour="settings-workspace"]',
    get title() { return i18n.t('settings.organization.workspaceTourTitle', 'Workspace preferences') },
    get description() {
      return i18n.t('settings.organization.workspaceTourDescription', 'Choose your landing page, default vehicle, and analysis window to make TeslaSync fit your everyday workflow.')
    },
    placement: 'top',
    onShow: () => navigate('/settings#workspace'),
  },
  {
    target: '[data-tour="settings-tour"]',
    title: 'Replay any tour later',
    description:
      'This block opens the Tour Launcher so you can re-run any walkthrough. The launcher also lives in the help shortcut at the top of the sidebar.',
    placement: 'top',
    onShow: () => navigate('/settings#overview'),
  },
]

export const SETTINGS_TOUR: TourDefinition = {
  id: 'settings',
  routeMatch: /^\/settings/,
  titleKey: 'tour.tours.settings.title',
  titleFallback: 'Settings',
  descriptionKey: 'tour.tours.settings.description',
  descriptionFallback: 'Theme, units, workspace, and tours.',
  version: 2,
  steps: STEPS,
}
