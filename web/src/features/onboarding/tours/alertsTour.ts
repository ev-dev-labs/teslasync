import type { TourDefinition } from '@/lib/tourRegistry'
import type { TourStep } from '@/hooks/useTour'

/**
 * Alerts tour — covers the alerts inbox and the Alert Studio rule builder.
 * Navigates between `/alerts` and `/alert-studio` via `onShow` so each step
 * lands on the right page before the spotlight measures its target.
 */

function navigate(href: string) {
  if (typeof window === 'undefined') return
  if (window.location.pathname === href) return
  window.history.pushState({}, '', href)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="alerts-list"]',
    title: 'Your alert inbox',
    description:
      'All triggered alerts land here, newest first. Click a row to open the source — a vehicle event, a drive, or the rule that fired.',
    placement: 'bottom',
    onShow: () => navigate('/alerts'),
  },
  {
    target: '[data-tour="alerts-filters"]',
    title: 'Filter by severity, vehicle, or rule',
    description:
      'Narrow the inbox while you triage. Save the active combo as a Saved View from the page header to reuse it later.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="alert-studio-builder"]',
    title: 'Build new rules in Alert Studio',
    description:
      'Compose any signal, threshold, and notification channel into a rule. The preview chart shows how the rule would have fired against the last 24h.',
    placement: 'bottom',
    onShow: () => navigate('/alert-studio'),
  },
  {
    target: '[data-tour="alert-studio-channels"]',
    title: 'Pick how you want to be told',
    description:
      'Email, ntfy, web push (Prompt 52), webhook — every rule chooses its own channels. Test the rule before saving to confirm the wiring.',
    placement: 'left',
  },
]

export const ALERTS_TOUR: TourDefinition = {
  id: 'alerts',
  routeMatch: /^\/(alerts|alert-studio)/,
  titleKey: 'tour.tours.alerts.title',
  titleFallback: 'Alerts & Alert Studio',
  descriptionKey: 'tour.tours.alerts.description',
  descriptionFallback: 'Triage the inbox and craft custom rules with previews.',
  version: 1,
  steps: STEPS,
}
