import type { TourDefinition } from '@/lib/tourRegistry'
import type { TourStep } from '@/hooks/useTour'

function navigate(href: string) {
  if (typeof window === 'undefined') return
  if (window.location.pathname === href) return
  window.history.pushState({}, '', href)
  window.dispatchEvent(new PopStateEvent('popstate'))
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
]

export const AUTOMATIONS_TOUR: TourDefinition = {
  id: 'automations',
  routeMatch: /^\/automations/,
  titleKey: 'tour.tours.automations.title',
  titleFallback: 'Automations',
  descriptionKey: 'tour.tours.automations.description',
  descriptionFallback: 'Build triggers, conditions, and actions visually.',
  version: 1,
  steps: STEPS,
}
