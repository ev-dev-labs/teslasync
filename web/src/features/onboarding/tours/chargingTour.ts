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
]

export const CHARGING_TOUR: TourDefinition = {
  id: 'charging',
  routeMatch: /^\/(charging|cost-analysis|charging-curve|smart-charge)/,
  titleKey: 'tour.tours.charging.title',
  titleFallback: 'Charging & cost analysis',
  descriptionKey: 'tour.tours.charging.description',
  descriptionFallback: 'Sessions, cost breakdowns, and curve diagnostics.',
  version: 1,
  steps: STEPS,
}
